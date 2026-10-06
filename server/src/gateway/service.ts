import type { Provider, ModelConfig, ChatMessage, ToolDefinition, ToolCall } from "../types.js";
import type { Usage, NormalizedRequest } from "../providers/types.js";
import { getAdapter } from "../providers/index.js";
import { resolveModel, autoDetectComplexity, type ModelWithProvider } from "../routing/index.js";
import { resolveActiveSkills, buildSkillSystemPrompt, getSkillToolNames } from "../skills/manager.js";
import { listAllTools, findToolOwner, callToolOnServer } from "../mcp/manager.js";
import { getSetting } from "../db/index.js";
import {
  insertRequest,
  updateRequest,
  insertMessages,
  upsertConversation,
  bumpConversation,
} from "../db/repos/logs.js";
import type { ParsedRequest } from "./parse.js";
import {
  genId,
  openaiJson,
  anthropicJson,
  fakeOpenAIStream,
  fakeAnthropicStream,
  type FinalAnswer,
} from "./respond.js";
import { logger } from "../logger.js";

export type GatewayResult =
  | { type: "json"; statusCode: number; headers: Record<string, string>; body: unknown }
  | {
      type: "stream";
      statusCode: number;
      headers: Record<string, string>;
      body: AsyncIterable<string | Uint8Array>;
    };

export interface ProcessInput {
  protocol: "openai" | "anthropic";
  endpoint: string;
  parsed: ParsedRequest;
  rawBody: unknown;
  apiKeyId: string | null;
  clientIp: string | null;
}

interface RunResult {
  candidate: ModelWithProvider;
  message: ChatMessage;
  usage: Usage;
  id?: string;
  finishReason: string;
  toolMessages: ChatMessage[];
}

function calcCost(model: ModelConfig, usage: Usage): number {
  const inPrice = model.input_price ?? 0;
  const outPrice = model.output_price ?? 0;
  return (usage.promptTokens / 1_000_000) * inPrice + (usage.completionTokens / 1_000_000) * outPrice;
}

function sumUsage(usages: Usage[]): Usage {
  const u: Usage = { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const x of usages) {
    u.promptTokens += x.promptTokens;
    u.completionTokens += x.completionTokens;
    u.cacheReadTokens += x.cacheReadTokens;
    u.cacheCreationTokens += x.cacheCreationTokens;
  }
  return u;
}

function dedupeTools(tools: ToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  return tools.filter((t) => {
    if (seen.has(t.function.name)) return false;
    seen.add(t.function.name);
    return true;
  });
}

function safeJson(x: unknown): string | null {
  try {
    return JSON.stringify(x);
  } catch {
    return null;
  }
}

function conversationTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content);
  const t = (first?.content ?? "").replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "新对话";
}

function buildRequest(
  cand: ModelWithProvider,
  parsed: ParsedRequest,
  tools: ToolDefinition[],
  skillPrompt: string,
  stream: boolean,
): NormalizedRequest {
  const req: NormalizedRequest = {
    model: cand.model.name,
    messages: parsed.messages,
    stream,
    temperature: parsed.temperature ?? undefined,
    topP: parsed.topP ?? undefined,
    maxTokens: parsed.maxTokens ?? undefined,
    stop: parsed.stop ?? undefined,
    system: skillPrompt || undefined,
    extra: { __provider: cand.provider, ...(parsed.extra ?? {}) },
  };
  if (tools.length) req.tools = tools;
  return req;
}

/** 单次调用（无网关工具循环） */
async function runOnce(
  cand: ModelWithProvider,
  parsed: ParsedRequest,
  tools: ToolDefinition[],
  skillPrompt: string,
): Promise<RunResult> {
  const adapter = getAdapter(cand.provider);
  const req = buildRequest(cand, parsed, tools, skillPrompt, false);
  const res = await adapter.chat(req);
  return {
    candidate: cand,
    message: res.message,
    usage: res.usage,
    id: res.id,
    finishReason: res.finishReason,
    toolMessages: [],
  };
}

