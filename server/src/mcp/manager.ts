import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "../types.js";
import { listMcpServers, getMcpServer } from "../db/repos/ext.js";
import { logger } from "../logger.js";

interface ConnectedServer {
  client: Client;
  tools: ToolDefinition[];
  connectedAt: number;
}

const registry = new Map<string, ConnectedServer>();

export interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

function parseConfig<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return {} as T;
  }
}

function makeTransport(transport: string, configJson: string) {
  if (transport === "stdio") {
    const cfg = parseConfig<StdioConfig>(configJson);
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      stderr: "pipe",
    });
  }
  if (transport === "sse") {
    const cfg = parseConfig<HttpConfig>(configJson);
    return new SSEClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
  }
  // streamable-http
  const cfg = parseConfig<HttpConfig>(configJson);
  return new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
  });
}

/** 连接单个 MCP Server 并缓存其工具列表 */
export async function connectServer(serverId: string): Promise<ToolDefinition[]> {
  const cached = registry.get(serverId);
  if (cached && cached.client) return cached.tools;

  const server = getMcpServer(serverId);
  if (!server || !server.enabled) return [];

  const client = new Client({ name: "anmast-gateway", version: "0.1.0" });
  const transport = makeTransport(server.transport, server.config);
  await client.connect(transport);
  const { tools } = await client.listTools();
  const defs: ToolDefinition[] = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    },
  }));
  registry.set(serverId, { client, tools: defs, connectedAt: Date.now() });
  logger.info(`MCP Server 已连接：${server.name}（${defs.length} 个工具）`);
  return defs;
}

export async function disconnectServer(serverId: string): Promise<void> {
  const entry = registry.get(serverId);
  if (entry) {
    try {
      await entry.client.close();
    } catch {
      /* ignore */
    }
    registry.delete(serverId);
  }
}

/** 重新连接（配置变更后调用） */
export async function refreshServer(serverId: string): Promise<ToolDefinition[]> {
  await disconnectServer(serverId);
  return connectServer(serverId);
}

/** 获取所有启用 MCP Server 的工具（按需连接） */
export async function listAllTools(): Promise<ToolDefinition[]> {
  const servers = listMcpServers().filter((s) => s.enabled);
  const all: ToolDefinition[] = [];
  for (const s of servers) {
    try {
      const tools = await connectServer(s.id);
      all.push(...tools);
    } catch (e) {
      logger.warn(`MCP Server「${s.name}」连接失败，已跳过`, e);
    }
  }
  return all;
}

/** 获取指定若干 MCP Server 的工具（按需连接） */
export async function listToolsFromServers(serverIds: string[]): Promise<ToolDefinition[]> {
  const all: ToolDefinition[] = [];
  for (const id of serverIds) {
    const server = getMcpServer(id);
    if (!server || !server.enabled) continue;
    try {
      const tools = await connectServer(id);
      all.push(...tools);
    } catch (e) {
      logger.warn(`MCP Server「${server.name}」连接失败，已跳过`, e);
    }
  }
  return all;
}

/** 获取指定 MCP Server 的工具 */
export async function listServerTools(serverId: string): Promise<ToolDefinition[]> {
  try {
    return await connectServer(serverId);
  } catch (e) {
    logger.warn(`MCP Server ${serverId} 连接失败`, e);
    return [];
  }
}

export interface ToolCallResult {
  content: string;
  isError: boolean;
}

/** 在指定 MCP Server 上执行工具调用 */
export async function callToolOnServer(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  let entry = registry.get(serverId);
  if (!entry) {
    await connectServer(serverId);
    entry = registry.get(serverId);
  }
  if (!entry) {
    return { content: `MCP Server ${serverId} 未连接`, isError: true };
  }
  const result = await entry.client.callTool({ name: toolName, arguments: args });
  const blocks = (result.content ?? []) as { type?: string; text?: string }[];
  const content = blocks
    .map((c) => {
      if (c.type === "text") return c.text ?? "";
      return JSON.stringify(c);
    })
    .join("\n");
  return { content, isError: !!result.isError };
}

/** 查找负责执行某工具名的 MCP Server（含连接，返回 serverId） */
export async function findToolOwner(toolName: string): Promise<string | null> {
  for (const s of listMcpServers().filter((x) => x.enabled)) {
    const tools = await listServerTools(s.id);
    if (tools.some((t) => t.function.name === toolName)) return s.id;
  }
  return null;
}

/** 关闭所有连接 */
export async function closeAll(): Promise<void> {
  for (const id of [...registry.keys()]) {
    await disconnectServer(id);
  }
}
