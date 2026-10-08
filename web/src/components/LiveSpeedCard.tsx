import { useEffect, useState } from "react";
import { Card, Statistic, Space } from "antd";
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

  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));

  return (
    <Card title="实时调用速度" size="small">
      <Space size={32} wrap>
        <Statistic title="源速度" value={fmt(live.source_speed)} suffix="tok/s" />
        <Statistic title="出口速度" value={fmt(live.egress_speed)} suffix="tok/s" />
        <Statistic title="活跃请求" value={live.active} />
      </Space>
    </Card>
  );
}
