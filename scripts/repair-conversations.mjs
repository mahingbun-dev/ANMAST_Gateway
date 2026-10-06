#!/usr/bin/env node
// 回填脚本：把同一 session_id 下被拆散的请求合并为一个对话，并按内容签名去重消息。
// 用法：node scripts/repair-conversations.mjs [dbPath]
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || "server/data/gateway.db";
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");

function extractSessionId(body) {
  const md = body?.metadata;
  if (!md) return undefined;
  if (typeof md.user_id === "string") {
    try {
      const o = JSON.parse(md.user_id);
      if (o.session_id) return o.session_id;
    } catch {
      /* ignore */
    }
  }
  if (typeof md.session_id === "string") return md.session_id;
  if (typeof md.conversation_id === "string") return md.conversation_id;
  return undefined;
}

function msgSig(m) {
  let names = "";
  const tc = m.tool_calls;
  if (typeof tc === "string" && tc) {
    try {
      const arr = JSON.parse(tc);
      if (Array.isArray(arr)) names = arr.map((t) => t?.function?.name ?? "").sort().join(",");
    } catch {
      /* ignore */
    }
  }
  return `${m.role}\u0000${m.content ?? ""}\u0000${m.tool_call_id ?? ""}\u0000${names}`;
}

const requests = db
  .prepare(
    "SELECT id, api_key_id, conversation_id, model_used, request_json, created_at FROM requests ORDER BY created_at ASC, rowid ASC",
  )
  .all();

const bySession = new Map();
for (const r of requests) {
  let body = null;
  try {
    body = JSON.parse(r.request_json);
  } catch {
    /* ignore */
  }
  const sid = extractSessionId(body);
  if (sid) {
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(r);
  }
}

const ins = db.prepare(
  "INSERT INTO messages (request_id, conversation_id, role, content, name, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
let mergedSessions = 0;
let mergedRequests = 0;

for (const [sid, reqs] of bySession) {
  if (reqs.length <= 1) continue;

  const allMsgs = [];
  for (const r of reqs) {
    const msgs = db
      .prepare(
        "SELECT request_id, role, content, name, tool_calls, tool_call_id, created_at FROM messages WHERE request_id = ? ORDER BY id ASC",
      )
      .all(r.id);
    allMsgs.push(...msgs);
  }

  const seen = new Set();
  const deduped = [];
  for (const m of allMsgs) {
    const sig = msgSig(m);
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(m);
  }

  // 删除旧消息、更新请求的 conversation_id
  for (const r of reqs) {
    db.prepare("DELETE FROM messages WHERE request_id = ?").run(r.id);
  }
  for (const m of deduped) {
    ins.run(m.request_id, sid, m.role, m.content, m.name, m.tool_calls, m.tool_call_id, m.created_at);
  }
  for (const r of reqs) {
    db.prepare("UPDATE requests SET conversation_id = ? WHERE id = ?").run(sid, r.id);
  }

  // 清理旧 conversation
  for (const r of reqs) {
    if (r.conversation_id !== sid) {
      db.prepare("DELETE FROM conversations WHERE id = ?").run(r.conversation_id);
    }
  }

  const titleMsg =
    deduped.find((m) => m.role === "user" && m.content && !String(m.content).startsWith("<")) ||
    deduped.find((m) => m.role === "user" && m.content);
  let title = (titleMsg?.content ?? "会话").replace(/\s+/g, " ").trim();
  title = title.length > 40 ? title.slice(0, 40) + "…" : title || "会话";

  const first = reqs[0];
  db.prepare(
    `INSERT INTO conversations (id, api_key_id, title, model, created_at, updated_at, message_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET api_key_id=excluded.api_key_id, title=excluded.title, model=excluded.model, updated_at=excluded.updated_at, message_count=excluded.message_count`,
  ).run(sid, first.api_key_id, title, first.model_used || "", first.created_at, Date.now(), deduped.length);

  mergedSessions++;
  mergedRequests += reqs.length;
}

console.log(`合并完成：${mergedSessions} 个 session，涉及 ${mergedRequests} 个请求`);
