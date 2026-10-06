import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { migrations, DEFAULT_TIERS } from "./schema.js";
import { hashPassword } from "../lib/crypto.js";

// 宽松类型的数据库接口，避免在每个 repository 里做类型转换。
export interface Statement {
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

let raw: DatabaseSync | null = null;

function wrap(stmt: ReturnType<DatabaseSync["prepare"]>): Statement {
  return {
    get: (...params: unknown[]) => stmt.get(...(params as SQLInputValue[])),
    all: (...params: unknown[]) => stmt.all(...(params as SQLInputValue[])),
    run: (...params: unknown[]) => stmt.run(...(params as SQLInputValue[])),
  };
}

export function getDb(): Db {
  if (!raw) throw new Error("数据库尚未初始化");
  return {
    exec: (sql: string) => raw!.exec(sql),
    prepare: (sql: string) => wrap(raw!.prepare(sql)),
  };
}

/** 简单事务封装 */
export function transaction<T>(fn: () => T): T {
  raw!.exec("BEGIN");
  try {
    const r = fn();
    raw!.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      raw!.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** 初始化数据库、执行迁移、写入种子数据 */
export async function initDb(): Promise<void> {
  raw = new DatabaseSync(config.dbPath);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");

  const verRow = raw.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = verRow.user_version;
  for (let i = current; i < migrations.length; i++) {
    transaction(() => {
      raw!.exec(migrations[i]);
    });
    raw.exec(`PRAGMA user_version = ${i + 1}`);
    logger.info(`已应用数据库迁移 v${i + 1}`);
  }

  seedDefaults();
  await seedAdmin();
}

function seedDefaults(): void {
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM tiers").get() as { c: number };
  if (count.c === 0) {
    const insert = getDb().prepare(
      "INSERT INTO tiers (id, name, description, sort) VALUES (?, ?, ?, ?)",
    );
    transaction(() => {
      for (const t of DEFAULT_TIERS) insert.run(t.id, t.name, t.description, t.sort);
    });
    logger.info("已写入默认复杂度层级 low/medium/high");
  }
}

async function seedAdmin(): Promise<void> {
  const row = getDb().prepare("SELECT id FROM admin WHERE id = 1").get();
  if (row) return;
  const now = Date.now();
  const passwordHash = await hashPassword(config.adminPassword);
  getDb()
    .prepare(
      "INSERT INTO admin (id, username, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
    )
    .run(config.adminUsername, passwordHash, now, now);
  logger.info(`已创建管理员账号：${config.adminUsername}`);
}

/** 简单工具：按 key 读取/写入 settings */
export function getSetting<T = string>(key: string, fallback?: T): T | undefined {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(value));
}

export function nowMs(): number {
  return Date.now();
}
