import { getDb } from "../index.js";

export type Granularity = "day" | "week" | "month" | "year";

export interface UsageFilter {
  from?: number;
  to?: number;
  model?: string; // 模型名（requests.model_used）
  api_key_id?: string;
}

function buildConds(f: UsageFilter, alias = ""): { conds: string[]; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const col = alias ? `${alias}.` : "";
  if (f.from) {
    conds.push(`${col}created_at >= ?`);
    params.push(f.from);
  }
  if (f.to) {
    conds.push(`${col}created_at <= ?`);
    params.push(f.to);
  }
  if (f.model) {
    conds.push(`${col}model_used = ?`);
    params.push(f.model);
  }
  if (f.api_key_id) {
    conds.push(`${col}api_key_id = ?`);
    params.push(f.api_key_id);
  }
  return { conds, params };
}

function toWhere(conds: string[]): string {
  return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
}

export interface UsageSummary {
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
  errors: number;
  models: number;
  keys: number;
}

export function usageSummary(f: UsageFilter): UsageSummary {
  const { conds, params } = buildConds(f);
  const where = toWhere(conds);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS tokens,
              COALESCE(SUM(prompt_tokens),0) AS prompt,
              COALESCE(SUM(cache_read_tokens),0) AS cache_read,
              COALESCE(SUM(cache_creation_tokens),0) AS cache_write,
              COALESCE(SUM(completion_tokens),0) AS completion,
              COALESCE(SUM(cost),0) AS cost,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
              COUNT(DISTINCT CASE WHEN model_used != '' THEN model_used END) AS models,
              COUNT(DISTINCT api_key_id) AS keys
       FROM requests ${where}`,
    )
    .get(...params) as UsageSummary;
  return row;
}

const BUCKET_FMT: Record<Granularity, string> = {
  day: "%Y-%m-%d",
  week: "%Y-W%W",
  month: "%Y-%m",
  year: "%Y",
};

export interface TimeseriesPoint {
  bucket: string;
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
}

export function usageTimeseries(granularity: Granularity, f: UsageFilter): TimeseriesPoint[] {
  const fmt = BUCKET_FMT[granularity];
  const { conds, params } = buildConds(f);
  const where = toWhere(conds);
  const sql = `SELECT strftime('${fmt}', created_at/1000, 'unixepoch', 'localtime') AS bucket,
                      COUNT(*) AS requests,
                      COALESCE(SUM(total_tokens),0) AS tokens,
                      COALESCE(SUM(prompt_tokens),0) AS prompt,
                      COALESCE(SUM(cache_read_tokens),0) AS cache_read,
                      COALESCE(SUM(cache_creation_tokens),0) AS cache_write,
                      COALESCE(SUM(completion_tokens),0) AS completion,
                      COALESCE(SUM(cost),0) AS cost
               FROM requests ${where}
               GROUP BY bucket ORDER BY bucket ASC`;
  return getDb().prepare(sql).all(...params) as TimeseriesPoint[];
}

export interface ModelUsage {
  model_id: string;
  display_name: string;
  provider_name: string;
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
  avg_latency: number;
  errors: number;
  input_price: number | null;
  input_cache_read_price: number | null;
  input_cache_write_price: number | null;
  output_price: number | null;
}

export function usageByModel(f: UsageFilter): ModelUsage[] {
  const { conds, params } = buildConds(f, "r");
  conds.push("r.model_used != ''");
  const where = toWhere(conds);
  const sql = `SELECT r.model_used AS model_id,
                      COUNT(*) AS requests,
                      COALESCE(SUM(r.total_tokens),0) AS tokens,
                      COALESCE(SUM(r.prompt_tokens),0) AS prompt,
                      COALESCE(SUM(r.cache_read_tokens),0) AS cache_read,
                      COALESCE(SUM(r.cache_creation_tokens),0) AS cache_write,
                      COALESCE(SUM(r.completion_tokens),0) AS completion,
                      COALESCE(SUM(r.cost),0) AS cost,
                      COALESCE(AVG(r.latency_ms),0) AS avg_latency,
                      SUM(CASE WHEN r.status='error' THEN 1 ELSE 0 END) AS errors,
                      COALESCE(m.display_name, r.model_used) AS display_name,
                      p.name AS provider_name,
                      m.input_price AS input_price,
                      m.input_cache_read_price AS input_cache_read_price,
                      m.input_cache_write_price AS input_cache_write_price,
                      m.output_price AS output_price
               FROM requests r
               LEFT JOIN models m ON m.name = r.model_used
               LEFT JOIN providers p ON p.id = m.provider_id
               ${where}
               GROUP BY r.model_used
               ORDER BY requests DESC`;
  return getDb().prepare(sql).all(...params) as ModelUsage[];
}

export interface KeyModelUsage {
  model: string;
  requests: number;
  cost: number;
}

export interface KeyUsage {
  api_key_id: string | null;
  name: string;
  prefix: string;
  key_enabled: number | null;
  monthly_limit_tokens: number | null;
  requests: number;
  tokens: number;
  cost: number;
  errors: number;
  last_used_at: number | null;
  models: KeyModelUsage[];
}

export function usageByKey(f: UsageFilter): KeyUsage[] {
  const { conds, params } = buildConds(f, "r");
  const where = toWhere(conds);
  const rows = getDb()
    .prepare(
      `SELECT r.api_key_id AS api_key_id,
              COALESCE(k.name, '（未关联/管理员）') AS name,
              COALESCE(k.key_prefix, '') AS prefix,
              k.enabled AS key_enabled,
              k.monthly_limit_tokens AS monthly_limit_tokens,
              COUNT(*) AS requests,
              COALESCE(SUM(r.total_tokens),0) AS tokens,
              COALESCE(SUM(r.cost),0) AS cost,
              SUM(CASE WHEN r.status='error' THEN 1 ELSE 0 END) AS errors,
              MAX(r.created_at) AS last_used_at
       FROM requests r
       LEFT JOIN api_keys k ON k.id = r.api_key_id
       ${where}
       GROUP BY r.api_key_id
       ORDER BY cost DESC`,
    )
    .all(...params) as Omit<KeyUsage, "models">[];

  const bConds = buildConds(f);
  bConds.conds.push("model_used != ''");
  const bWhere = toWhere(bConds.conds);
  const breakdown = getDb()
    .prepare(
      `SELECT api_key_id, model_used AS model, COUNT(*) AS requests, COALESCE(SUM(cost),0) AS cost
       FROM requests ${bWhere}
       GROUP BY api_key_id, model_used
       ORDER BY requests DESC`,
    )
    .all(...bConds.params) as { api_key_id: string | null; model: string; requests: number; cost: number }[];

  const byKey = new Map<string | null, KeyModelUsage[]>();
  for (const b of breakdown) {
    const k = b.api_key_id ?? null;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({ model: b.model, requests: b.requests, cost: b.cost });
  }
  return rows.map((r) => ({ ...r, models: byKey.get(r.api_key_id) ?? [] }));
}
