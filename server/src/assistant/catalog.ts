// 内置「名称 → 安装信息」目录，供 AI 助手按名字搜索并安装 Skill / MCP。
// 仅作为便捷起点；用户也可直接给 URL/仓库地址安装。

export interface CatalogMCP {
  name: string;
  description: string;
  transport: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  keywords: string[];
}

export interface CatalogSkill {
  name: string;
  description: string;
  url: string; // raw SKILL.md 或 GitHub 仓库地址
  keywords: string[];
}

export const MCP_CATALOG: CatalogMCP[] = [
  {
    name: "filesystem",
    description: "读写本地文件系统（需指定允许访问的目录）",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    keywords: ["文件", "filesystem", "file", "目录"],
  },
  {
    name: "fetch",
    description: "抓取网页并转为 markdown",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    keywords: ["fetch", "抓取", "网页", "web", "url"],
  },
  {
    name: "github",
    description: "操作 GitHub 仓库/issue/PR（需 GITHUB_PERSONAL_ACCESS_TOKEN）",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "<your-token>" },
    keywords: ["github", "git", "仓库", "issue", "pr"],
  },
  {
    name: "memory",
    description: "持久化知识图谱记忆",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    keywords: ["memory", "记忆", "知识图谱"],
  },
  {
    name: "sequential-thinking",
    description: "结构化逐步推理",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    keywords: ["thinking", "推理", "sequential"],
  },
  {
    name: "time",
    description: "获取当前时间与时区换算",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time", "--local-timezone=Asia/Shanghai"],
    keywords: ["time", "时间", "时区"],
  },
  {
    name: "brave-search",
    description: "Brave 网络搜索（需 BRAVE_API_KEY）",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "<your-key>" },
    keywords: ["brave", "搜索", "search", "网络"],
  },
  {
    name: "puppeteer",
    description: "浏览器自动化与网页截图",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    keywords: ["puppeteer", "浏览器", "截图", "browser"],
  },
  {
    name: "sqlite",
    description: "查询 SQLite 数据库",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "/path/to/db.sqlite"],
    keywords: ["sqlite", "数据库", "db", "sql"],
  },
  {
    name: "git",
    description: "本地 Git 仓库操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "/path/to/repo"],
    keywords: ["git", "版本控制"],
  },
  {
    name: "postgres",
    description: "查询 PostgreSQL 数据库（需连接串）",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],
    keywords: ["postgres", "postgresql", "数据库"],
  },
  {
    name: "mcp-installer",
    description: "在配置时按需安装其它 MCP 服务器",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-mcp-installer"],
    keywords: ["installer", "安装", "mcp-installer"],
  },
];

export const SKILL_CATALOG: CatalogSkill[] = [
  {
    name: "skill-creator",
    description: "指导如何创建高质量 Skill",
    url: "https://github.com/anthropics/skills",
    keywords: ["skill", "创建", "creator", "编写"],
  },
  {
    name: "mcp-builder",
    description: "指导如何构建 MCP Server",
    url: "https://github.com/anthropics/skills",
    keywords: ["mcp", "构建", "builder", "开发"],
  },
];

function score(haystack: string, q: string): number {
  const h = haystack.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle) return 0;
  if (h === needle) return 100;
  if (h.includes(needle)) return 80;
  return 0;
}

export function searchMcpCatalog(query: string): CatalogMCP[] {
  return MCP_CATALOG.filter((m) => {
    const blob = [m.name, m.description, ...m.keywords].join(" ");
    return score(blob, query) > 0;
  }).sort((a, b) => score([a.name, a.description].join(" "), query) - score([b.name, b.description].join(" "), query));
}

export function searchSkillCatalog(query: string): CatalogSkill[] {
  return SKILL_CATALOG.filter((s) => {
    const blob = [s.name, s.description, ...s.keywords].join(" ");
    return score(blob, query) > 0;
  });
}

export function findMcpByName(name: string): CatalogMCP | undefined {
  return MCP_CATALOG.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

export function findSkillByName(name: string): CatalogSkill | undefined {
  return SKILL_CATALOG.find((s) => s.name.toLowerCase() === name.toLowerCase());
}
