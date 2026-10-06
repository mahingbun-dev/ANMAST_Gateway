import { listSkills } from "../db/repos/ext.js";
import type { Skill, ChatMessage } from "../types.js";

export interface TriggerConfig {
  keywords?: string[];
}

export interface ToolsConfig {
  tools?: string[];
}

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** 根据显式请求的 skill（名称或 id）与触发规则，解析出需要激活的 Skill */
export function resolveActiveSkills(
  requested: string[] | undefined,
  messages: ChatMessage[],
): Skill[] {
  const all = listSkills().filter((s) => s.enabled);
  const active = new Map<string, Skill>();
  const requestedSet = new Set((requested ?? []).map((s) => s.toLowerCase()));

  // 1. 显式请求
  for (const s of all) {
    if (requestedSet.has(s.name.toLowerCase()) || requestedSet.has(s.id.toLowerCase())) {
      active.set(s.id, s);
    }
  }

  // 2. 触发规则（关键词匹配最近一条用户消息）
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const lower = lastUser.toLowerCase();
  for (const s of all) {
    if (active.has(s.id)) continue;
    const trig = parseJson<TriggerConfig>(s.triggers, {});
    const kws = trig.keywords ?? [];
    if (kws.length && kws.some((k) => k && lower.includes(k.toLowerCase()))) {
      active.set(s.id, s);
    }
  }

  return [...active.values()];
}

/** 组合激活 Skill 的指令，形成附加系统提示 */
export function buildSkillSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const parts = skills.map((s) => {
    let body = s.instructions?.trim() ?? "";
    if (s.description && !body.includes(s.description)) {
      body = `${s.description}\n\n${body}`;
    }
    return `## Skill: ${s.name}\n${body}`;
  });
  return `以下是已启用的技能（Skill）说明，请在有需要时遵循其指引：\n\n${parts.join("\n\n")}`;
}

/** 获取激活 Skill 声明的工具名集合 */
export function getSkillToolNames(skills: Skill[]): string[] {
  const names = new Set<string>();
  for (const s of skills) {
    const cfg = parseJson<ToolsConfig>(s.tools_config, {});
    for (const t of cfg.tools ?? []) names.add(t);
  }
  return [...names];
}
