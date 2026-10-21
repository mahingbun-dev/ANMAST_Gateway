// 各客户端（按来源 IP 区分）到网关的延迟记录（内存态，保留近 30 分钟）
// 用于仪表盘展示：当前延迟 / 近 10 分钟 / 近 30 分钟，页面刷新后不丢失。

interface LatencySample {
  t: number;
  ms: number;
}

const store = new Map<string, LatencySample[]>();
const WINDOW_30MIN = 30 * 60 * 1000;
const WINDOW_10MIN = 10 * 60 * 1000;

function avg(arr: LatencySample[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, s) => a + s.ms, 0) / arr.length;
}

export function recordLatency(clientIp: string, ms: number): void {
  const now = Date.now();
  const arr = (store.get(clientIp) ?? []).filter((s) => now - s.t <= WINDOW_30MIN);
  arr.push({ t: now, ms });
  store.set(clientIp, arr);
}

export function getLatency(clientIp: string): {
  current: number | null;
  m10: number | null;
  m30: number | null;
} {
  const now = Date.now();
  const recent = (store.get(clientIp) ?? []).filter((s) => now - s.t <= WINDOW_30MIN);
  return {
    current: recent[recent.length - 1]?.ms ?? null,
    m10: avg(recent.filter((s) => now - s.t <= WINDOW_10MIN)),
    m30: avg(recent),
  };
}
