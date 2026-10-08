import { useEffect, useState } from "react";
import { Card, Statistic, Space, Badge } from "antd";
import { api } from "../api";

interface LiveSpeed {
  source_speed: number | null;
  egress_speed: number | null;
  active: number;
}

/** 仪表盘实时调用速度卡片（每秒轮询） */
export default function LiveSpeedCard() {
  const [live, setLive] = useState<LiveSpeed>({ source_speed: null, egress_speed: null, active: 0 });

  useEffect(() => {
    const load = () => api.get<LiveSpeed>("/api/usage/live").then(setLive).catch(() => {});
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);

  const busy = live.active > 0;
  // 有活跃请求但无流式速度（跨协议非流式处理中）→ 显示「处理中」
  const fmt = (v: number | null) => {
    if (v == null) return busy ? "处理中…" : "—";
    return v.toFixed(1);
  };

  return (
    <Card title="实时调用速度" size="small">
      <Space size={32} wrap>
        <Statistic
          title={
            <Space size={4}>
              {busy && <Badge status="processing" />}
              活跃请求
            </Space>
          }
          value={live.active}
        />
        <Statistic title="源速度（输入）" value={fmt(live.source_speed)} suffix={live.source_speed != null ? "tok/s" : ""} />
        <Statistic title="出口速度（输出）" value={fmt(live.egress_speed)} suffix={live.egress_speed != null ? "tok/s" : ""} />
      </Space>
    </Card>
  );
}
