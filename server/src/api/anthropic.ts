import type { FastifyInstance } from "fastify";
import { getCaller } from "./shared.js";
import { parseAnthropicRequest } from "../gateway/parse.js";
import { processChat } from "../gateway/service.js";
import { toReadable } from "../lib/stream.js";

export function registerAnthropicRoutes(app: FastifyInstance): void {
  app.post("/v1/messages", async (req, reply) => {
    const caller = getCaller(req, reply);
    if (!caller) return reply;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.messages)) {
      return reply.code(400).send({
        type: "error",
        error: { type: "invalid_request_error", message: "缺少 messages 字段" },
      });
    }

    const parsed = parseAnthropicRequest(body, "/v1/messages");
    const result = await processChat({
      protocol: "anthropic",
      endpoint: "/v1/messages",
      parsed,
      rawBody: body,
      apiKeyId: caller.apiKeyId,
      clientIp: req.ip ?? null,
    });

    if (result.type === "stream") {
      for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      return reply.code(result.statusCode).send(toReadable(result.body));
    }
    for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
    return reply.code(result.statusCode).send(result.body);
  });

  // Claude Code / Anthropic SDK 会调用此端点做 token 估算
  app.post("/v1/messages/count_tokens", async (req, reply) => {
    const caller = getCaller(req, reply);
    if (!caller) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const s = JSON.stringify(body.messages ?? []);
    const input_tokens = Math.max(1, Math.ceil(Buffer.byteLength(s, "utf-8") / 4));
    return reply.send({ input_tokens });
  });
}
