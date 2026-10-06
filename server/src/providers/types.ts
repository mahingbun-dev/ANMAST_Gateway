import type { ChatMessage, ToolDefinition } from "../types.js";

/** 归一化的上游请求（网关内部统一表示，各适配器转换为自身协议） */
export interface NormalizedRequest {
  model: string; // 上游真实模型名
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream: boolean;
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  stop?: string | string[] | null;
  system?: string | null; // 附加系统提示（skill 注入等）
  extra?: Record<string, unknown>; // 透传字段
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
  finishReason: string;
  id?: string;
}

/** 供应商适配器接口 */
export interface ProviderAdapter {
  /** 非流式单次调用 */
  chat(req: NormalizedRequest): Promise<ChatResult>;
  /** 流式调用：返回原始上游字节流（用于透传） */
  stream(req: NormalizedRequest): Promise<AsyncIterable<Uint8Array>>;
  /** 从流式文本缓冲区中提取用量与文本（用于日志/成本） */
  extractStreamUsage(text: string): { usage: Usage; content: string };
}
