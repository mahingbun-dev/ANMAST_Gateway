// 已知模型目录（非 AI 确定性数据）：上下文窗口 + 价格（USD / 每 1M tokens）
// 用于部分供应商 API 不返回上下文/价格时兜底；两种协议共用同一套模型数据。
// 说明：标「参考」的价格为常用参考值，实际以各供应商官方为准，可在模型页手动修改。

export interface KnownModelInfo {
  id: string;
  context_window: number;
  input_price: number;
  cache_read_price: number;
  cache_write_price: number;
  output_price: number;
}

export const KNOWN_MODELS: Record<string, KnownModelInfo> = {
  // ---------- 小米 MiMo（海外 USD 定价，官方确认） ----------
  "mimo-v2.6-pro": { id: "mimo-v2.6-pro", context_window: 1000000, input_price: 0.435, cache_read_price: 0.0036, cache_write_price: 0, output_price: 0.87 },
  "mimo-v2.6-flash": { id: "mimo-v2.6-flash", context_window: 1000000, input_price: 0.14, cache_read_price: 0.0028, cache_write_price: 0, output_price: 0.28 },
  "mimo-v2.6-pro-ultraspeed": { id: "mimo-v2.6-pro-ultraspeed", context_window: 1000000, input_price: 4.35, cache_read_price: 0.036, cache_write_price: 0, output_price: 8.7 },
  "mimo-v2.5": { id: "mimo-v2.5", context_window: 1000000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },
  "mimo-v2.5-pro": { id: "mimo-v2.5-pro", context_window: 1000000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },
  "mimo-v2.5-asr": { id: "mimo-v2.5-asr", context_window: 8000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },
  "mimo-v2.5-tts": { id: "mimo-v2.5-tts", context_window: 8000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },
  "mimo-v2.5-tts-voiceclone": { id: "mimo-v2.5-tts-voiceclone", context_window: 8000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },
  "mimo-v2.5-tts-voicedesign": { id: "mimo-v2.5-tts-voicedesign", context_window: 8000, input_price: 0, cache_read_price: 0, cache_write_price: 0, output_price: 0 },

  // ---------- 智谱 GLM（上下文官方确认 1M；价格参考） ----------
  "glm-5.3": { id: "glm-5.3", context_window: 1000000, input_price: 0.55, cache_read_price: 0.055, cache_write_price: 0.55, output_price: 1.65 },
  "glm-5.3-flash": { id: "glm-5.3-flash", context_window: 1000000, input_price: 0.28, cache_read_price: 0.028, cache_write_price: 0.28, output_price: 0.84 },
  "glm-5.3-flashx": { id: "glm-5.3-flashx", context_window: 1000000, input_price: 0.28, cache_read_price: 0.028, cache_write_price: 0.28, output_price: 0.84 },
  "glm-5.2": { id: "glm-5.2", context_window: 1000000, input_price: 0.55, cache_read_price: 0.055, cache_write_price: 0.55, output_price: 1.65 },

  // ---------- DeepSeek（参考） ----------
  "deepseek-chat": { id: "deepseek-chat", context_window: 131072, input_price: 0.27, cache_read_price: 0.07, cache_write_price: 0.27, output_price: 1.1 },
  "deepseek-reasoner": { id: "deepseek-reasoner", context_window: 131072, input_price: 0.55, cache_read_price: 0.14, cache_write_price: 0.55, output_price: 2.19 },

  // ---------- OpenAI（参考） ----------
  "gpt-4o": { id: "gpt-4o", context_window: 128000, input_price: 2.5, cache_read_price: 1.25, cache_write_price: 3.75, output_price: 10 },
  "gpt-4o-mini": { id: "gpt-4o-mini", context_window: 128000, input_price: 0.15, cache_read_price: 0.075, cache_write_price: 0.225, output_price: 0.6 },
  "gpt-4.1": { id: "gpt-4.1", context_window: 1000000, input_price: 2.0, cache_read_price: 0.5, cache_write_price: 3.0, output_price: 8.0 },
  "gpt-4.1-mini": { id: "gpt-4.1-mini", context_window: 1000000, input_price: 0.4, cache_read_price: 0.1, cache_write_price: 0.6, output_price: 1.6 },

  // ---------- Anthropic（参考） ----------
  "claude-sonnet-4-5": { id: "claude-sonnet-4-5", context_window: 200000, input_price: 3.0, cache_read_price: 0.3, cache_write_price: 3.75, output_price: 15.0 },
  "claude-haiku-4-5": { id: "claude-haiku-4-5", context_window: 200000, input_price: 1.0, cache_read_price: 0.1, cache_write_price: 1.25, output_price: 5.0 },
  "claude-opus-4-5": { id: "claude-opus-4-5", context_window: 200000, input_price: 5.0, cache_read_price: 0.5, cache_write_price: 6.25, output_price: 25.0 },

  // ---------- Kimi / Moonshot（参考） ----------
  "kimi-k2-thinking": { id: "kimi-k2-thinking", context_window: 131072, input_price: 0.6, cache_read_price: 0.15, cache_write_price: 0.6, output_price: 2.5 },
  "kimi-latest": { id: "kimi-latest", context_window: 131072, input_price: 0.6, cache_read_price: 0.15, cache_write_price: 0.6, output_price: 2.5 },
};

export function lookupKnownModel(modelId: string): KnownModelInfo | null {
  return KNOWN_MODELS[modelId] ?? null;
}
