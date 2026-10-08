import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Segmented,
  Select,
  DatePicker,
  Space,
  Table,
  Tag,
  Typography,
  Button,
  Tooltip,
  message,
} from "antd";
import { ReloadOutlined, DownloadOutlined } from "@ant-design/icons";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { api } from "../api";
import { useCurrency } from "../currency";
import dayjs, { type Dayjs } from "dayjs";

const { RangePicker } = DatePicker;

interface Summary {
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
  errors: number;
  models: number;
  keys: number;
}
interface Point {
  bucket: string;
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
}
interface ModelUsage {
  model_id: string;
  display_name: string;
  provider_name: string;
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  completion: number;
  cost: number;
  avg_latency: number;
  errors: number;
  input_price: number | null;
  input_cache_read_price: number | null;
  input_cache_write_price: number | null;
  output_price: number | null;
}
interface KeyModelUsage {
  model: string;
  requests: number;
  cost: number;
}
interface KeyUsage {
  api_key_id: string | null;
  name: string;
  prefix: string;
  key_enabled: number | null;
  monthly_limit_tokens: number | null;
  requests: number;
  tokens: number;
  cost: number;
  errors: number;
  last_used_at: number | null;
  models: KeyModelUsage[];
}

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Usage() {
  const { currency, formatCost, toDisplay, formatPrice } = useCurrency();
  const [granularity, setGranularity] = useState<string>("day");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")]);
  const [model, setModel] = useState<string | undefined>();
  const [keyId, setKeyId] = useState<string | undefined>();
  const [modelOpts, setModelOpts] = useState<{ name: string; display_name: string }[]>([]);
  const [keyOpts, setKeyOpts] = useState<{ id: string; name: string; key_prefix: string }[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeseries, setTimeseries] = useState<Point[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [keyUsage, setKeyUsage] = useState<KeyUsage[]>([]);
  const [metric, setMetric] = useState<string>("requests");
  const [loading, setLoading] = useState(false);

  const query = () => {
    const q = new URLSearchParams();
    if (range[0]) q.set("from", String(range[0].valueOf()));
    if (range[1]) q.set("to", String(range[1].valueOf()));
    if (model) q.set("model", model);
    if (keyId) q.set("api_key_id", keyId);
    return q.toString();
  };

  const load = () => {
    setLoading(true);
    const q = query();
    Promise.all([
      api.get<Summary>(`/api/usage/summary?${q}`),
      api.get<Point[]>(`/api/usage/timeseries?${q}&granularity=${granularity}`),
      api.get<ModelUsage[]>(`/api/usage/models?${q}`),
      api.get<KeyUsage[]>(`/api/usage/keys?${q}`),
    ])
      .then(([s, t, m, k]) => {
        setSummary(s);
        setTimeseries(t);
        setModelUsage(m);
        setKeyUsage(k);
      })
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  useEffect(() => {
    api.get<{ name: string; display_name: string }[]>("/api/models").then((ms) => setModelOpts(ms));
    api.get<{ id: string; name: string; key_prefix: string }[]>("/api/keys").then((ks) => setKeyOpts(ks));
  }, []);

  const chartData = useMemo(
    () => timeseries.map((p) => ({ ...p, cost_display: toDisplay(p.cost) })),
    [timeseries, toDisplay],
  );
  const metricMap: Record<string, { key: string; label: string }> = {
    requests: { key: "requests", label: "请求数" },
    tokens: { key: "tokens", label: "Token" },
    cost: { key: "cost_display", label: `成本 (${currency})` },
  };

  const tokenBreakdown = (r: { prompt: number; cache_read: number; cache_write: number; completion: number }) => (
    <div>
      <div>未命中输入：{Math.max(0, r.prompt - r.cache_read - r.cache_write).toLocaleString()}</div>
      <div>命中缓存：{r.cache_read.toLocaleString()}</div>
      <div>缓存写入：{r.cache_write.toLocaleString()}</div>
      <div>输出：{r.completion.toLocaleString()}</div>
    </div>
  );

  const priceLine = (m: ModelUsage) => (
    <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
      <span>未命中 {formatPrice(m.input_price ?? 0)}</span>
      <span>命中 {formatPrice(m.input_cache_read_price ?? 0)}</span>
      <span>写入 {formatPrice(m.input_cache_write_price ?? 0)}</span>
      <span>输出 {formatPrice(m.output_price ?? 0)}</span>
    </Space>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Space wrap size={12}>
          <Segmented
            value={granularity}
            onChange={(v) => setGranularity(v as string)}
            options={[
              { label: "按日", value: "day" },
              { label: "按周", value: "week" },
              { label: "按月", value: "month" },
              { label: "按年", value: "year" },
            ]}
          />
          <RangePicker
            value={range}
            onChange={(v) => v && setRange([v[0]!, v[1]!])}
            allowClear={false}
          />
          <Select
            placeholder="模型筛选（全部）"
            allowClear
            style={{ width: 220 }}
            value={model}
            onChange={(v) => setModel(v)}
            options={modelOpts.map((m) => ({ value: m.name, label: m.display_name || m.name }))}
            showSearch
            optionFilterProp="label"
          />
          <Select
            placeholder="密钥筛选（全部）"
            allowClear
            style={{ width: 200 }}
            value={keyId}
            onChange={(v) => setKeyId(v)}
            options={keyOpts.map((k) => ({ value: k.id, label: k.name }))}
            showSearch
            optionFilterProp="label"
          />
          <Button type="primary" onClick={load}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </Space>
      </Card>

      <Row gutter={16}>
        <Col span={4}>
          <Card loading={loading}>
            <Statistic title="总请求数" value={summary?.requests ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={loading}>
            <Tooltip title={summary ? tokenBreakdown(summary) : ""}>
              <Statistic title="总 Token" value={summary?.tokens ?? 0} />
            </Tooltip>
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={loading}>
            <Statistic title={`总成本 (${currency})`} value={toDisplay(summary?.cost ?? 0)} precision={4} prefix={currency === "CNY" ? "¥" : "$"} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={loading}>
            <Statistic title="活跃模型" value={summary?.models ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={loading}>
            <Statistic title="活跃密钥" value={summary?.keys ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={loading}>
            <Statistic title="错误数" value={summary?.errors ?? 0} valueStyle={{ color: (summary?.errors ?? 0) > 0 ? "#cf1322" : undefined }} />
          </Card>
        </Col>
      </Row>

      <Card
        title="趋势"
        loading={loading}
        extra={
          <Segmented
            value={metric}
            onChange={(v) => setMetric(v as string)}
            options={[
              { label: "请求数", value: "requests" },
              { label: "Token", value: "tokens" },
              { label: "成本", value: "cost" },
            ]}
          />
        }
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={70} />
            <RTooltip />
            <Line type="monotone" dataKey={metricMap[metric].key} name={metricMap[metric].label} stroke="#2563eb" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="按模型明细"
        loading={loading}
        extra={
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              exportCSV(
                `模型用量_${dayjs().format("YYYYMMDD")}.csv`,
                ["模型", "供应商", "请求数", "未命中输入", "命中缓存", "缓存写入", "输出", "总Token", "成本", "平均耗时ms", "错误数"],
                modelUsage.map((m) => [
                  m.display_name || m.model_id,
                  m.provider_name,
                  m.requests,
                  Math.max(0, m.prompt - m.cache_read - m.cache_write),
                  m.cache_read,
                  m.cache_write,
                  m.completion,
                  m.tokens,
                  m.cost,
                  Math.round(m.avg_latency),
                  m.errors,
                ]),
              )
            }
          >
            导出 CSV
          </Button>
        }
      >
        <Table
          rowKey="model_id"
          dataSource={modelUsage}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            {
              title: "模型",
              render: (_: unknown, r: ModelUsage) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{r.display_name || r.model_id}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.model_id}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: "供应商", dataIndex: "provider_name", render: (v: string) => v || "—" },
            { title: "请求数", dataIndex: "requests" },
            {
              title: "Token",
              dataIndex: "tokens",
              render: (v: number, r: ModelUsage) => (
                <Tooltip title={tokenBreakdown(r)}>
                  <span style={{ cursor: "help" }}>{v.toLocaleString()}</span>
                </Tooltip>
              ),
            },
            {
              title: `成本 (${currency})`,
              dataIndex: "cost",
              render: (v: number) => formatCost(v),
            },
            { title: "单价 (/1M)", render: (_: unknown, r: ModelUsage) => priceLine(r) },
            {
              title: "平均耗时",
              dataIndex: "avg_latency",
              render: (v: number) => `${Math.round(v)}ms`,
            },
            {
              title: "错误率",
              render: (_: unknown, r: ModelUsage) => {
                const rate = r.requests ? (r.errors / r.requests) * 100 : 0;
                return <Tag color={rate > 5 ? "red" : rate > 0 ? "orange" : "green"}>{rate.toFixed(1)}%</Tag>;
              },
            },
          ]}
        />
      </Card>

      <Card
        title="按密钥明细"
        loading={loading}
        extra={
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              exportCSV(
                `密钥用量_${dayjs().format("YYYYMMDD")}.csv`,
                ["密钥", "请求数", "Token", "成本", "错误数", "使用模型"],
                keyUsage.map((k) => [
                  `${k.name}${k.prefix ? `(${k.prefix}…)` : ""}`,
                  k.requests,
                  k.tokens,
                  k.cost,
                  k.errors,
                  k.models.map((m) => `${m.model}(${m.requests}次)`).join("; "),
                ]),
              )
            }
          >
            导出 CSV
          </Button>
        }
      >
        <Table
          rowKey="api_key_id"
          dataSource={keyUsage}
          pagination={false}
          expandable={{
            expandedRowRender: (r: KeyUsage) => (
              <Table
                rowKey="model"
                size="small"
                dataSource={r.models}
                pagination={false}
                columns={[
                  { title: "模型", dataIndex: "model", render: (v: string) => <Tag>{v}</Tag> },
                  { title: "请求数", dataIndex: "requests" },
                  { title: `成本 (${currency})`, dataIndex: "cost", render: (v: number) => formatCost(v) },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: "密钥",
              render: (_: unknown, r: KeyUsage) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{r.name}</Typography.Text>
                  {r.prefix && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.prefix}…
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: "请求数", dataIndex: "requests" },
            { title: "Token", dataIndex: "tokens", render: (v: number) => v.toLocaleString() },
            { title: `成本 (${currency})`, dataIndex: "cost", render: (v: number) => formatCost(v) },
            { title: "错误", dataIndex: "errors" },
            {
              title: "使用模型",
              dataIndex: "models",
              render: (models: KeyModelUsage[]) =>
                models.length ? models.map((m) => <Tag key={m.model}>{m.model}</Tag>) : "—",
            },
            {
              title: "最近使用",
              dataIndex: "last_used_at",
              render: (v: number | null) => (v ? dayjs(v).format("MM-DD HH:mm") : "—"),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
