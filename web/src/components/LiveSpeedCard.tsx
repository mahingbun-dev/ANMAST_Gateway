import { useEffect, useState } from "react";
import { Card, Statistic, Space, Badge, Typography } from "antd";
import { api } from "../api";

interface LiveSpeed {
  speed: number | null;
  active: number;
}

/** 仪表盘实时调用速度卡片（每秒轮询） */
export default function LiveSpeedCard() {
  const [live, setLive] = useState<LiveSpeed>({ speed: null, active: 0 });

  useEffect(() => {
    const load = () => api.get<LiveSpeed>("/api/usage/live").then(setLive).catch(() => {});
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);

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
        <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 460, lineHeight: 1.6 }}>
          说明：实时速度仅在「真流式透传」（客户端与上游同协议）时可用；跨协议（如 Claude Code → OpenAI）
          走非流式缓冲，此期间仅显示「处理中」。速度按输出内容长度估算（约 3 字符 ≈ 1 token），仅供参考。
        </Typography.Text>
      </Space>
    </Card>
  );
}
