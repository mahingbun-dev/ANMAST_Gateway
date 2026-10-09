import type { FastifyInstance, FastifyRequest } from "fastify";
import { getCaller } from "./shared.js";
import { parseOpenAIRequest, parseAnthropicRequest } from "../gateway/parse.js";
import { processChat } from "../gateway/service.js";
import { toReadable } from "../lib/stream.js";

/** 自动判断客户端协议（非 AI 规则） */
function detectProtocol(req: FastifyRequest, body: Record<string, unknown>): "openai" | "anthropic" {
  // 1. Anthropic 客户端必带 anthropic-version 头（最可靠）
  if (req.headers["anthropic-version"]) return "anthropic";
  // 2. 请求体形状启发式
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  const first = messages[0] as { content?: unknown } | undefined;
  const hasTopLevelSystem = typeof body.system === "string" || Array.isArray(body.system);
  const firstContentIsArray = Array.isArray(first?.content);
  const hasAnthropicOnly =
    "thinking" in body ||
    "metadata" in body ||
    "stop_sequences" in body ||
    "context_management" in body ||
    "output_config" in body;
  if (hasTopLevelSystem || firstContentIsArray || hasAnthropicOnly) return "anthropic";
  return "openai";
}

/** 统一入口：POST /v1/chat 自动判断协议并路由到对应处理 */
export function registerUnifiedRoute(app: FastifyInstance): void {
  app.post("/v1/chat", async (req, reply) => {
    const caller = getCaller(req, reply);
    if (!caller) return reply;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.messages)) {
      return reply.code(400).send({
        error: { message: "缺少 messages 字段", type: "invalid_request_error" },
      });
    }

    const protocol = detectProtocol(req, body);
    const parsed =
      protocol === "anthropic"
        ? parseAnthropicRequest(body, "/v1/chat")
        : parseOpenAIRequest(body, "/v1/chat");

    const result = await processChat({
      protocol,
      endpoint: "/v1/chat",
      parsed,
      rawBody: body,
      apiKeyId: caller.apiKeyId,
      clientIp: req.ip ?? null,
    });

    for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
    if (result.type === "stream") {
      return reply.code(result.statusCode).send(toReadable(result.body));
    }
    return reply.code(result.statusCode).send(result.body);
  });
}
