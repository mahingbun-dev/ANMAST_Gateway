import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createSkill } from "../db/repos/ext.js";
import type { Skill } from "../types.js";

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
}

/** 解析 SKILL.md 格式（YAML frontmatter + markdown 正文），无第三方 YAML 依赖 */
export function parseSkillMarkdown(content: string, fallbackName?: string): ParsedSkill {
  let body = content;
  const meta: Record<string, string> = {};
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = content.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) {
        meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  const name = meta.name || fallbackName || "imported-skill";
  const description = meta.description || "";
  const tools = (meta.tools || meta["allowed-tools"] || "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { name, description, instructions: body.trim(), tools };
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

/** 从原始文本导入一个 Skill（解析 + 入库 + 归档原始文件） */
export function importSkillFromContent(content: string, fallbackName?: string): Skill {
  const p = parseSkillMarkdown(content, fallbackName);
  const skill = createSkill({
    name: p.name,
    description: p.description,
    instructions: p.instructions || content.trim(),
    tools_config: JSON.stringify({ tools: p.tools }),
    triggers: null,
    enabled: 1,
  });
  try {
    fs.mkdirSync(config.skillsDir, { recursive: true });
    fs.writeFileSync(path.join(config.skillsDir, `${safeName(p.name)}.md`), content, "utf-8");
  } catch {
    /* 归档失败不影响导入 */
  }
  return skill;
}

/** 从服务器本地文件/目录导入 Skill（目录内扫描 *.md 与 SKILL.md） */
export function importSkillFromPath(p: string): { imported: string[] } {
  const stat = fs.statSync(p);
  const files: string[] = [];
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f.endsWith(".md")) files.push(path.join(p, f));
    }
  } else {
    files.push(p);
  }
  if (files.length === 0) {
    throw new Error("该路径下未找到 .md 文件");
  }
  const imported: string[] = [];
  for (const f of files) {
    const content = fs.readFileSync(f, "utf-8");
    const skill = importSkillFromContent(content, path.basename(f, path.extname(f)));
    imported.push(skill.name);
  }
  return { imported };
}
