import type { Provider } from "../types.js";
import type { UpstreamProtocol } from "./index.js";
import { joinUrl } from "./http.js";

export interface DiscoveredModel {
  id: string;
  context_window: number | null;
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
    out.push({ id, context_window: extractContextWindow(obj) });
  }
  if (out.length === 0) {
    throw new Error("上游未返回任何模型");
  }
  return out;
}

/** 尽力获取单个模型的上下文窗口（多数供应商需查 /models/{id} 详情） */
export async function fetchModelContext(
  provider: Provider,
  modelName: string,
  protocol: UpstreamProtocol = defaultProtocol(provider),
): Promise<number | null> {
  if (protocol === "anthropic") {
    // Anthropic 的 models 接口不提供上下文窗口
    return null;
  }
  try {
    const base = protocolBaseUrl(provider, protocol);
    const url = joinUrl(base, `models/${encodeURIComponent(modelName)}`);
    const res = await fetch(url, { headers: buildHeaders(provider, protocol) });
    if (!res.ok) return null;
    const obj = (await res.json()) as Record<string, unknown>;
    return extractContextWindow(obj);
  } catch {
    return null;
  }
}

export { protocolBaseUrl };