/** 带网关工具循环的调用 */
async function runAgentLoop(
  cand: ModelWithProvider,
  parsed: ParsedRequest,
  tools: ToolDefinition[],
  gatewayToolNames: Set<string>,
  skillPrompt: string,
): Promise<RunResult> {
  const adapter = getAdapter(cand.provider);
  const maxSteps = getSetting<number>("max_tool_steps", 8) ?? 8;
  const messages: ChatMessage[] = [...parsed.messages];
  const toolMessages: ChatMessage[] = [];
  const usages: Usage[] = [];
  let lastId: string | undefined;

  for (let step = 0; step < maxSteps; step++) {
    const req = buildRequest(cand, { ...parsed, messages }, tools, skillPrompt, false);
    const res = await adapter.chat(req);
    usages.push(res.usage);
    lastId = res.id;

    const calls = res.message.tool_calls ?? [];
    if (!calls.length) {
      return {
        candidate: cand,
        message: res.message,
        usage: sumUsage(usages),
        id: lastId,
        finishReason: res.finishReason,
        toolMessages,
      };
    }

    const gatewayCalls = calls.filter((tc) => gatewayToolNames.has(tc.function.name));
    const allGateway = gatewayCalls.length === calls.length;

    if (!allGateway) {
      // 含客户端自有工具调用 → 交还客户端处理
      return {
        candidate: cand,
        message: res.message,
        usage: sumUsage(usages),
        id: lastId,
        finishReason: res.finishReason,
        toolMessages,
      };
    }

    // 执行网关工具并回填结果
    messages.push({ role: "assistant", content: res.message.content, tool_calls: calls });
    for (const tc of gatewayCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      let content: string;
      try {
        const owner = await findToolOwner(tc.function.name);
        if (!owner) {
          content = `工具 ${tc.function.name} 未找到可执行的 MCP Server`;
        } else {
          const r = await callToolOnServer(owner, tc.function.name, args);
          content = r.content;
        }
      } catch (e) {
        content = `工具执行错误：${(e as Error).message}`;
      }
      const tm: ChatMessage = {
        role: "tool",
        content,
        tool_call_id: tc.id,
      };
      messages.push(tm);
      toolMessages.push(tm);
    }
  }

  // 达到最大步数仍未结束
  return {
    candidate: cand,
    message: {
      role: "assistant",
      content: "达到最大工具调用步数限制，任务未完成。",
    },
    usage: sumUsage(usages),
    id: lastId,
    finishReason: "stop",
    toolMessages,
  };
}

