import type { Provider } from "../types.js";
import type { ProviderAdapter } from "./types.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";

export function getAdapter(provider: Pick<Provider, "type">): ProviderAdapter {
  if (provider.type === "anthropic") return anthropicAdapter;
  return openaiAdapter;
}

export * from "./types.js";
export { openaiAdapter, anthropicAdapter };
