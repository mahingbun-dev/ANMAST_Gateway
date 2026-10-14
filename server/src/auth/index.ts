import { sha256, randomToken, verifyPassword } from "../lib/crypto.js";
import { getSetting } from "../db/index.js";
import {
  getApiKeyByHash,
  touchApiKey,
  getAdmin,
  createSession,
  getSession,
  deleteSession,
} from "../db/repos/auth.js";
import { monthlyTokensByKey } from "../db/repos/logs.js";
import { logger } from "../logger.js";

const SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 天（默认兜底）

function sessionTtl(): number {
  const hours = getSetting<number>("session_timeout_hours", 7 * 24) ?? 7 * 24;
  if (hours <= 0) return SESSION_TTL; // 0 或负数视为默认
  return hours * 3600 * 1000;
}

export type AuthResult =
  | { kind: "apikey"; id: string }
  | { kind: "admin" }
  | { kind: "none"; reason?: string };

/** 从 Authorization 头解析认证信息 */
export function authenticate(authHeader: string | undefined): AuthResult {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { kind: "none", reason: "缺少 Bearer 认证" };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { kind: "none", reason: "空 token" };

  // 网关 API Key
  if (token.startsWith("sk-anmast-")) {
    const key = getApiKeyByHash(sha256(token));
    if (!key) return { kind: "none", reason: "无效的 API Key" };
    if (!key.enabled) return { kind: "none", reason: "API Key 已停用" };
    if (key.monthly_limit_tokens != null) {
      const used = monthlyTokensByKey(key.id);
      if (used >= key.monthly_limit_tokens) {
        return { kind: "none", reason: "API Key 本月额度已用尽" };
      }
    }
    touchApiKey(key.id);
    return { kind: "apikey", id: key.id };
  }

  // 管理员会话
  const session = getSession(sha256(token));
  if (!session) return { kind: "none", reason: "无效或已过期的会话" };
  if (session.expires_at < Date.now()) {
    deleteSession(sha256(token));
    return { kind: "none", reason: "会话已过期" };
  }
  return { kind: "admin" };
}

/** 管理员登录，成功返回 session token */
export async function adminLogin(
  username: string,
  password: string,
): Promise<{ token: string; username: string } | null> {
  const admin = getAdmin();
  if (!admin) return null;
  if (admin.username !== username) return null;
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) return null;
  const token = randomToken(32);
  createSession(sha256(token), Date.now() + sessionTtl());
  logger.info(`管理员 ${username} 登录成功`);
  return { token, username };
}

export function adminLogout(authHeader: string | undefined): void {
  if (authHeader?.startsWith("Bearer ")) {
    deleteSession(sha256(authHeader.slice(7).trim()));
  }
}
