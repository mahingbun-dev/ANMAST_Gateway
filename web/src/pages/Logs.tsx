import { useEffect, useState } from "react";
import {
  Table,
  Input,
  Select,
  Space,
  Tag,
  Button,
  Modal,
  Typography,
  Tabs,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { api } from "../api";
import { useCurrency } from "../currency";
import { useRefresh } from "../refresh";
import dayjs from "dayjs";

interface RequestRecord {
  id: string;
  protocol: string;
  upstream_protocol: string | null;
  model_requested: string;
  model_used: string;
  tier_id: string | null;
  tier_source: string | null;
  status: string;
  error: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost: number;
  latency_ms: number;
  source_speed: number | null;
  egress_speed: number | null;
  client_ip: string | null;
  conversation_id: string | null;
  request_json: string | null;
  response_json: string | null;
  created_at: number;
}

const statusColor: Record<string, string> = { success: "green", error: "red", streaming: "blue", cancelled: "default" };

export default function Logs() {
  const [data, setData] = useState<RequestRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [protocol, setProtocol] = useState<string | undefined>();
  const [detail, setDetail] = useState<RequestRecord & { messages?: { role: string; content: string | null }[] } | null>(null);
  const { currency, formatCost } = useCurrency();
  const { tick } = useRefresh();

  const load = (p = page, ps = pageSize, silent = false) => {
    if (!silent) setLoading(true);
    const q = new URLSearchParams({ page: String(p), pageSize: String(ps) });
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    if (protocol) q.set("protocol", protocol);
    api
      .get<{ items: RequestRecord[]; total: number }>(`/api/logs?${q.toString()}`)
      .then((r) => {
        setData(r.items);
        setTotal(r.total);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tick > 0) load(page, pageSize, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const openDetail = async (id: string) => {
    const r = await api.get<RequestRecord & { messages?: { role: string; content: string | null }[] }>(`/api/logs/${id}`);
    setDetail(r);
  };

  const pretty = (s: string | null) => {
    if (!s) return "（无）";
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, width: "100%" }} wrap>
        <Input.Search
          placeholder="搜索模型 / 请求ID / 会话ID"
          allowClear
          style={{ width: 280 }}
          onSearch={() => load(1)}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 120 }}
          value={status}
          onChange={(v) => setStatus(v)}
          options={[
            { value: "success", label: "success" },
            { value: "error", label: "error" },
            { value: "streaming", label: "streaming" },
            { value: "cancelled", label: "cancelled" },
          ]}
        />
        <Select
          placeholder="协议"
          allowClear
          style={{ width: 140 }}
          value={protocol}
          onChange={(v) => setProtocol(v)}
          options={[
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
          ]}
        />
        <Button type="primary" onClick={() => load(1)}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => load(page, pageSize)}>
          刷新
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            load(p, ps);
          },
        }}
        columns={[
          {
            title: "时间",
            dataIndex: "created_at",
            width: 150,
            render: (v: number) => dayjs(v).format("MM-DD HH:mm:ss"),
          },
          {
            title: "协议",
            render: (_: unknown, r: RequestRecord) => {
              const client = r.protocol === "anthropic" ? "Anthropic" : "OpenAI";
              const upstream = r.upstream_protocol === "anthropic" ? "Anthropic" : r.upstream_protocol === "openai" ? "OpenAI" : null;
              if (!upstream || upstream === client) return <Tag>{client}</Tag>;
              return (
                <Space size={4}>
                  <Tag color="blue">{client}</Tag>
                  <Typography.Text type="secondary">→</Typography.Text>
                  <Tag color="orange">{upstream}</Tag>
                </Space>
              );
            },
          },
          {
            title: "模型",
            render: (_: unknown, r: RequestRecord) => (
              <Space direction="vertical" size={0}>
                <Typography.Text>{r.model_used || "—"}</Typography.Text>
                {r.model_requested !== r.model_used && r.model_requested && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    请求: {r.model_requested}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          {
            title: "层级",
            dataIndex: "tier_id",
            render: (v: string | null, r: RequestRecord) =>
              v ? (
                <Tag color={r.tier_source === "auto" ? "cyan" : "purple"}>
                  {v}
                  {r.tier_source === "auto" ? " (自动)" : ""}
                </Tag>
              ) : (
                "—"
              ),
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (v: string, r: RequestRecord) => (
              <Tag color={statusColor[v]}>{r.error ? `${v}: ${r.error.slice(0, 20)}` : v}</Tag>
            ),
          },
          {
            title: "Tokens",
            render: (_: unknown, r: RequestRecord) => {
              const uncached = Math.max(
                0,
                r.prompt_tokens - r.cache_read_tokens - r.cache_creation_tokens,
              );
              return (
                <Tooltip
                  title={
                    <div>
                      <div>输入 · 未命中缓存：{uncached.toLocaleString()}</div>
                      <div>输入 · 命中缓存：{r.cache_read_tokens.toLocaleString()}</div>
                      <div>输入 · 缓存写入：{r.cache_creation_tokens.toLocaleString()}</div>
                      <div>输出：{r.completion_tokens.toLocaleString()}</div>
                    </div>
                  }
                >
                  <span style={{ cursor: "help" }}>{(r.total_tokens ?? 0).toLocaleString()}</span>
                </Tooltip>
              );
            },
          },
          {
            title: `成本 (${currency})`,
            dataIndex: "cost",
            render: (v: number) => formatCost(v),
          },
          {
            title: "耗时",
            dataIndex: "latency_ms",
            render: (v: number) => `${v}ms`,
          },
          {
            title: "速度 (tok/s)",
            render: (_: unknown, r: RequestRecord) => {
              const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));
              return (
                <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                  <span>输入 {fmt(r.source_speed)}</span>
                  <span>输出 {fmt(r.egress_speed)}</span>
                </Space>
              );
            },
          },
          {
            title: "操作",
            render: (_, r: RequestRecord) => (
              <Button size="small" onClick={() => openDetail(r.id)}>
                详情
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={`请求详情 ${detail?.id ?? ""}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={900}
      >
        {detail && (
          <Tabs
            items={[
              {
                key: "meta",
                label: "概览",
                children: (
                  <Typography.Paragraph>
                    协议：{detail.protocol}；模型：{detail.model_used}；层级：{detail.tier_id ?? "—"}；
                    会话：{detail.conversation_id ?? "—"}；IP：{detail.client_ip ?? "—"}
                  </Typography.Paragraph>
                ),
              },
              {
                key: "messages",
                label: "消息",
                children: (
                  <div>
                    {(detail.messages ?? []).map((m, i) => (
                      <div key={i} style={{ marginBottom: 8, borderBottom: "1px solid #f0f0f0", paddingBottom: 8 }}>
                        <Tag>{m.role}</Tag>
                        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.content ?? ""}</pre>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: "request",
                label: "请求体",
                children: <pre style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>{pretty(detail.request_json)}</pre>,
              },
              {
                key: "response",
                label: "响应体",
                children: <pre style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>{pretty(detail.response_json)}</pre>,
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
