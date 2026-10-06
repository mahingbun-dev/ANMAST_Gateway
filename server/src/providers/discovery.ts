import type { Provider } from "../types.js";
import { joinUrl } from "./http.js";

export interface DiscoveredModel {
  id: string;
  context_window: number | null;
}

function buildHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.type === "anthropic") {
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

/** 列出供应商在给定 API Key 下的可用模型（尽力获取上下文窗口） */
export async function listProviderModels(provider: Provider): Promise<DiscoveredModel[]> {
  const isAnthropic = provider.type === "anthropic";
  const url = isAnthropic
    ? joinUrl(provider.base_url, "v1/models")
    : joinUrl(provider.base_url, "models");
  const res = await fetch(url, { headers: buildHeaders(provider) });
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
export async function fetchModelContext(provider: Provider, modelName: string): Promise<number | null> {
  if (provider.type === "anthropic") {
    // Anthropic 的 models 接口不提供上下文窗口
    return null;
  }
  try {
    const url = joinUrl(provider.base_url, `models/${encodeURIComponent(modelName)}`);
    const res = await fetch(url, { headers: buildHeaders(provider) });
    if (!res.ok) return null;
    const obj = (await res.json()) as Record<string, unknown>;
    return extractContextWindow(obj);
  } catch {
    return null;
  }
}
