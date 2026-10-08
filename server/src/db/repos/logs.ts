import { getDb, transaction } from "../index.js";
import type { RequestRecord, MessageRecord, Conversation } from "../../types.js";

// ---------- Requests（调用记录） ----------

export function insertRequest(r: RequestRecord): void {
  getDb()
    .prepare(
      `INSERT INTO requests
       (id, api_key_id, protocol, endpoint, model_requested, model_used, provider_id, tier_id, tier_source, conversation_id, status, error,
        prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, cost, latency_ms, first_token_ms, request_json, response_json, client_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.id,
      r.api_key_id,
      r.protocol,
      r.endpoint,
      r.model_requested,
      r.model_used,
      r.provider_id,
      r.tier_id,
      r.tier_source,
      r.conversation_id,
      r.status,
      r.error,
      r.prompt_tokens,
      r.completion_tokens,
      r.total_tokens,
      r.cache_read_tokens,
      r.cache_creation_tokens,
      r.cost,
      r.latency_ms,
      r.first_token_ms ?? null,
      r.request_json,
      r.response_json,
      r.client_ip,
      r.created_at,
    );
}

export function updateRequest(
  id: string,
  patch: Partial<
    Pick<
      RequestRecord,
      | "status"
      | "error"
      | "prompt_tokens"
      | "completion_tokens"
      | "total_tokens"
      | "cache_read_tokens"
      | "cache_creation_tokens"
      | "cost"
      | "latency_ms"
      | "first_token_ms"
      | "response_json"
      | "conversation_id"
      | "model_used"
      | "provider_id"
      | "tier_id"
      | "tier_source"
    >
  >,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE requests SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getRequest(id: string): RequestRecord | undefined {
  return getDb().prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRecord | undefined;
}

export interface RequestFilter {
  search?: string;
  status?: string;
  protocol?: string;
  model?: string;
  provider_id?: string;
  tier_id?: string;
  api_key_id?: string;
  conversation_id?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

export function listRequests(filter: RequestFilter): {
  items: RequestRecord[];
  total: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.search) {
    where.push("(model_requested LIKE ? OR model_used LIKE ? OR id LIKE ? OR conversation_id LIKE ?)");
    const s = `%${filter.search}%`;
    params.push(s, s, s, s);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.protocol) {
    where.push("protocol = ?");
    params.push(filter.protocol);
  }
  if (filter.model) {
    where.push("model_used = ?");
    params.push(filter.model);
  }
  if (filter.provider_id) {
    where.push("provider_id = ?");
    params.push(filter.provider_id);
  }
  if (filter.tier_id) {
    where.push("tier_id = ?");
    params.push(filter.tier_id);
  }
  if (filter.api_key_id) {
    where.push("api_key_id = ?");
    params.push(filter.api_key_id);
  }
  if (filter.conversation_id) {
    where.push("conversation_id = ?");
    params.push(filter.conversation_id);
  }
  if (filter.from) {
    where.push("created_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("created_at <= ?");
    params.push(filter.to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    getDb().prepare(`SELECT COUNT(*) AS c FROM requests ${whereSql}`).get(...params) as { c: number }
  ).c;

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filter.pageSize ?? 50));
  const rows = getDb()
    .prepare(
      `SELECT * FROM requests ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as RequestRecord[];

  return { items: rows, total };
}

// ---------- Messages（对话消息） ----------

export function insertMessages(msgs: Omit<MessageRecord, "id">[]): void {
  if (msgs.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO messages (request_id, conversation_id, role, content, name, tool_calls, tool_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  transaction(() => {
    for (const m of msgs) {
      stmt.run(
        m.request_id,
        m.conversation_id,
        m.role,
        m.content,
        m.name,
        m.tool_calls,
        m.tool_call_id,
        m.created_at,
      );
    }
  });
}

export function listMessagesByConversation(conversationId: string): MessageRecord[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .all(conversationId) as MessageRecord[];
}

export function listMessagesByRequest(requestId: string): MessageRecord[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE request_id = ? ORDER BY id ASC")
    .all(requestId) as MessageRecord[];
}

// ---------- Conversations ----------

export function upsertConversation(conv: {
  id: string;
  api_key_id: string | null;
  title: string;
  model: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO conversations (id, api_key_id, title, model, created_at, updated_at, message_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, model = excluded.model`,
    )
    .run(conv.id, conv.api_key_id, conv.title, conv.model, Date.now(), Date.now());
}

export function updateConversationTitle(id: string, title: string): void {
  getDb()
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, Date.now(), id);
}

export function bumpConversation(id: string, addCount: number): void {
  getDb()
    .prepare(
      "UPDATE conversations SET message_count = message_count + ?, updated_at = ? WHERE id = ?",
    )
    .run(addCount, Date.now(), id);
}

export function getConversation(id: string): Conversation | undefined {
  return getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | Conversation
    | undefined;
}

export function listConversations(filter: {
  search?: string;
  page?: number;
  pageSize?: number;
}): { items: Conversation[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.search) {
    where.push("(title LIKE ? OR id LIKE ?)");
    const s = `%${filter.search}%`;
    params.push(s, s);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    getDb().prepare(`SELECT COUNT(*) AS c FROM conversations ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filter.pageSize ?? 50));
  const rows = getDb()
    .prepare(
      `SELECT * FROM conversations ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Conversation[];
  return { items: rows, total };
}

/** 批量获取若干对话各自使用过的模型及复杂度层级 */
export function conversationModels(
  conversationIds: string[],
): Record<string, { model: string; tier_id: string | null; tier_name: string | null }[]> {
  if (conversationIds.length === 0) return {};
  const placeholders = conversationIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT r.conversation_id AS conversation_id, r.model_used AS model, r.tier_id AS tier_id, t.name AS tier_name
       FROM requests r LEFT JOIN tiers t ON t.id = r.tier_id
       WHERE r.conversation_id IN (${placeholders}) AND r.model_used != ''
       GROUP BY r.conversation_id, r.model_used, r.tier_id`,
    )
    .all(...conversationIds) as {
    conversation_id: string;
    model: string;
    tier_id: string | null;
    tier_name: string | null;
  }[];
  const map: Record<string, { model: string; tier_id: string | null; tier_name: string | null }[]> = {};
  for (const row of rows) {
    if (!map[row.conversation_id]) map[row.conversation_id] = [];
    map[row.conversation_id].push({
      model: row.model,
      tier_id: row.tier_id,
      tier_name: row.tier_name,
    });
  }
  return map;
}

// ---------- Stats ----------

export function statsTotals(): {
  requests: number;
  tokens: number;
  prompt_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  completion_tokens: number;
  cost: number;
  errors: number;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS tokens,
              COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
              COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
              COALESCE(SUM(cache_creation_tokens),0) AS cache_creation_tokens,
              COALESCE(SUM(completion_tokens),0) AS completion_tokens,
              COALESCE(SUM(cost),0) AS cost,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
       FROM requests`,
    )
    .get() as {
    requests: number;
    tokens: number;
    prompt_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    completion_tokens: number;
    cost: number;
    errors: number;
  };
  return row;
}

export function statsDaily(days: number): { day: string; requests: number; tokens: number; cost: number }[] {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const rows = getDb()
    .prepare(
      `SELECT substr(datetime(created_at/1000, 'unixepoch', 'localtime'),1,10) AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS tokens,
              COALESCE(SUM(cost),0) AS cost
       FROM requests WHERE created_at >= ?
       GROUP BY day ORDER BY day ASC`,
    )
    .all(since) as { day: string; requests: number; tokens: number; cost: number }[];
  return rows;
}

export function statsByModel(): { model_used: string; requests: number; tokens: number; cost: number }[] {
  return getDb()
    .prepare(
      `SELECT model_used, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost),0) AS cost
       FROM requests WHERE model_used != '' GROUP BY model_used ORDER BY requests DESC LIMIT 20`,
    )
    .all() as { model_used: string; requests: number; tokens: number; cost: number }[];
}

/** 某 API Key 当月累计 token 用量 */
export function monthlyTokensByKey(apiKeyId: string): number {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare(
      "SELECT COALESCE(SUM(total_tokens),0) AS c FROM requests WHERE api_key_id = ? AND created_at >= ?",
    )
    .get(apiKeyId, start.getTime()) as { c: number };
  return row.c;
}

/** 按 API Key 聚合的成本账单 */
export function statsByKey(): {
  api_key_id: string | null;
  name: string;
  key_prefix: string;
  requests: number;
  tokens: number;
  cost: number;
  errors: number;
  month_tokens: number;
  month_cost: number;
  last_used_at: number | null;
}[] {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const monthStart = start.getTime();
  return getDb()
    .prepare(
      `SELECT r.api_key_id AS api_key_id,
              COALESCE(k.name, '（未关联/管理员）') AS name,
              COALESCE(k.key_prefix, '') AS key_prefix,
              COUNT(*) AS requests,
              COALESCE(SUM(r.total_tokens),0) AS tokens,
              COALESCE(SUM(r.cost),0) AS cost,
              SUM(CASE WHEN r.status='error' THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(CASE WHEN r.created_at >= ? THEN r.total_tokens ELSE 0 END),0) AS month_tokens,
              COALESCE(SUM(CASE WHEN r.created_at >= ? THEN r.cost ELSE 0 END),0) AS month_cost,
              MAX(r.created_at) AS last_used_at
       FROM requests r LEFT JOIN api_keys k ON k.id = r.api_key_id
       GROUP BY r.api_key_id, k.name, k.key_prefix
       ORDER BY cost DESC`,
    )
    .all(monthStart, monthStart) as {
    api_key_id: string | null;
    name: string;
    key_prefix: string;
    requests: number;
    tokens: number;
    cost: number;
    errors: number;
    month_tokens: number;
    month_cost: number;
    last_used_at: number | null;
  }[];
}
