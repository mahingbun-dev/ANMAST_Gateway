import type { Provider } from "../types.js";
import type { UpstreamProtocol } from "./index.js";
import { joinUrl } from "./http.js";
import { lookupKnownModel } from "./catalog.js";

export interface DiscoveredModel {
  id: string;
  context_window: number | null;
  input_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  output_price: number | null;
}

function protocolBaseUrl(provider: Provider, protocol: UpstreamProtocol): string {
  if (protocol === "anthropic") return provider.anthropic_base_url ?? provider.base_url;
  return provider.openai_base_url ?? provider.base_url;
}

function buildHeaders(provider: Provider, protocol: UpstreamProtocol): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (protocol === "anthropic") {
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${provider.api_key}`;
  }
  let extra: Record<string, string> = {};
  try {
    extra = JSON.parse(provider.extra_headers || "{}");
  } catch {
    /* ignore */
  }
  Object.assign(headers, extra);
  return headers;
}

function extractContextWindow(obj: Record<string, unknown>): number | null {
  if (!obj) return null;
  const keys = [
    "context_window",
    "contextWindow",
    "max_context_length",
    "max_context",
    "max_input_tokens",
    "context_length",
  ];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

function knownContext(modelId: string): number | null {
  return lookupKnownModel(modelId)?.context_window ?? null;
}

function defaultProtocol(provider: Provider): UpstreamProtocol {
  return provider.type === "anthropic" ? "anthropic" : "openai";
}

/** 列出供应商在给定协议 + API Key 下的可用模型（尽力获取上下文窗口） */
export async function listProviderModels(
  provider: Provider,
  protocol: UpstreamProtocol = defaultProtocol(provider),
): Promise<DiscoveredModel[]> {
  const base = protocolBaseUrl(provider, protocol);
  const url =
    protocol === "anthropic" ? joinUrl(base, "v1/models") : joinUrl(base, "models");
  const res = await fetch(url, { headers: buildHeaders(provider, protocol) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`上游返回 ${res.status}: ${text.slice(0, 300)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("上游返回的不是合法 JSON");
  }
  const arr = ((raw as { data?: unknown[] }).data ?? (raw as { models?: unknown[] }).models ?? []) as unknown[];
  const out: DiscoveredModel[] = [];
  for (const item of arr) {
    const obj = item as Record<string, unknown>;
    const id = (obj.id as string) ?? (obj.name as string);
    if (!id) continue;
    const known = lookupKnownModel(id);
    const ctx = extractContextWindow(obj) ?? known?.context_window ?? null;
    out.push({
      id,
      context_window: ctx,
      input_price: known?.input_price ?? null,
      cache_read_price: known?.cache_read_price ?? null,
      cache_write_price: known?.cache_write_price ?? null,
      output_price: known?.output_price ?? null,
    });
  }
  if (out.length === 0) {
    throw new Error("上游未返回任何模型");
  }
  return out;
}

/**
 * 用任一可用方法拉取模型列表（同一供应商的两种协议共用同一套模型）：
 * 依次尝试 OpenAI /models、Anthropic /v1/models，取第一个返回非空列表的。
 */
export async function listProviderModelsAny(provider: Provider): Promise<DiscoveredModel[]> {
  const attempts: UpstreamProtocol[] = [];
  if (provider.openai_base_url) attempts.push("openai");
  if (provider.anthropic_base_url) attempts.push("anthropic");
  let lastErr = "该供应商未配置任何协议端点";
  for (const proto of attempts) {
    try {
      const models = await listProviderModels(provider, proto);
      if (models.length) return models;
      lastErr = "上游未返回任何模型";
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(lastErr);
}

/** 最小请求验证连通性：401/403 视为鉴权失败，其余状态（含 400/404）视为「端点可达、鉴权通过」 */
export async function pingProvider(
  provider: Provider,
  protocol: UpstreamProtocol,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = protocolBaseUrl(provider, protocol);
    if (protocol === "anthropic") {
      const url = joinUrl(base, "v1/messages");
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(provider, protocol),
        body: JSON.stringify({
          model: "ping",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      const status = res.status;
      await res.text().catch(() => {});
      if (status === 401 || status === 403) return { ok: false, error: `鉴权失败 (HTTP ${status})` };
      return { ok: true };
    }
    const url = joinUrl(base, "chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(provider, protocol),
      body: JSON.stringify({ model: "ping", messages: [{ role: "user", content: "ping" }] }),
    });
    const status = res.status;
    await res.text().catch(() => {});
    if (status === 401 || status === 403) return { ok: false, error: `鉴权失败 (HTTP ${status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 尽力获取单个模型的上下文窗口：先查已知映射，再尝试 OpenAI /models/{id} 详情（模型数据两种协议通用） */
export async function fetchModelContext(provider: Provider, modelName: string): Promise<number | null> {
  // 1. 已知模型上下文映射（非 AI，确定性）
  const known = knownContext(modelName);
  if (known) return known;
  // 2. OpenAI 详情接口（Anthropic 接口不提供上下文）
  if (provider.openai_base_url) {
    try {
      const url = joinUrl(provider.openai_base_url, `models/${encodeURIComponent(modelName)}`);
      const res = await fetch(url, { headers: buildHeaders(provider, "openai") });
      if (res.ok) {
        const obj = (await res.json()) as Record<string, unknown>;
        const cw = extractContextWindow(obj);
        if (cw) return cw;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export { protocolBaseUrl };
