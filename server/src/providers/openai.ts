import type { Provider } from "../types.js";
import type { ChatMessage, ToolCall, ToolDefinition } from "../types.js";
import type { ProviderAdapter, NormalizedRequest, ChatResult, Usage } from "./types.js";
import { joinUrl, buildHeaders, postJson, postStream } from "./http.js";

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };
  if (m.contentArray) out.content = m.contentArray;
  else if (m.content !== null && m.content !== undefined) out.content = m.content;
  if (m.name) out.name = m.name;
  if (m.tool_calls?.length) {
    out.tool_calls = m.tool_calls.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  return out;
}

function buildBody(req: NormalizedRequest): Record<string, unknown> {
  const messages = req.messages.map(toOpenAIMessage);
  if (req.system) {
    messages.unshift({ role: "system", content: req.system });
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: req.stream,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t: ToolDefinition) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters ?? { type: "object", properties: {} },
      },
    }));
  }
  if (req.temperature != null) body.temperature = req.temperature;
  if (req.topP != null) body.top_p = req.topP;
  if (req.maxTokens != null) body.max_tokens = req.maxTokens;
  if (req.stop) body.stop = req.stop;
  if (req.stream) {
    // 让上游在流末尾附带 usage，便于成本统计
    body.stream_options = { include_usage: true };
  }
  if (req.extra) Object.assign(body, req.extra);
  return body;
}

function parseUsage(raw: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}): Usage {
  return {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    cacheReadTokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreationTokens: 0,
  };
}

export const openaiAdapter: ProviderAdapter = {
  async chat(req: NormalizedRequest): Promise<ChatResult> {
    const provider = req.extra?.__provider as Provider;
    const url = joinUrl(provider.base_url, "chat/completions");
    const headers = buildHeaders(provider, `Bearer ${provider.api_key}`);
    const body = buildBody({ ...req, stream: false });
    const data = (await postJson(url, headers, body)) as {
      id?: string;
      choices?: { message?: { role?: string; content?: string | null; tool_calls?: unknown[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };

    const choice = data.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
      ? (msg.tool_calls as ToolCall[]).map((tc) => ({
          id: (tc as { id?: string }).id ?? "",
          type: "function",
          function: {
            name: (tc as { function?: { name?: string } }).function?.name ?? "",
            arguments:
              (tc as { function?: { arguments?: string } }).function?.arguments ?? "{}",
          },
        }))
      : [];

    return {
      id: data.id,
      finishReason: choice.finish_reason ?? "stop",
      usage: parseUsage(data.usage ?? {}),
      message: {
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    };
  },

  async stream(req: NormalizedRequest): Promise<AsyncIterable<Uint8Array>> {
    const provider = req.extra?.__provider as Provider;
    const url = joinUrl(provider.base_url, "chat/completions");
    const headers = buildHeaders(provider, `Bearer ${provider.api_key}`);
    const body = buildBody({ ...req, stream: true });
    const res = await postStream(url, headers, body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (res.body as any) as AsyncIterable<Uint8Array>;
  },

  extractStreamUsage(text: string): { usage: Usage; content: string } {
    const usage: Usage = {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const parts: string[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        const choice = obj.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) parts.push(delta.content);
        if (choice?.finish_reason === "tool_calls" && delta?.tool_calls) {
          // 记录工具调用意图（此处仅用于日志，完整解析由上层负责）
        }
        if (obj.usage) {
          usage.promptTokens = obj.usage.prompt_tokens ?? 0;
          usage.completionTokens = obj.usage.completion_tokens ?? 0;
          usage.cacheReadTokens = obj.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
      } catch {
        /* ignore */
      }
    }
    return { usage, content: parts.join("") };
  },
};
