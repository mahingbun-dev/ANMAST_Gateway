import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { initDb } from "./db/index.js";
import { registerOpenAIRoutes } from "./api/openai.js";
import { registerAnthropicRoutes } from "./api/anthropic.js";
import { registerAdminRoutes } from "./api/admin.js";
import { closeAll } from "./mcp/manager.js";
import { cleanupExpiredSessions } from "./db/repos/auth.js";

async function main(): Promise<void> {
  setLogLevel(config.logLevel);
  await initDb();

  const app = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-*"],
  });

  // 错误处理
  app.setErrorHandler((err: { statusCode?: number; message?: string }, _req, reply) => {
    logger.error("请求错误", err);
    if (reply.sent) return;
    reply.code(err.statusCode ?? 500).send({ error: err.message ?? "内部错误" });
  });

  // 定时清理过期会话
  setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch {
      /* ignore */
    }
  }, 3600 * 1000).unref();

  // API 路由
  registerOpenAIRoutes(app);
  registerAnthropicRoutes(app);
  registerAdminRoutes(app);

  // 健康检查
  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  // 静态资源与 SPA 回退
  const webDist = config.webDist;
  const hasWeb = fs.existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/v1") && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  } else {
    app.get("/", async () => ({
      name: "ANMAST Gateway",
      message: "管理界面未构建。请运行 pnpm build 后重启，或访问 /v1 与 /api 接口。",
    }));
  }

  // 优雅退出
  const shutdown = async () => {
    logger.info("正在关闭……");
    try {
      await closeAll();
    } catch {
      /* ignore */
    }
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
  logger.info(`ANMAST Gateway 已启动：http://${config.host}:${config.port}`);
  if (hasWeb) {
    logger.info(`管理界面：http://127.0.0.1:${config.port}/`);
  }
  logger.info(`OpenAI 兼容端点：http://127.0.0.1:${config.port}/v1/chat/completions`);
  logger.info(`Anthropic 兼容端点：http://127.0.0.1:${config.port}/v1/messages`);
}

main().catch((e) => {
  logger.error("启动失败", e);
  process.exit(1);
});
