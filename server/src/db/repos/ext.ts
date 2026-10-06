import { getDb } from "../index.js";
import type { Skill, McpServer } from "../../types.js";

// ---------- Skills ----------

export function listSkills(): Skill[] {
  return getDb().prepare("SELECT * FROM skills ORDER BY created_at ASC").all() as Skill[];
}

export function getSkill(id: string): Skill | undefined {
  return getDb().prepare("SELECT * FROM skills WHERE id = ?").get(id) as Skill | undefined;
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
  tools_config: string;
  triggers: string | null;
  enabled: number;
}

export function createSkill(input: SkillInput): Skill {
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO skills (id, name, description, instructions, tools_config, triggers, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.description,
      input.instructions,
      input.tools_config,
      input.triggers,
      input.enabled,
      now,
      now,
    );
  return getSkill(id)!;
}

export function updateSkill(id: string, patch: Partial<SkillInput>): Skill | undefined {
  const existing = getSkill(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch, updated_at: Date.now() };
  getDb()
    .prepare(
      `UPDATE skills SET name=?, description=?, instructions=?, tools_config=?, triggers=?, enabled=?, updated_at=? WHERE id=?`,
    )
    .run(
      next.name,
      next.description,
      next.instructions,
      next.tools_config,
      next.triggers,
      next.enabled,
      next.updated_at,
      id,
    );
  return getSkill(id);
}

export function deleteSkill(id: string): void {
  getDb().prepare("DELETE FROM skills WHERE id = ?").run(id);
}

// ---------- MCP Servers ----------

export function listMcpServers(): McpServer[] {
  return getDb().prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all() as McpServer[];
}

export function getMcpServer(id: string): McpServer | undefined {
  return getDb().prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
    | McpServer
    | undefined;
}

export interface McpServerInput {
  name: string;
  transport: string;
  config: string;
  enabled: number;
}

export function createMcpServer(input: McpServerInput): McpServer {
  const id = `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.transport, input.config, input.enabled, now, now);
  return getMcpServer(id)!;
}

export function updateMcpServer(id: string, patch: Partial<McpServerInput>): McpServer | undefined {
  const existing = getMcpServer(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch, updated_at: Date.now() };
  getDb()
    .prepare(
      "UPDATE mcp_servers SET name=?, transport=?, config=?, enabled=?, updated_at=? WHERE id=?",
    )
    .run(next.name, next.transport, next.config, next.enabled, next.updated_at, id);
  return getMcpServer(id);
}

export function deleteMcpServer(id: string): void {
  getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}
