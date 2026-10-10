import { getDb } from "../index.js";
import type { ApiKey } from "../../types.js";

// ---------- API Keys（远程客户端网关密钥） ----------

export function listApiKeys(): ApiKey[] {
  return getDb().prepare("SELECT * FROM api_keys ORDER BY created_at ASC").all() as ApiKey[];
}

export function getApiKeyByHash(hash: string): ApiKey | undefined {
  return getDb().prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(hash) as
    | ApiKey
    | undefined;
}

export function getApiKey(id: string): ApiKey | undefined {
  return getDb().prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKey | undefined;
}

export function createApiKey(
  name: string,
  keyHash: string,
  keyPrefix: string,
  monthlyLimitTokens: number | null,
  skillIds: string,
  mcpServerIds: string,
): ApiKey {
  const id = `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, enabled, monthly_limit_tokens, skill_ids, mcp_server_ids, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(id, name, keyHash, keyPrefix, monthlyLimitTokens, skillIds, mcpServerIds, now);
  return getApiKey(id)!;
}

export function updateApiKey(
  id: string,
  patch: {
    name?: string;
    enabled?: number;
    monthly_limit_tokens?: number | null;
    skill_ids?: string;
    mcp_server_ids?: string;
    compression_enabled?: number;
  },
): ApiKey | undefined {
  const existing = getApiKey(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  getDb()
    .prepare(
      "UPDATE api_keys SET name=?, enabled=?, monthly_limit_tokens=?, skill_ids=?, mcp_server_ids=?, compression_enabled=? WHERE id=?",
    )
    .run(
      next.name,
      next.enabled,
      next.monthly_limit_tokens ?? null,
      next.skill_ids,
      next.mcp_server_ids,
      next.compression_enabled,
      id,
    );
  return getApiKey(id);
}

export function deleteApiKey(id: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

export function touchApiKey(id: string): void {
  getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
}

// ---------- Admin ----------

export function getAdmin(): { id: number; username: string; password_hash: string } | undefined {
  return getDb().prepare("SELECT id, username, password_hash FROM admin WHERE id = 1").get() as
    | { id: number; username: string; password_hash: string }
    | undefined;
}

export function updateAdminPassword(username: string, passwordHash: string): void {
  getDb()
    .prepare("UPDATE admin SET username = ?, password_hash = ?, updated_at = ? WHERE id = 1")
    .run(username, passwordHash, Date.now());
}

// ---------- Sessions ----------

export function createSession(tokenHash: string, expiresAt: number): void {
  getDb()
    .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash, Date.now(), expiresAt);
}

export function getSession(tokenHash: string): { expires_at: number } | undefined {
  return getDb().prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | { expires_at: number }
    | undefined;
}

export function deleteSession(tokenHash: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function cleanupExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}
