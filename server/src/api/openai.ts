import type { FastifyInstance } from "fastify";
import { getCaller, listPublicModels } from "./shared.js";
import { parseOpenAIRequest } from "../gateway/parse.js";
import { processChat } from "../gateway/service.js";
import { toReadable } from "../lib/stream.js";

export function registerOpenAIRoutes(app: FastifyInstance): void {
  app.post("/v1/chat/completions", async (req, reply) => {
    const caller = getCaller(req, reply);
    if (!caller) return reply;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.messages)) {
      return reply.code(400).send({
        error: { message: "缺少 messages 字段", type: "invalid_request_error" },
      });
    }

    const parsed = parseOpenAIRequest(body, "/v1/chat/completions");
    const result = await processChat({
      protocol: "openai",
      endpoint: "/v1/chat/completions",
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

  app.get("/v1/models", async (req, reply) => {
    const models = listPublicModels();
    // Anthropic 客户端会带 x-api-key / anthropic-version 头，据此返回 Anthropic 格式
    const isAnthropic = req.headers["x-api-key"] || req.headers["anthropic-version"];
    if (isAnthropic) {
      return reply.send({
        data: models.map((m) => ({ id: m.id, display_name: m.id, created_at: m.created })),
        has_more: false,
        first_id: models[0]?.id ?? null,
        last_id: models[models.length - 1]?.id ?? null,
      });
    }
    return reply.send({ object: "list", data: models });
  });

  app.get("/v1/models/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const model = listPublicModels().find((m) => m.id === id);
    if (!model) {
      return reply.code(404).send({ error: { message: "模型不存在", type: "invalid_request_error" } });
    }
    return reply.send(model);
  });
}
