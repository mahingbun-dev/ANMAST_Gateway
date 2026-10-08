import type { ChatMessage, ToolCall, ToolDefinition } from "../types.js";

// 这些字段由网关处理/适配器显式设置，或为协议专用字段，不应透传给上游
const RESERVED = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "max_tokens",
  "top_p",
  "stop",
  "tools",
  "stream_options",
  "system",
  "stop_sequences",
  "complexity",
  "skills",
  "conversation_id",
  "session_id",
  "gateway_tools",
  "__gateway",
  // Anthropic / Claude Code 专用字段，不透传给 OpenAI 兼容上游
  "thinking",
  "context_management",
  "output_config",
  "metadata",
  "tool_choice",
]);

function stripReserved(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!RESERVED.has(k)) out[k] = v;
  }
  return out;
}

/** 从请求 metadata 中提取会话 id（Claude Code 把 session_id 藏在 metadata.user_id 的 JSON 字符串里） */
function extractSessionId(body: Record<string, unknown>): string | undefined {
  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (!metadata) return undefined;
  const userId = metadata.user_id;
  if (typeof userId === "string") {
    try {
      const obj = JSON.parse(userId) as { session_id?: string };
      if (obj.session_id) return obj.session_id;
    } catch {
      /* ignore */
    }
  }
  if (typeof metadata.session_id === "string") return metadata.session_id;
  if (typeof metadata.conversation_id === "string") return metadata.conversation_id;
  return undefined;
}

export interface ParsedRequest {
  protocol: "openai" | "anthropic";
  endpoint: string;
  messages: ChatMessage[];
  model?: string;
  complexity?: string;
  skills?: string[];
  conversationId?: string;
  clientTools: ToolDefinition[];
  gatewayToolsRequested: boolean;
  stream: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  stop?: string | string[] | null;
  extra?: Record<string, unknown>;
}

function normContent(content: unknown): { content: string | null; contentArray?: unknown[] } {
  if (content == null) return { content: null };
  if (typeof content === "string") return { content };
  if (Array.isArray(content)) {
    // 尝试提取文本用于复杂度判定与日志
    const text = content
      .map((p) => (typeof p === "object" && p && "text" in (p as object) ? (p as { text: string }).text : ""))
      .join("");
    return { content: text || null, contentArray: content };
  }
  return { content: JSON.stringify(content) };
}

function normToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ToolCall[] = [];
  for (const tc of raw as Record<string, unknown>[]) {
    const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
    out.push({
      id: (tc.id as string) ?? `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function",
      function: {
        name: fn.name ?? "",
        arguments: fn.arguments ?? "{}",
      },
    });
  }
  return out;
}

function normOpenAITools(raw: unknown): ToolDefinition[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((t) => {
      const fn = (t.function ?? {}) as {
        name?: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
      return {
        type: "function" as const,
        function: {
          name: fn.name ?? "",
          description: fn.description ?? "",
          parameters: fn.parameters ?? { type: "object", properties: {} },
        },
      };
    })
    .filter((t) => t.function.name);
}

function normAnthropicTools(raw: unknown): ToolDefinition[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((t) => ({
      type: "function" as const,
      function: {
        name: (t.name as string) ?? "",
        description: (t.description as string) ?? "",
        parameters: (t.input_schema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
      },
    }))
    .filter((t) => t.function.name);
}

export function parseOpenAIRequest(body: Record<string, unknown>, endpoint: string): ParsedRequest {
  const messages: ChatMessage[] = [];
  for (const m of (body.messages as Record<string, unknown>[]) ?? []) {
    const { content, contentArray } = normContent(m.content);
    messages.push({
      role: (m.role as string) ?? "user",
      content,
      contentArray,
      name: m.name as string | undefined,
      tool_calls: normToolCalls(m.tool_calls),
      tool_call_id: m.tool_call_id as string | undefined,
    });
  }
  const gw = (body.__gateway as Record<string, unknown>) ?? {};
  const extra = stripReserved(body);
  return {
    protocol: "openai",
    endpoint,
    messages,
    model: body.model as string | undefined,
    complexity: (body.complexity as string) || (gw.complexity as string) || undefined,
    skills: Array.isArray(body.skills) ? (body.skills as string[]) : undefined,
    conversationId:
      (body.conversation_id as string) ||
      (body.session_id as string) ||
      (gw.conversation_id as string) ||
      extractSessionId(body) ||
      undefined,
    clientTools: normOpenAITools(body.tools),
    gatewayToolsRequested: !!body.gateway_tools || !!gw.enabled,
    stream: !!body.stream,
    temperature: (body.temperature as number | null) ?? null,
    maxTokens: (body.max_tokens as number | null) ?? null,
    topP: (body.top_p as number | null) ?? null,
    stop: body.stop as string | string[] | undefined,
    extra,
  };
}

export function parseAnthropicRequest(
  body: Record<string, unknown>,
  endpoint: string,
): ParsedRequest {
  const messages: ChatMessage[] = [];

  // system 字段：字符串或文本块数组
  const sys = body.system;
  if (typeof sys === "string" && sys) {
    messages.push({ role: "system", content: sys });
  } else if (Array.isArray(sys)) {
    const text = sys
      .map((b) => (typeof b === "object" && b && "text" in (b as object) ? (b as { text: string }).text : ""))
      .join("\n");
    if (text) messages.push({ role: "system", content: text });
  }

  for (const m of (body.messages as Record<string, unknown>[]) ?? []) {
    const role = (m.role as string) ?? "user";
    const rawContent = m.content;
    // 兼容字符串与块数组两种 content 形式
    const blocks =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? (rawContent as Record<string, unknown>[])
          : [];
    // 将 tool_result 块与 tool_use 块分别处理；text/image 块按顺序保留
    const textParts: string[] = [];
    const orderedParts: Record<string, unknown>[] = [];
    const toolCalls: ToolCall[] = [];
    const toolResults: { tool_use_id: string; content: string }[] = [];
    for (const b of blocks) {
      const type = b.type as string;
      if (type === "text") {
        const t = (b.text as string) ?? "";
        textParts.push(t);
        orderedParts.push({ type: "text", text: t });
      } else if (type === "image") {
        const src = b.source as { type?: string; url?: string; media_type?: string; data?: string };
        let url = "";
        if (src?.type === "url" && src.url) url = src.url;
        else if (src?.type === "base64" && src.data) {
          url = `data:${src.media_type ?? "image/png"};base64,${src.data}`;
        }
        if (url) orderedParts.push({ type: "image_url", image_url: { url } });
      } else if (type === "tool_use") {
        toolCalls.push({
          id: (b.id as string) ?? `toolu_${Math.random().toString(36).slice(2, 10)}`,
          type: "function",
          function: { name: (b.name as string) ?? "", arguments: JSON.stringify(b.input ?? {}) },
        });
      } else if (type === "tool_result") {
        const c = b.content;
        toolResults.push({
          tool_use_id: (b.tool_use_id as string) ?? "",
          content: typeof c === "string" ? c : JSON.stringify(c ?? ""),
        });
      }
    }
    // 仅当存在图片时设置 contentArray，避免改变纯文本消息的原有行为
    const hasImage = orderedParts.some((p) => p.type === "image_url");
    const contentArray = hasImage ? orderedParts : undefined;

    if (role === "assistant") {
      messages.push({
        role,
        content: textParts.join("") || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });
    } else if (toolResults.length) {
      // 用户消息携带工具结果 → 转为 tool 角色（每条一个）
      for (const tr of toolResults) {
        messages.push({ role: "tool", content: tr.content, tool_call_id: tr.tool_use_id });
      }
      if (textParts.length || contentArray) {
        messages.push({ role: "user", content: textParts.join("") || null, contentArray });
      }
    } else {
      messages.push({ role, content: textParts.join("") || null, contentArray });
    }
  }

  const gw = (body.__gateway as Record<string, unknown>) ?? {};
  return {
    protocol: "anthropic",
    endpoint,
    messages,
    model: body.model as string | undefined,
    complexity: (body.complexity as string) || (gw.complexity as string) || undefined,
    skills: Array.isArray(body.skills) ? (body.skills as string[]) : undefined,
    conversationId:
      (body.conversation_id as string) || (body.session_id as string) || (gw.conversation_id as string) || extractSessionId(body) || undefined,
    clientTools: normAnthropicTools(body.tools),
    gatewayToolsRequested: !!body.gateway_tools || !!gw.enabled,
    stream: !!body.stream,
    temperature: (body.temperature as number | null) ?? null,
    maxTokens: (body.max_tokens as number | null) ?? null,
    topP: (body.top_p as number | null) ?? null,
    stop: (body.stop_sequences as string | string[]) ?? null,
    extra: stripReserved(body),
  };
}
