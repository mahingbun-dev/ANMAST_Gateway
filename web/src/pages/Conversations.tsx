import { useEffect, useState } from "react";
import { Table, Input, Space, Button, Modal, Tag, Typography, Empty, Switch } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { api } from "../api";
import dayjs from "dayjs";

interface Conversation {
  id: string;
  title: string;
  model: string;
  message_count: number;
  updated_at: number;
}
interface Message {
  id: number;
  role: string;
  content: string | null;
  name: string | null;
  tool_calls: string | null;
  created_at: number;
}

const roleColor: Record<string, string> = {
  user: "blue",
  assistant: "green",
  system: "default",
  tool: "purple",
};

/** 简洁视图：只保留真正的「对话内容」，隐藏提示词、注入上下文、工具调用与分析中间过程 */
function isConversationContent(m: Message): boolean {
  const c = (m.content ?? "").trim();
  // 隐藏系统提示词与工具结果
  if (m.role === "system" || m.role === "tool") return false;
  if (m.role === "user") {
    if (!c) return false;
    // 隐藏注入的上下文（system-reminder / session / transcript / CLAUDE.md 等）
    if (c.startsWith("<")) return false;
    if (c.startsWith("The following is")) return false;
    return true;
  }
  if (m.role === "assistant") {
    // 有正文才算对话内容（纯工具调用/分析消息隐藏）
    return !!c;
  }
  return true;
}

export default function Conversations() {
  const [data, setData] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [convTitle, setConvTitle] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = (p = page) => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(p), pageSize: "50" });
    if (search) q.set("search", search);
    api
      .get<{ items: Conversation[]; total: number }>(`/api/conversations?${q.toString()}`)
      .then((r) => {
        setData(r.items);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (c: Conversation) => {
    setConvTitle(c.title);
    setShowAll(false);
    const r = await api.get<{ messages: Message[] }>(`/api/conversations/${c.id}`);
    setMessages(r.messages);
  };

  const visible = showAll ? messages ?? [] : (messages ?? []).filter(isConversationContent);
  const hiddenCount = (messages?.length ?? 0) - visible.length;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索对话标题/ID"
          allowClear
          style={{ width: 300 }}
          onSearch={() => load(1)}
        />
        <Button type="primary" onClick={() => load(1)}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => load(page)}>
          刷新
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{ current: page, total, pageSize: 50, onChange: (p) => { setPage(p); load(p); } }}
        columns={[
          { title: "标题", dataIndex: "title", ellipsis: true },
          { title: "模型", dataIndex: "model", render: (v: string) => <Tag>{v || "—"}</Tag> },
          { title: "消息数", dataIndex: "message_count" },
          {
            title: "更新时间",
            dataIndex: "updated_at",
            render: (v: number) => dayjs(v).format("MM-DD HH:mm"),
          },
          {
            title: "操作",
            render: (_, r: Conversation) => (
              <Button size="small" onClick={() => open(r)}>
                查看
              </Button>
            ),
          },
        ]}
      />

      <Modal title={`对话：${convTitle}`} open={!!messages} onCancel={() => setMessages(null)} footer={null} width={760}>
        {messages && messages.length === 0 && <Empty description="暂无消息" />}
        {messages && messages.length > 0 && (
          <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
            <Switch
              checked={showAll}
              onChange={setShowAll}
              checkedChildren="显示全部"
              unCheckedChildren="简洁视图"
            />
            {!showAll && hiddenCount > 0 ? (
              <Typography.Text type="secondary">已隐藏 {hiddenCount} 条（提示词/分析/工具）</Typography.Text>
            ) : (
              <Typography.Text type="secondary">共 {visible.length} 条</Typography.Text>
            )}
          </Space>
        )}
        <div style={{ maxHeight: 520, overflow: "auto" }}>
          {visible.map((m) => (
            <div key={m.id} style={{ marginBottom: 12 }}>
              <Space size={8}>
                <Tag color={roleColor[m.role] ?? "default"}>{m.role}</Tag>
                {m.name && <Typography.Text type="secondary">{m.name}</Typography.Text>}
              </Space>
              <div
                style={{
                  marginTop: 4,
                  padding: "8px 12px",
                  background: m.role === "user" ? "#e6f4ff" : m.role === "assistant" ? "#f6ffed" : "#fafafa",
                  borderRadius: 6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content ?? (m.tool_calls ? <Typography.Text code>{m.tool_calls}</Typography.Text> : "（空）")}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