async function runWithRetry(
  candidates: ModelWithProvider[],
  fn: (cand: ModelWithProvider) => Promise<RunResult>,
): Promise<RunResult> {
  let lastErr: unknown;
  for (const cand of candidates) {
    try {
      return await fn(cand);
    } catch (e) {
      lastErr = e;
      logger.warn(`模型 ${cand.model.name} 调用失败，尝试下一个候选`, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function errorBody(protocol: "openai" | "anthropic", message: string): unknown {
  if (protocol === "openai") {
    return { error: { message, type: "gateway_error", code: "gateway_error" } };
  }
  return { type: "error", error: { type: "gateway_error", message } };
}

export async function processChat(input: ProcessInput): Promise<GatewayResult> {
  const { protocol, parsed, apiKeyId, clientIp } = input;
  const started = Date.now();
  const requestId = genId("req");
  const conversationId = parsed.conversationId || genId("conv");

  // 1. 路由解析
  const isDirect =
    !!parsed.model && parsed.model !== "auto" && parsed.model !== "router" &&
    resolveModel(parsed.model, undefined).tierSource === null;

  let explicitTier: string | undefined = parsed.complexity;
  let viaAuto = false;
  if (!isDirect && !explicitTier && getSetting<boolean>("auto_detect_enabled", true)) {
    const detected = await autoDetectComplexity(parsed.messages);
    if (detected) {
      explicitTier = detected;
      viaAuto = true;
    }
  }
  let target = resolveModel(isDirect ? parsed.model : "auto", explicitTier);
  if (viaAuto) target = { ...target, tierSource: "auto", viaAutoDetect: true };
  if (explicitTier) target.usedComplexity = explicitTier;

  // 2. Skill 与工具
  const activeSkills = resolveActiveSkills(parsed.skills, parsed.messages);
  const skillPrompt = buildSkillSystemPrompt(activeSkills);
  const skillToolNames = getSkillToolNames(activeSkills);

  let gatewayTools: ToolDefinition[] = [];
  const mcpMode = getSetting<string>("mcp_tools_mode", "on_demand");
  const wantGateway =
    mcpMode === "auto" || parsed.gatewayToolsRequested || skillToolNames.length > 0;
  if (wantGateway) {
    try {
      const allMcp = await listAllTools();
      gatewayTools = skillToolNames.length
        ? allMcp.filter((t) => skillToolNames.includes(t.function.name))
        : allMcp;
    } catch (e) {
      logger.warn("获取 MCP 工具失败", e);
    }
  }
  const allTools = dedupeTools([...parsed.clientTools, ...gatewayTools]);
  const gatewayToolNames = new Set(gatewayTools.map((t) => t.function.name));
  const hasGatewayTools = gatewayTools.length > 0;
  const modelRequested = parsed.model ?? "auto";

  // 3. 初始记录
  insertRequest({
    id: requestId,
    api_key_id: apiKeyId,
    protocol,
    endpoint: parsed.endpoint,
    model_requested: modelRequested,
    model_used: "",
    provider_id: null,
    tier_id: target.tierId,
    tier_source: target.tierSource,
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
    request_json: safeJson(input.rawBody),
    response_json: null,
    client_ip: clientIp,
    created_at: started,
  });
  upsertConversation({
    id: conversationId,
    api_key_id: apiKeyId,
    title: conversationTitle(parsed.messages),
    model: modelRequested,
  });

  // 4. 执行
  try {
    if (hasGatewayTools) {
      const run = await runWithRetry(target.candidates, (c) =>
        runAgentLoop(c, parsed, allTools, gatewayToolNames, skillPrompt),
      );
      return finalizeSuccess(run);
    }
    if (parsed.stream) {
      // 仅当客户端协议与上游供应商协议一致时才透传原始流，否则内部非流式调用后按客户端协议重放
      const streamCompat = protocol === "openai" ? "openai" : "anthropic";
      const canPassthrough = target.candidates.every((c) => c.provider.type === streamCompat);
      if (canPassthrough) {
        return {
          type: "stream",
          statusCode: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Conversation-Id": conversationId,
            "X-Request-Id": requestId,
          },
          body: streamPassthrough({
            candidates: target.candidates,
            parsed,
            allTools,
            skillPrompt,
            requestId,
            conversationId,
            protocol,
            started,
          }),
        };
      }
      const run = await runWithRetry(target.candidates, (c) =>
        runOnce(c, parsed, allTools, skillPrompt),
      );
      return finalizeSuccess(run);
    }
    const run = await runWithRetry(target.candidates, (c) =>
      runOnce(c, parsed, allTools, skillPrompt),
    );
    return finalizeSuccess(run);
  } catch (e) {
    logger.error("网关处理失败", e);
    updateRequest(requestId, {
      status: "error",
      error: (e as Error).message ?? "内部错误",
      latency_ms: Date.now() - started,
    });
    return {
      type: "json",
      statusCode: 502,
      headers: {
        "Content-Type": "application/json",
        "X-Conversation-Id": conversationId,
        "X-Request-Id": requestId,
      },
      body: errorBody(protocol, (e as Error).message ?? "内部错误"),
    };
  }

  function finalizeSuccess(run: RunResult): GatewayResult {
    const model = run.candidate.model;
    const cost = calcCost(model, run.usage);
    const totalTokens = run.usage.promptTokens + run.usage.completionTokens;
    updateRequest(requestId, {
      model_used: model.name,
      provider_id: model.provider_id,
      status: "success",
      prompt_tokens: run.usage.promptTokens,
      completion_tokens: run.usage.completionTokens,
      total_tokens: totalTokens,
      cache_read_tokens: run.usage.cacheReadTokens,
      cache_creation_tokens: run.usage.cacheCreationTokens,
      cost,
      latency_ms: Date.now() - started,
      response_json: safeJson({ message: run.message, usage: run.usage }),
    });
    logMessages(parsed.messages, run.toolMessages, run.message, requestId, conversationId, started);
    bumpConversation(conversationId, parsed.messages.length + run.toolMessages.length + 1);

    const final: FinalAnswer = {
      content: run.message.content,
      toolCalls: run.message.tool_calls,
      usage: run.usage,
    };
    const meta = {
      model: model.name,
      id: run.id ?? genId(protocol === "openai" ? "chatcmpl" : "msg"),
      created: Math.floor(Date.now() / 1000),
      protocol,
    };

    if (parsed.stream) {
      const gen =
        protocol === "openai"
          ? fakeOpenAIStream(final, meta)
          : fakeAnthropicStream(final, meta);
      return {
        type: "stream",
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Conversation-Id": conversationId,
          "X-Request-Id": requestId,
          "X-Model": model.name,
        },
        body: gen,
      };
    }
    const body =
      protocol === "openai" ? openaiJson(final, meta) : anthropicJson(final, meta);
    return {
      type: "json",
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Conversation-Id": conversationId,
        "X-Request-Id": requestId,
        "X-Model": model.name,
      },
      body,
    };
  }
}

interface PassthroughCtx {
  candidates: ModelWithProvider[];
  parsed: ParsedRequest;
  allTools: ToolDefinition[];
  skillPrompt: string;
  requestId: string;
  conversationId: string;
  protocol: "openai" | "anthropic";
  started: number;
}

/** 流式透传：转发上游字节流，同时缓冲文本用于统计 */
async function* streamPassthrough(ctx: PassthroughCtx): AsyncIterable<string | Uint8Array> {
  let lastErr: Error | undefined;
  for (const cand of ctx.candidates) {
    try {
      const adapter = getAdapter(cand.provider);
      const req = buildRequest(cand, ctx.parsed, ctx.allTools, ctx.skillPrompt, true);
      const stream = await adapter.stream(req);
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of stream) {
        buffered += decoder.decode(chunk, { stream: true });
        yield chunk;
      }
      buffered += decoder.decode();
      const { usage, content } = adapter.extractStreamUsage(buffered);
      const cost = calcCost(cand.model, usage);
      updateRequest(ctx.requestId, {
        model_used: cand.model.name,
        provider_id: cand.model.provider_id,
        status: "success",
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.promptTokens + usage.completionTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_creation_tokens: usage.cacheCreationTokens,
        cost,
        latency_ms: Date.now() - ctx.started,
        response_json: safeJson({ content, usage }),
      });
      const assistant: ChatMessage = { role: "assistant", content: content || null };
      logMessages(ctx.parsed.messages, [], assistant, ctx.requestId, ctx.conversationId, ctx.started);
      bumpConversation(ctx.conversationId, ctx.parsed.messages.length + 1);
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      logger.warn(`模型 ${cand.model.name} 流式调用失败，尝试下一个候选`, e);
    }
  }
  // 全部失败：输出错误事件
  updateRequest(ctx.requestId, {
    status: "error",
    error: lastErr?.message ?? "上游调用失败",
    latency_ms: Date.now() - ctx.started,
  });
  const msg = lastErr?.message ?? "上游调用失败";
  if (ctx.protocol === "openai") {
    yield `data: ${JSON.stringify({ error: { message: msg, type: "gateway_error" } })}\n\n`;
    yield `data: [DONE]\n\n`;
  } else {
    yield `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "gateway_error", message: msg } })}\n\n`;
  }
}

function logMessages(
  input: ChatMessage[],
  toolMessages: ChatMessage[],
  assistant: ChatMessage,
  requestId: string,
  conversationId: string,
  createdAt: number,
): void {
  const toLog = (m: ChatMessage) => ({
    request_id: requestId,
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
    name: m.name ?? null,
    tool_calls: m.tool_calls ? safeJson(m.tool_calls) : null,
    tool_call_id: m.tool_call_id ?? null,
    created_at: createdAt,
  });
  const rows = [
    ...input.map(toLog),
    ...toolMessages.map(toLog),
    toLog(assistant),
  ];
  insertMessages(rows);
}
