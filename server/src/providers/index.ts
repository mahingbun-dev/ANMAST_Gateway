import type { Provider } from "../types.js";
import type { ProviderAdapter } from "./types.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";

export type UpstreamProtocol = "openai" | "anthropic";

export function getAdapterForProtocol(protocol: UpstreamProtocol): ProviderAdapter {
  if (protocol === "anthropic") return anthropicAdapter;
  return openaiAdapter;
}

/** 兼容旧调用：按供应商 type 选适配器 */
export function getAdapter(provider: Pick<Provider, "type">): ProviderAdapter {
  return getAdapterForProtocol(provider.type === "anthropic" ? "anthropic" : "openai");
}

/**
 * 决定某供应商对某客户端协议应使用的上游协议（同协议优先，无法同协议时回退到供应商唯一支持的协议）。
 * 这样客户端与上游同协议时走真流式透传，避免跨协议转换带来的问题。
 */
export function getUpstreamProtocol(
  provider: Provider,
  clientProtocol: string,
): UpstreamProtocol {
  const hasOpenai = !!provider.openai_base_url;
  const hasAnthropic = !!provider.anthropic_base_url;
  if (clientProtocol === "openai" && hasOpenai) return "openai";
  if (clientProtocol === "anthropic" && hasAnthropic) return "anthropic";
  // 回退：仅支持一种协议
  if (hasAnthropic && !hasOpenai) return "anthropic";
  if (hasOpenai && !hasAnthropic) return "openai";
  // 兜底：按 type
  return provider.type === "anthropic" ? "anthropic" : "openai";
}

export * from "./types.js";
export { openaiAdapter, anthropicAdapter };
