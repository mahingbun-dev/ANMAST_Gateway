import type { Provider } from "../types.js";
import type { ChatMessage, ToolCall, ToolDefinition } from "../types.js";
import type { ProviderAdapter, NormalizedRequest, ChatResult, Usage } from "./types.js";
import { joinUrl, buildHeaders, postJson, postStream } from "./http.js";

function toAnthropicContent(m: ChatMessage): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  if (m.contentArray) {
    for (const part of m.contentArray) {
      const p = part as { type?: string; text?: string; image_url?: { url?: string } };
      if (p.type === "text" && p.text) blocks.push({ type: "text", text: p.text });
      else if (p.type === "image_url" && p.image_url?.url) {
        blocks.push({
          type: "image",
          source: { type: "url", url: p.image_url.url },
        });
      } else blocks.push({ type: "text", text: JSON.stringify(p) });
    }
  } else if (m.content) {
    blocks.push({ type: "text", text: m.content });
  }
  if (m.tool_calls?.length) {
    for (const tc of m.tool_calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = { _raw: tc.function.arguments };
      }
      blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }
  return blocks;
}

function buildBody(req: NormalizedRequest): Record<string, unknown> {
  // 分离 system 消息与普通消息
  const systemParts: string[] = [];
  if (req.system) systemParts.push(req.system);
  const messages: Record<string, unknown>[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      // 工具结果 → user 消息的 tool_result 块
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content ?? "" }],
      });
      continue;
    }
    messages.push({ role: m.role, content: toAnthropicContent(m) });
  }

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    messages,
    stream: req.stream,
  };
  if (systemParts.length) body.system = systemParts.join("\n\n");
  if (req.tools?.length) {
    body.tools = req.tools.map((t: ToolDefinition) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }
  if (req.temperature != null) body.temperature = req.temperature;
  if (req.topP != null) body.top_p = req.topP;
  if (req.stop) body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  if (req.extra) {
    const { __provider, ...rest } = req.extra;
    void __provider;
    Object.assign(body, rest);
  }
  return body;
}

export const anthropicAdapter: ProviderAdapter = {
  async chat(req: NormalizedRequest): Promise<ChatResult> {
    const provider = req.extra?.__provider as Provider;
    const url = joinUrl(provider.base_url, "v1/messages");
    const headers = buildHeaders(provider, provider.api_key);
    headers.set("x-api-key", provider.api_key);
    headers.set("anthropic-version", "2023-06-01");
    const body = buildBody({ ...req, stream: false });
    const data = (await postJson(url, headers, body)) as {
      id?: string;
      stop_reason?: string;
      content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    const texts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text" && block.text) texts.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? "",
          type: "function",
          function: {
            name: block.name ?? "",
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }
    const u = data.usage ?? {};
    return {
      id: data.id,
      finishReason: data.stop_reason ?? "end_turn",
      usage: {
        promptTokens: u.input_tokens ?? 0,
        completionTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      },
      message: {
        role: "assistant",
        content: texts.join("") || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    };
  },

  async stream(req: NormalizedRequest): Promise<AsyncIterable<Uint8Array>> {
    const provider = req.extra?.__provider as Provider;
    const url = joinUrl(provider.base_url, "v1/messages");
    const headers = buildHeaders(provider, provider.api_key);
    headers.set("x-api-key", provider.api_key);
    headers.set("anthropic-version", "2023-06-01");
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
    let currentEvent = "";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        if (currentEvent === "message_start") {
          const u = obj.message?.usage ?? {};
          usage.promptTokens = u.input_tokens ?? 0;
          usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
          usage.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
        } else if (currentEvent === "message_delta") {
          usage.completionTokens = obj.usage?.output_tokens ?? usage.completionTokens;
        } else if (currentEvent === "content_block_delta") {
          if (obj.delta?.type === "text_delta" && obj.delta.text) parts.push(obj.delta.text);
        } else if (currentEvent === "content_block_start") {
          // 不处理
        }
      } catch {
        /* ignore */
      }
    }
    return { usage, content: parts.join("") };
  },
};
