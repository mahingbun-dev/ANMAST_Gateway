import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 编译后 dist/ 下；源码 src/ 下。向上取项目根（server 目录）。
const SERVER_ROOT = path.resolve(__dirname, "..");

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(4000),
  DATA_DIR: z.string().default(path.join(SERVER_ROOT, "data")),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().min(8).default("admin123456"),
  LOG_LEVEL: z.string().default("info"),
  WEB_DIST: z.string().default(path.join(SERVER_ROOT, "..", "web", "dist")),
  // 是否强制要求管理员在首次启动后修改默认密码（默认 true，但开发环境可关闭）
  REQUIRE_PASSWORD_CHANGE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("环境变量配置错误：", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

// 确保数据目录存在
fs.mkdirSync(env.DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(env.DATA_DIR, "skills"), { recursive: true });

export const config = {
  host: env.HOST,
  port: env.PORT,
  dataDir: env.DATA_DIR,
  dbPath: path.join(env.DATA_DIR, "gateway.db"),
  skillsDir: path.join(env.DATA_DIR, "skills"),
  adminUsername: env.ADMIN_USERNAME,
  adminPassword: env.ADMIN_PASSWORD,
  logLevel: env.LOG_LEVEL,
  webDist: env.WEB_DIST,
  requirePasswordChange: env.REQUIRE_PASSWORD_CHANGE,
  serverRoot: SERVER_ROOT,
};
