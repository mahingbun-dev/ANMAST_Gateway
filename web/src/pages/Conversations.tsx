import { useEffect, useState } from "react";
import { Table, Input, Space, Button, Modal, Tag, Typography, Empty } from "antd";
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

export default function Conversations() {
  const [data, setData] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [convTitle, setConvTitle] = useState("");

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
    const r = await api.get<{ messages: Message[] }>(`/api/conversations/${c.id}`);
    setMessages(r.messages);
  };

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
        <div style={{ maxHeight: 520, overflow: "auto" }}>
          {(messages ?? []).map((m) => (
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
