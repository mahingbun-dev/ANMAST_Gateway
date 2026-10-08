import type { FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../auth/index.js";
import { listEnabledModels } from "../routing/index.js";

/** /v1 端点认证：允许 API Key 或管理员会话；同时接受 Bearer 与 x-api-key 头 */
export function getCaller(
  req: FastifyRequest,
  reply: FastifyReply,
): { apiKeyId: string | null } | null {
  let authHeader = req.headers.authorization as string | undefined;
  if (!authHeader) {
    const xKey = req.headers["x-api-key"] as string | undefined;
    if (xKey) authHeader = `Bearer ${xKey}`;
  }
  const auth = authenticate(authHeader);
  if (auth.kind === "apikey") return { apiKeyId: auth.id };
  if (auth.kind === "admin") return { apiKeyId: null };
  reply.code(401).send({ error: { message: auth.reason ?? "未认证", type: "unauthorized" } });
  return null;
}

export function listPublicModels(): {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  display_name: string;
}[] {
  const models = listEnabledModels().map((x) => ({
    id: x.model.name,
    object: "model",
    created: Math.floor(x.model.created_at / 1000),
    owned_by: x.provider.name,
    display_name: x.model.display_name || x.model.name,
  }));
  // 虚拟模型 auto：命中后按复杂度自动路由
  return [
    {
      id: "auto",
      object: "model",
      created: 0,
      owned_by: "anmast-gateway",
      display_name: "auto（按复杂度路由）",
    },
    ...models,
  ];
}
