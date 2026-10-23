import type { ChatMessage } from "./types.js";
import type { Usage, NormalizedRequest } from "./providers/types.js";
import { getAdapterForProtocol, getUpstreamProtocol } from "./providers/index.js";
import { listEnabledModels, type ModelWithProvider } from "./routing/index.js";
import { calcCost, logMessages, conversationTitle } from "./gateway/service.js";
import { markActive, markDone } from "./gateway/live.js";
import {
  insertRequest,
  updateRequest,
  upsertConversation,
  bumpConversation,
} from "./db/repos/logs.js";
import { genId, fakeOpenAIStream } from "./gateway/respond.js";

function safeJson(x: unknown): string | null {
  try {
    return JSON.stringify(x);
  } catch {
    return null;
  }
}

export function resolveTestModel(modelId: string): ModelWithProvider | undefined {
  return listEnabledModels().find((x) => x.model.id === modelId);
}

export interface ModelTestResult {
  content: string | null;
  usage: Usage;
  modelName: string;
  id?: string;
}

/**
 * 模型对话测试：直接调用指定（启用）模型，仅对话、不注入工具/路由/Skill。
 * 同时把本次调用记入「调用记录」，把消息记入「对话历史」。
 */
export async function modelTestChat(
  modelId: string,
  messages: ChatMessage[],
  conversationId: string,
  clientIp: string | null,
): Promise<ModelTestResult> {
  const cand = resolveTestModel(modelId);
  if (!cand) throw new Error("模型不存在或已停用");
  const started = Date.now();
  const requestId = genId("req");
  markActive(requestId);

  insertRequest({
    id: requestId,
    api_key_id: null,
    protocol: "openai",
    endpoint: "/v1/model-test/chat",
    model_requested: modelId,
    model_used: "",
    provider_id: cand.model.provider_id,
    tier_id: null,
    tier_source: null,
    conversation_id: conversationId,
    status: "streaming",
    error: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost: 0,
    latency_ms: 0,
    first_token_ms: null,
    upstream_protocol: null,
    input_tokens_before: null,
    input_tokens_after: null,
    request_json: safeJson({ model_id: modelId, messages }),
    response_json: null,
    client_ip: clientIp,
    created_at: started,
  });
  upsertConversation({
    id: conversationId,
    api_key_id: null,
    title: conversationTitle(messages),
    model: modelId,
  });

  try {
    const upstream = getUpstreamProtocol(cand.provider, "openai");
    const adapter = getAdapterForProtocol(upstream);
    const req: NormalizedRequest = {
      model: cand.model.name,
      messages,
      stream: false,
      extra: { __provider: cand.provider },
    };
    const res = await adapter.chat(req);
    const cost = calcCost(cand.model, res.usage);
    const totalTokens = res.usage.promptTokens + res.usage.completionTokens;
    updateRequest(requestId, {
      model_used: cand.model.name,
      provider_id: cand.model.provider_id,
      upstream_protocol: upstream,
      status: "success",
      prompt_tokens: res.usage.promptTokens,
      completion_tokens: res.usage.completionTokens,
      total_tokens: totalTokens,
      cache_read_tokens: res.usage.cacheReadTokens,
      cache_creation_tokens: res.usage.cacheCreationTokens,
      cost,
      latency_ms: Date.now() - started,
      response_json: safeJson({ content: res.message.content, usage: res.usage }),
    });
    const assistant: ChatMessage = { role: "assistant", content: res.message.content };
    const loggedCount = logMessages(messages, [], assistant, requestId, conversationId, started);
    bumpConversation(conversationId, loggedCount);
    return { content: res.message.content, usage: res.usage, modelName: cand.model.name, id: res.id };
  } catch (e) {
    updateRequest(requestId, {
      status: "error",
      error: (e as Error).message ?? "内部错误",
      latency_ms: Date.now() - started,
    });
    throw e;
  } finally {
    markDone(requestId);
  }
}

/** 流式版：后台执行 modelTestChat 后按 OpenAI SSE 重放 */
export async function* modelTestStream(
  modelId: string,
  messages: ChatMessage[],
  conversationId: string,
  clientIp: string | null,
): AsyncIterable<string> {
  const queue: string[] = [];
  let finished = false;
  let waiter: (() => void) | undefined;

  const push = (s: string) => {
    queue.push(s);
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w();
    }
  };

  const task = (async () => {
    try {
      const result = await modelTestChat(modelId, messages, conversationId, clientIp);
      const final = { content: result.content, toolCalls: undefined, usage: result.usage };
      const meta = {
        model: result.modelName,
        id: result.id ?? genId("chatcmpl"),
        created: Math.floor(Date.now() / 1000),
        protocol: "openai" as const,
      };
      for await (const chunk of fakeOpenAIStream(final, meta)) push(chunk);
    } catch (e) {
      push(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`);
      push(`data: [DONE]\n\n`);
    } finally {
      finished = true;
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        w();
      }
    }
  })();

  for (;;) {
    while (queue.length === 0 && !finished) {
      await new Promise<void>((r) => {
        waiter = r;
      });
    }
    while (queue.length) yield queue.shift()!;
    if (finished) break;
  }
  await task;
}
