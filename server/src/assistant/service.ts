import type { ChatMessage } from "../types.js";
import type { Usage } from "../providers/types.js";
import { getAdapter } from "../providers/index.js";
import { listEnabledModels, type ModelWithProvider } from "../routing/index.js";
import { getSetting } from "../db/index.js";
import { listProviders, listModels, listTiers } from "../db/repos/models.js";
import { listSkills, listMcpServers } from "../db/repos/ext.js";
import { listApiKeys } from "../db/repos/auth.js";
import { combineBuiltinSkills } from "./skills.js";
import { ASSISTANT_TOOLS, executeAssistantTool } from "./tools.js";
import { fakeOpenAIStream, genId } from "../gateway/respond.js";

export interface AssistantResult {
  message: ChatMessage;
  usage: Usage;
  modelName: string;
  id?: string;
}

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

/** 组装当前网关配置快照，作为助手上下文（只读） */
function buildConfigSnapshot(): string {
  const providers = listProviders().map((p) => ({
    name: p.name,
    type: p.type,
    base_url: p.base_url,
    api_key: maskKey(p.api_key),
    enabled: p.enabled,
  }));
  const models = listModels().map((m) => {
    const p = listProviders().find((x) => x.id === m.provider_id);
    let tiers: string[] = [];
    try {
      tiers = JSON.parse(m.tiers);
    } catch {
      /* ignore */
    }
    return {
      name: m.name,
      display_name: m.display_name,
      provider: p?.name ?? m.provider_id,
      tiers,
      context_window: m.context_window,
      input_price: m.input_price,
      output_price: m.output_price,
      priority: m.priority,
      is_router: m.is_router,
      enabled: m.enabled,
    };
  });
  const tiers = listTiers().map((t) => ({ id: t.id, name: t.name, description: t.description }));
  const skills = listSkills()
    .filter((s) => s.enabled)
    .map((s) => ({ name: s.name, description: s.description }));
  const mcp = listMcpServers().map((s) => ({
    name: s.name,
    transport: s.transport,
    enabled: s.enabled,
  }));
  const keys = listApiKeys().map((k) => ({
    name: k.name,
    prefix: k.key_prefix,
    enabled: k.enabled,
    monthly_limit_tokens: k.monthly_limit_tokens,
  }));
  const settings = {
    router_model_id: getSetting<string>("router_model_id", ""),
    assistant_model_id: getSetting<string>("assistant_model_id", ""),
    auto_detect_enabled: getSetting<boolean>("auto_detect_enabled", true),
    default_tier: getSetting<string>("default_tier", "medium"),
    mcp_tools_mode: getSetting<string>("mcp_tools_mode", "on_demand"),
    max_tool_steps: getSetting<number>("max_tool_steps", 8),
  };

  const snapshot = { providers, models, tiers, skills, mcp_servers: mcp, api_keys: keys, settings };
  return `# 当前网关配置快照（实时，只读）\n${JSON.stringify(snapshot, null, 2)}`;
}

function resolveAssistantModel(): ModelWithProvider | undefined {
  const enabled = listEnabledModels();
  if (enabled.length === 0) return undefined;
  const assistantId = getSetting<string>("assistant_model_id");
  if (assistantId) {
    const m = enabled.find((x) => x.model.id === assistantId);
    if (m) return m;
  }
  const routerId = getSetting<string>("router_model_id");
  if (routerId) {
    const m = enabled.find((x) => x.model.id === routerId);
    if (m) return m;
  }
  return enabled[0];
}

const TOOL_LABELS: Record<string, string> = {
  search_catalog: "搜索安装目录",
  install_skill: "安装 Skill",
  install_mcp: "安装 MCP 服务器",
};

/** 运行助手循环，通过 onProgress 回报当前进度 */
async function runAssistantLoop(
  messages: ChatMessage[],
  onProgress: (msg: string) => void,
): Promise<AssistantResult> {
  const cand = resolveAssistantModel();
  if (!cand) {
    throw new Error(
      "未找到可用的助手模型。请先在「模型」页添加至少一个模型，或在「路由与层级」页选择 AI 助手模型。",
    );
  }
  const systemPrompt = `${combineBuiltinSkills()}\n\n${buildConfigSnapshot()}`;
  const adapter = getAdapter(cand.provider);
  const maxSteps = 8;
  const working: ChatMessage[] = [...messages];
  let lastId: string | undefined;
  let lastUsage: Usage = {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let lastMessage: ChatMessage = { role: "assistant", content: null };

  for (let step = 0; step < maxSteps; step++) {
    onProgress("正在思考…");
    const res = await adapter.chat({
      model: cand.model.name,
      messages: [{ role: "system", content: systemPrompt }, ...working],
      stream: false,
      temperature: 0.3,
      tools: ASSISTANT_TOOLS,
      extra: { __provider: cand.provider },
    });
    lastId = res.id;
    lastUsage = res.usage;
    lastMessage = res.message;

    const calls = res.message.tool_calls ?? [];
    if (!calls.length) {
      return { message: res.message, usage: res.usage, modelName: cand.model.name, id: res.id };
    }

    working.push({ role: "assistant", content: res.message.content, tool_calls: calls });
    for (const tc of calls) {
      const label = TOOL_LABELS[tc.function.name] ?? tc.function.name;
      onProgress(`正在${label}…`);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* ignore */
      }
      let content: string;
      try {
        content = await executeAssistantTool(tc.function.name, args);
      } catch (e) {
        content = `执行失败：${(e as Error).message}`;
      }
      onProgress(`${label}完成`);
      working.push({ role: "tool", content, tool_call_id: tc.id });
    }
  }

  return {
    message: lastMessage,
    usage: lastUsage,
    modelName: cand.model.name,
    id: lastId,
  };
}

/**
 * 处理网页内 AI 助手的对话（含受限的安装工具循环）。
 * 沙箱约束：仅使用内置配置 Skill + 配置快照作为系统提示；工具仅限白名单内的安装工具
 * （search_catalog / install_skill / install_mcp），不注入用户 Skill、不注入 MCP 工具、不做复杂度路由。
 */
export async function handleAssistantChat(
  messages: ChatMessage[],
): Promise<AssistantResult> {
  return runAssistantLoop(messages, () => {});
}

/** 流式版本：先实时产出进度事件，再产出最终回答（OpenAI SSE 格式） */
export async function* assistantChatStream(
  messages: ChatMessage[],
): AsyncIterable<string> {
  const queue: string[] = [];
  let finished = false;
  let waiter: (() => void) | undefined;

  const push = (s: string) => {
    queue.push(s);
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w();
    }
  };

  const task = (async () => {
    try {
      const result = await runAssistantLoop(messages, (msg) =>
        push(`data: ${JSON.stringify({ type: "progress", message: msg })}\n\n`),
      );
      const final = {
        content: result.message.content,
        toolCalls: result.message.tool_calls,
        usage: result.usage,
      };
      const meta = {
        model: result.modelName,
        id: result.id ?? genId("chatcmpl"),
        created: Math.floor(Date.now() / 1000),
        protocol: "openai" as const,
      };
      for await (const chunk of fakeOpenAIStream(final, meta)) push(chunk);
    } catch (e) {
      push(
        `data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`,
      );
      push(`data: [DONE]\n\n`);
    } finally {
      finished = true;
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        w();
      }
    }
  })();

  for (;;) {
    while (queue.length === 0 && !finished) {
      await new Promise<void>((r) => {
        waiter = r;
      });
    }
    while (queue.length) yield queue.shift()!;
    if (finished) break;
  }
  await task;
}
