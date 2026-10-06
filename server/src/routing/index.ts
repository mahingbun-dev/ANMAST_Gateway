import { listModels, getModel, listTiers } from "../db/repos/models.js";
import { getProvider } from "../db/repos/models.js";
import { getSetting } from "../db/index.js";
import { getAdapter } from "../providers/index.js";
import type { ModelConfig, Provider, ChatMessage, TierSource } from "../types.js";
import { logger } from "../logger.js";

export interface ModelWithProvider {
  model: ModelConfig;
  provider: Provider;
}

export interface ResolvedTarget {
  candidates: ModelWithProvider[];
  tierId: string | null;
  tierSource: TierSource | null;
  usedComplexity: string | null;
  viaAutoDetect: boolean;
}

/** 列出所有可用（模型与供应商均启用）的模型 */
export function listEnabledModels(): ModelWithProvider[] {
  const out: ModelWithProvider[] = [];
  for (const m of listModels()) {
    if (!m.enabled) continue;
    const provider = getProvider(m.provider_id);
    if (!provider || !provider.enabled) continue;
    out.push({ model: m, provider });
  }
  return out;
}

function parseTiers(model: ModelConfig): string[] {
  try {
    const t = JSON.parse(model.tiers);
    return Array.isArray(t) ? t.map(String) : [];
  } catch {
    return [];
  }
}

/** 根据请求的模型名与复杂度，解析出候选模型（有序） */
export function resolveModel(
  requestedModel: string | undefined,
  complexity: string | undefined,
): ResolvedTarget {
  const enabled = listEnabledModels();
  const tierList = listTiers().map((t) => t.id);

  // 1. 直接指定已知模型
  if (requestedModel && requestedModel !== "auto" && requestedModel !== "router") {
    const direct = enabled.find(
      (x) =>
        x.model.id === requestedModel ||
        x.model.name === requestedModel ||
        x.model.display_name === requestedModel,
    );
    if (direct) {
      return {
        candidates: [direct],
        tierId: null,
        tierSource: null,
        usedComplexity: null,
        viaAutoDetect: false,
      };
    }
  }

  // 2. 复杂度路由
  let tier = complexity && tierList.includes(complexity) ? complexity : null;
  const source: TierSource = tier ? "explicit" : "fallback";
  let used = tier;

  const candidatesFor = (t: string): ModelWithProvider[] =>
    enabled
      .filter((x) => parseTiers(x.model).includes(t))
      .sort((a, b) => a.model.priority - b.model.priority);

  if (!tier) {
    // 未显式指定时，由网关决定（auto-detect 在编排层完成后再传入）
    const def = getSetting<string>("default_tier", "medium");
    tier = tierList.includes(def ?? "") ? (def as string) : tierList[0] ?? null;
    used = tier;
  }

  let candidates: ModelWithProvider[] = tier ? candidatesFor(tier) : [];

  // 3. 当前层级无可用模型 → 层级降级/提升
  if (candidates.length === 0 && tier) {
    const order = ["medium", "high", "low", ...tierList];
    for (const t of order) {
      if (t === tier) continue;
      const cs = candidatesFor(t);
      if (cs.length) {
        candidates = cs;
        used = t;
        break;
      }
    }
  }

  // 4. 仍然没有 → 使用任意可用模型
  if (candidates.length === 0) {
    candidates = enabled.slice().sort((a, b) => a.model.priority - b.model.priority);
  }

  return {
    candidates,
    tierId: tier,
    tierSource: source,
    usedComplexity: used,
    viaAutoDetect: false,
  };
}

const CLASSIFY_SYSTEM = `你是一个任务复杂度分类器。请分析用户请求，判断其工作复杂度，只输出一个 JSON 对象，不要输出任何其它文字。

分类标准：
- "low"：简单问答、翻译、摘要短文本、改写、分类、提取等轻量任务
- "medium"：常规对话、代码编写、文档撰写、中等长度分析等
- "high"：复杂推理、多步骤规划、长文档深度分析、复杂代码架构、数学/科学难题等

输出格式（严格 JSON）：
{"complexity":"low"}

请根据最近一条用户消息判断，只输出该 JSON。`;

/** 使用路由器模型自动判断任务复杂度，返回 tier id（low/medium/high 或 null） */
export async function autoDetectComplexity(messages: ChatMessage[]): Promise<string | null> {
  const routerId = getSetting<string>("router_model_id");
  if (!routerId) return null;
  const router = getModel(routerId);
  if (!router || !router.enabled) return null;
  const provider = getProvider(router.provider_id);
  if (!provider || !provider.enabled) return null;

  const userText = messages
    .filter((m) => m.role === "user" && m.content)
    .map((m) => m.content)
    .join("\n")
    .slice(-6000);
  if (!userText.trim()) return null;

  try {
    const adapter = getAdapter(provider);
    const res = await adapter.chat({
      model: router.name,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: userText },
      ],
      stream: false,
      maxTokens: 64,
      temperature: 0,
      extra: { __provider: provider },
    });
    const text = (res.message.content ?? "").trim();
    const m = text.match(/\{[^{}]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as { complexity?: string };
      const c = (obj.complexity ?? "").toLowerCase();
      if (["low", "medium", "high"].includes(c)) return c;
    }
    const lower = text.toLowerCase();
    if (lower.includes("high")) return "high";
    if (lower.includes("low")) return "low";
    if (lower.includes("medium")) return "medium";
    return null;
  } catch (e) {
    logger.warn("自动复杂度判定失败，回退默认层级", e);
    return null;
  }
}

export function pickByTier(tier: string): ModelWithProvider | undefined {
  return listEnabledModels()
    .filter((x) => parseTiers(x.model).includes(tier))
    .sort((a, b) => a.model.priority - b.model.priority)[0];
}
