import type { Usage } from "../providers/types.js";
import type { ToolCall } from "../types.js";

export interface FinalAnswer {
  content: string | null;
  toolCalls?: ToolCall[];
  usage: Usage;
}

export interface ResponseMeta {
  model: string;
  id: string;
  created: number;
  protocol: "openai" | "anthropic";
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- OpenAI 非流式 ----------

export function openaiJson(final: FinalAnswer, meta: ResponseMeta): Record<string, unknown> {
  const message: Record<string, unknown> = { role: "assistant", content: final.content ?? "" };
  if (final.toolCalls?.length) {
    message.tool_calls = final.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }
  return {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: final.toolCalls?.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: final.usage.promptTokens,
      completion_tokens: final.usage.completionTokens,
      total_tokens: final.usage.promptTokens + final.usage.completionTokens,
    },
  };
}

// ---------- OpenAI 模拟流 ----------

function chunkString(s: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export async function* fakeOpenAIStream(
  final: FinalAnswer,
  meta: ResponseMeta,
): AsyncIterable<string> {
  const base = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
  };
  yield `data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  })}\n\n`;
  const text = final.content ?? "";
  for (const piece of chunkString(text)) {
    yield `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    })}\n\n`;
  }
  if (final.toolCalls?.length) {
    yield `data: ${JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: final.toolCalls.map((tc, i) => ({
              index: i,
              id: tc.id,
              type: "function",
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
          finish_reason: "tool_calls",
        },
      ],
    })}\n\n`;
  }
  yield `data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: final.toolCalls?.length ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: final.usage.promptTokens,
      completion_tokens: final.usage.completionTokens,
      total_tokens: final.usage.promptTokens + final.usage.completionTokens,
    },
  })}\n\n`;
  yield `data: [DONE]\n\n`;
}

// ---------- Anthropic 非流式 ----------

export function anthropicJson(final: FinalAnswer, meta: ResponseMeta): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  if (final.content) content.push({ type: "text", text: final.content });
  if (final.toolCalls?.length) {
    for (const tc of final.toolCalls) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = { _raw: tc.function.arguments };
      }
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }
  return {
    id: meta.id,
    type: "message",
    role: "assistant",
    model: meta.model,
    content,
    stop_reason: final.toolCalls?.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: final.usage.promptTokens,
      output_tokens: final.usage.completionTokens,
      cache_creation_input_tokens: final.usage.cacheCreationTokens,
      cache_read_input_tokens: final.usage.cacheReadTokens,
    },
  };
}

// ---------- Anthropic 模拟流 ----------

export async function* fakeAnthropicStream(
  final: FinalAnswer,
  meta: ResponseMeta,
): AsyncIterable<string> {
  const inputTokens = final.usage.promptTokens;
  yield `event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: meta.id,
      type: "message",
      role: "assistant",
      model: meta.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    },
  })}\n\n`;

  if (final.toolCalls?.length) {
    // 工具调用：逐个输出 tool_use 内容块
    for (let i = 0; i < final.toolCalls.length; i++) {
      const tc = final.toolCalls[i];
      let inputObj: unknown = {};
      try {
        inputObj = JSON.parse(tc.function.arguments || "{}");
      } catch {
        inputObj = { _raw: tc.function.arguments };
      }
      const inputStr = JSON.stringify(inputObj);
      yield `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: i,
        content_block: { type: "tool_use", id: tc.id, name: tc.function.name, input: {} },
      })}\n\n`;
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: i,
        delta: { type: "input_json_delta", partial_json: inputStr },
      })}\n\n`;
      yield `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: i,
      })}\n\n`;
    }
  } else {
    yield `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n\n`;
    const text = final.content ?? "";
    for (const piece of chunkString(text)) {
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: piece },
      })}\n\n`;
    }
    yield `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: 0,
    })}\n\n`;
  }

  yield `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: final.toolCalls?.length ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: final.usage.completionTokens },
  })}\n\n`;
  yield `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
}
