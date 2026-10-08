import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Table, Typography, Space, Tag, Empty } from "antd";
import {
  FileTextOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import { useCurrency } from "../currency";
import { useRefresh } from "../refresh";
import dayjs from "dayjs";

interface Stats {
  totals: {
    requests: number;
    tokens: number;
    prompt_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    completion_tokens: number;
    cost: number;
    errors: number;
  };
  daily: { day: string; requests: number; tokens: number; cost: number }[];
  byModel: { model_used: string; requests: number; tokens: number; cost: number }[];
  byKey: {
    api_key_id: string | null;
    name: string;
    key_prefix: string;
    requests: number;
    tokens: number;
    cost: number;
    errors: number;
    month_tokens: number;
    month_cost: number;
    last_used_at: number | null;
  }[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const { currency, symbol, toDisplay, formatCost } = useCurrency();
  const { tick } = useRefresh();

  const load = () => {
    setLoading(true);
    api
      .get<Stats>("/api/stats")
      .then(setStats)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  useEffect(() => {
    if (tick > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const daily = stats?.daily ?? [];
  const maxRequests = Math.max(1, ...daily.map((d) => d.requests));
  const t = stats?.totals;
  const uncachedInput = t ? Math.max(0, t.prompt_tokens - t.cache_read_tokens - t.cache_creation_tokens) : 0;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic title="总调用次数" value={stats?.totals.requests ?? 0} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic title="总 Token" value={stats?.totals.tokens ?? 0} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title={`估算成本 (${currency})`}
              value={toDisplay(stats?.totals.cost ?? 0)}
              precision={6}
              prefix={symbol}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title="错误次数"
              value={stats?.totals.errors ?? 0}
              prefix={<WarningOutlined />}
              valueStyle={{ color: (stats?.totals.errors ?? 0) > 0 ? "#cf1322" : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Token 统计（区分缓存命中）" loading={loading}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="输入 · 未命中缓存" value={uncachedInput} />
          </Col>
          <Col span={6}>
            <Statistic title="输入 · 命中缓存" value={t?.cache_read_tokens ?? 0} valueStyle={{ color: "#389e0d" }} />
          </Col>
          <Col span={6}>
            <Statistic title="输入 · 缓存写入" value={t?.cache_creation_tokens ?? 0} valueStyle={{ color: "#d46b08" }} />
          </Col>
          <Col span={6}>
            <Statistic title="输出" value={t?.completion_tokens ?? 0} />
          </Col>
        </Row>
      </Card>

      <Card title="近 30 天调用趋势" loading={loading}>
        {daily.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160 }}>
            {daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${d.requests} 次`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    width: "70%",
                    height: `${Math.max(4, (d.requests / maxRequests) * 140)}px`,
                    background: "#2563eb",
                    borderRadius: 3,
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {daily.length > 0 && `${daily[0].day} ~ ${daily[daily.length - 1].day}`}
        </Typography.Text>
      </Card>

      <Card title="模型用量排行" loading={loading}>
        <Table
          rowKey="model_used"
          pagination={false}
          dataSource={stats?.byModel ?? []}
          columns={[
            { title: "模型", dataIndex: "model_used" },
            { title: "调用次数", dataIndex: "requests" },
            { title: "Token", dataIndex: "tokens" },
            {
              title: `成本 (${currency})`,
              dataIndex: "cost",
              render: (v: number) => <Tag color="green">{formatCost(v)}</Tag>,
            },
          ]}
          locale={{ emptyText: "暂无数据" }}
        />
      </Card>

      <Card title="按密钥成本账单" loading={loading}>
        <Table
          rowKey="api_key_id"
          pagination={false}
          dataSource={stats?.byKey ?? []}
          columns={[
            {
              title: "密钥",
              render: (_: unknown, r: Stats["byKey"][number]) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{r.name}</Typography.Text>
                  {r.key_prefix && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.key_prefix}…
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: "调用次数", dataIndex: "requests" },
            { title: "总 Token", dataIndex: "tokens", render: (v: number) => v.toLocaleString() },
            {
              title: `总成本 (${currency})`,
              dataIndex: "cost",
              render: (v: number) => <Tag color="green">{formatCost(v)}</Tag>,
            },
            {
              title: "本月 Token",
              dataIndex: "month_tokens",
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: `本月成本 (${currency})`,
              dataIndex: "month_cost",
              render: (v: number) => formatCost(v),
            },
            { title: "错误", dataIndex: "errors" },
            {
              title: "最近使用",
              dataIndex: "last_used_at",
              render: (v: number | null) => (v ? dayjs(v).format("MM-DD HH:mm") : "—"),
            },
          ]}
          locale={{ emptyText: "暂无数据" }}
        />
      </Card>
    </Space>
  );
}
