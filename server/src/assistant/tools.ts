import type { ToolDefinition } from "../types.js";
import { createMcpServer } from "../db/repos/ext.js";
import { importSkillFromContent } from "../skills/importer.js";
import {
  searchMcpCatalog,
  searchSkillCatalog,
  findMcpByName,
  findSkillByName,
  type CatalogMCP,
} from "./catalog.js";
import { logger } from "../logger.js";

// ---------- 网络下载 ----------

async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "anmast-gateway" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseRepo(url: string): { owner: string; name: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { owner: m[1], name: m[2].replace(/\.git$/, "") };
}

/** 从 GitHub 仓库安装其中所有 SKILL.md */
async function installSkillFromGitHub(url: string): Promise<string> {
  const repo = parseRepo(url);
  if (!repo) throw new Error("无法识别的 GitHub 仓库地址");
  let paths: string[] = [];
  try {
    const api = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/HEAD?recursive=1`;
    const res = await fetch(api, {
      headers: { "User-Agent": "anmast-gateway", Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { tree?: { type: string; path: string }[] };
      paths = (data.tree ?? [])
        .filter((t) => t.type === "blob" && t.path.endsWith("SKILL.md"))
        .map((t) => t.path);
    }
  } catch (e) {
    logger.warn("GitHub 树获取失败，回退到根 SKILL.md", e);
  }
  if (!paths.length) paths = ["SKILL.md"];
  const imported: string[] = [];
  for (const p of paths) {
    try {
      const raw = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/HEAD/${p}`;
      const content = await fetchText(raw);
      const seg = p.split("/");
      const fallback = seg.length >= 2 ? seg[seg.length - 2] : repo.name;
      const skill = importSkillFromContent(content, fallback);
      imported.push(skill.name);
    } catch {
      /* 跳过单个失败 */
    }
  }
  if (!imported.length) {
    throw new Error("未能从该仓库获取到 SKILL.md（请确认仓库存在 SKILL.md，或直接提供 SKILL.md 的原始链接）");
  }
  return `已安装 ${imported.length} 个 Skill：${imported.join(", ")}`;
}

// ---------- 工具实现 ----------

async function toolSearchCatalog(query: string): Promise<string> {
  const q = query ?? "";
  const mcp = searchMcpCatalog(q);
  const skills = searchSkillCatalog(q);
  const lines: string[] = [];
  if (!q) lines.push("以下是内置目录的全部条目：");
  lines.push(`MCP 服务器（${mcp.length}）：`);
  for (const m of mcp) {
    lines.push(
      `- ${m.name}：${m.description}（${m.transport}）` +
        (m.command ? ` 命令 ${m.command} ${(m.args ?? []).join(" ")}` : m.url ? ` URL ${m.url}` : ""),
    );
  }
  lines.push(`Skill（${skills.length}）：`);
  for (const s of skills) {
    lines.push(`- ${s.name}：${s.description}（来源 ${s.url}）`);
  }
  if (!mcp.length && !skills.length) {
    lines.push("目录中没有匹配项。可让用户提供 URL（GitHub 仓库 / SKILL.md 原始链接 / 远程 MCP 地址）后安装。");
  }
  return lines.join("\n");
}

async function toolInstallSkill(source: string): Promise<string> {
  if (!source) throw new Error("缺少 Skill 名称或 URL");
  if (/^https?:\/\//i.test(source)) {
    if (source.endsWith(".md") || source.includes("raw.")) {
      const content = await fetchText(source);
      const skill = importSkillFromContent(content, undefined);
      return `已安装 Skill「${skill.name}」`;
    }
    if (/github\.com/i.test(source)) {
      return installSkillFromGitHub(source);
    }
    const content = await fetchText(source);
    const skill = importSkillFromContent(content, undefined);
    return `已安装 Skill「${skill.name}」`;
  }
  // 按名字查目录
  const hit = findSkillByName(source);
  if (hit) {
    if (/github\.com/i.test(hit.url)) return installSkillFromGitHub(hit.url);
    const content = await fetchText(hit.url);
    const skill = importSkillFromContent(content, hit.name);
    return `已安装 Skill「${skill.name}」`;
  }
  throw new Error(`目录中没有名为「${source}」的 Skill，请提供 GitHub 仓库或 SKILL.md 原始链接`);
}

interface InstallMcpArgs {
  name?: string;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

async function toolInstallMcp(input: InstallMcpArgs): Promise<string> {
  const name = input.name;
  if (!name) throw new Error("缺少 MCP 名称");
  let transport = input.transport as "stdio" | "sse" | "streamable-http";
  let config: Record<string, unknown>;

  const hasExplicit =
    (transport === "stdio" && input.command) ||
    ((transport === "sse" || transport === "streamable-http") && input.url);

  if (hasExplicit) {
    if (transport === "stdio") {
      config = { command: input.command, args: input.args ?? [], env: input.env ?? {} };
    } else {
      config = { url: input.url, headers: input.headers ?? {} };
    }
  } else {
    const hit: CatalogMCP | undefined = findMcpByName(name);
    if (!hit) {
      throw new Error(
        `目录中没有名为「${name}」的 MCP。请提供完整信息：远程地址（transport=streamable-http/sse + url）或本地命令（transport=stdio + command + args）`,
      );
    }
    transport = hit.transport;
    config =
      hit.transport === "stdio"
        ? { command: hit.command, args: hit.args ?? [], env: hit.env ?? {} }
        : { url: hit.url, headers: {} };
  }

  const server = createMcpServer({
    name,
    transport: transport ?? "stdio",
    config: JSON.stringify(config),
    enabled: 1,
  });
  return `已安装 MCP Server「${server.name}」（transport=${server.transport}）。可在「MCP 服务器」页点「工具」测试连接；stdio 型若含路径占位符请按需编辑参数。`;
}

// ---------- 工具定义（OpenAI function calling 格式） ----------

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "在内置目录中按名称/关键词搜索可安装的 MCP 服务器与 Skill",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "名称或关键词，空则列出全部" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description:
        "安装 Skill：可传名称（查内置目录）或 URL（GitHub 仓库 / SKILL.md 原始链接），下载并导入到网关",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Skill 名称或 URL" },
        },
        required: ["source"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_mcp",
      description:
        "安装 MCP 服务器：可传名称（查内置目录）或显式给出 transport + command/args（stdio）或 transport + url（sse/streamable-http）",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "MCP 服务器名称" },
          transport: {
            type: "string",
            enum: ["stdio", "sse", "streamable-http"],
            description: "传输方式",
          },
          command: { type: "string", description: "stdio：可执行命令，如 npx / uvx / python" },
          args: { type: "array", items: { type: "string" }, description: "stdio：命令参数" },
          env: { type: "object", description: "stdio：环境变量（如 API Key）" },
          url: { type: "string", description: "sse/streamable-http：服务器地址" },
          headers: { type: "object", description: "远程：请求头" },
        },
        required: ["name"],
      },
    },
  },
];

export async function executeAssistantTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_catalog":
      return toolSearchCatalog(String(args.query ?? ""));
    case "install_skill":
      return toolInstallSkill(String(args.source ?? ""));
    case "install_mcp":
      return toolInstallMcp(args as InstallMcpArgs);
    default:
      return `未知工具：${name}`;
  }
}
