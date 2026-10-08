// 流式请求的实时状态追踪（内存态，用于「streaming」记录的实时速度展示）

export interface LiveStream {
  startedAt: number;
  firstTokenAt: number | null;
  tokens: number; // 估算的已完成输出 token
  updatedAt: number;
}

const streams = new Map<string, LiveStream>();

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
