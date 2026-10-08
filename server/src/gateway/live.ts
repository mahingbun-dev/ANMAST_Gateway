// 流式请求的实时状态追踪（内存态，用于「streaming」记录的实时速度展示）

export interface LiveStream {
  startedAt: number;
  firstTokenAt: number | null;
  tokens: number; // 估算的已完成输出 token
  updatedAt: number;
}

const streams = new Map<string, LiveStream>();
const active = new Set<string>();

export function markActive(id: string): void {
  active.add(id);
}

export function markDone(id: string): void {
  active.delete(id);
}

export function startLiveStream(id: string, startedAt: number): void {
  streams.set(id, { startedAt, firstTokenAt: null, tokens: 0, updatedAt: startedAt });
}

export function updateLiveStream(id: string, textLength: number): void {
  const s = streams.get(id);
  if (!s) return;
  const now = Date.now();
  // 粗略估算 token（约 4 字符 1 token），仅用于实时展示
  s.tokens = Math.max(s.tokens, Math.floor(textLength / 4));
  s.updatedAt = now;
  if (s.firstTokenAt === null && textLength > 0) s.firstTokenAt = now;
}

export function finishLiveStream(id: string): { firstTokenAt: number | null } {
  const s = streams.get(id);
  streams.delete(id);
  return { firstTokenAt: s?.firstTokenAt ?? null };
}

export function getLiveStream(id: string): LiveStream | undefined {
  return streams.get(id);
}

/** 全局实时速度：聚合所有在途流式请求（tokens/秒），并返回活跃请求数 */
export function getGlobalLiveSpeed(): {
  source_speed: number | null;
  egress_speed: number | null;
  active: number;
} {
  const now = Date.now();
  let tokens = 0;
  let durationMs = 0;
  let streaming = 0;
  for (const s of streams.values()) {
    if (s.firstTokenAt) {
      tokens += s.tokens;
      durationMs += now - s.firstTokenAt;
      streaming++;
    }
  }
  const speed = streaming > 0 && durationMs > 0 ? tokens / (durationMs / 1000) : null;
  return { source_speed: speed, egress_speed: speed, active: active.size };
}
