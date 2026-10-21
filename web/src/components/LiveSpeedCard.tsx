import { useEffect, useRef, useState } from "react";
import { Card, Statistic, Space, Badge, Typography, Divider } from "antd";
import { api } from "../api";
import { useRefresh } from "../refresh";

interface LiveSpeed {
  speed: number | null;
  active: number;
}

interface LatencySample {
  t: number;
  ms: number;
}

function avg(samples: LatencySample[]): number | null {
  if (!samples.length) return null;
  return samples.reduce((a, s) => a + s.ms, 0) / samples.length;
}

const fmtMs = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}ms`);

/** 仪表盘实时调用速度 + 页面到服务器延迟卡片 */
export default function LiveSpeedCard() {
  const [live, setLive] = useState<LiveSpeed>({ speed: null, active: 0 });
  const [latency, setLatency] = useState<{ current: number | null; m10: number | null; m30: number | null }>({
    current: null,
    m10: null,
    m30: null,
  });
  const samplesRef = useRef<LatencySample[]>([]);
  const { enabled, sec } = useRefresh();

  // 实时速度：每秒轮询
  useEffect(() => {
    const load = () => api.get<LiveSpeed>("/api/usage/live").then(setLive).catch(() => {});
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);

  // 页面到服务器延迟：默认 10 秒；自动刷新开启时用自动刷新间隔
  useEffect(() => {
    const measure = async () => {
      const start = performance.now();
      try {
        await fetch("/healthz");
        const ms = performance.now() - start;
        const now = Date.now();
        samplesRef.current.push({ t: now, ms });
        // 只保留近 30 分钟
        samplesRef.current = samplesRef.current.filter((s) => now - s.t <= 30 * 60 * 1000);
        const all = samplesRef.current;
        setLatency({
          current: all[all.length - 1]?.ms ?? null,
          m10: avg(all.filter((s) => now - s.t <= 10 * 60 * 1000)),
          m30: avg(all),
        });
      } catch {
        /* ignore */
      }
    };
    measure();
    const intervalSec = enabled ? sec : 10;
    const t = setInterval(measure, intervalSec * 1000);
    return () => clearInterval(t);
  }, [enabled, sec]);

  const busy = live.active > 0;
  const value = live.speed != null ? live.speed.toFixed(1) : busy ? "处理中…" : "—";

  return (
    <Card title="实时调用速度" size="small">
      <Space size={32} wrap align="start">
        <Statistic
          title={
            <Space size={4}>
              {busy && <Badge status="processing" />}
              活跃请求
            </Space>
          }
          value={live.active}
        />
        <Statistic title="实时输出速度" value={value} suffix={live.speed != null ? "tok/s" : ""} />
        <Divider type="vertical" style={{ height: 48 }} />
        <Statistic title="当前延迟" value={fmtMs(latency.current)} />
        <Statistic title="近 10 分钟延迟" value={fmtMs(latency.m10)} />
        <Statistic title="近 30 分钟延迟" value={fmtMs(latency.m30)} />
        <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 460, lineHeight: 1.6 }}>
          说明：实时速度仅在「真流式透传」（客户端与上游同协议）时可用；跨协议走非流式缓冲，此期间仅显示「处理中」。
          延迟为「页面到网关服务器」的往返耗时，默认每 10 秒更新；开启自动刷新后按自动刷新间隔更新。
        </Typography.Text>
      </Space>
    </Card>
  );
}
