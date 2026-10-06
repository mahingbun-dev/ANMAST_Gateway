import { useState, useRef, useEffect } from "react";
import { Drawer, Button, Input, Space, Typography, Empty, Tag } from "antd";
import { CommentOutlined, SendOutlined, RobotOutlined, UserOutlined } from "@ant-design/icons";
import { getToken } from "../api";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const token = getToken();
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string })?.error ?? `请求失败 (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const o = JSON.parse(payload);
              const d = o.choices?.[0]?.delta?.content;
              if (d) acc += d;
            } catch {
              /* ignore */
            }
          }
        }
        setMessages((prev) => {
          const c = [...prev];
          c[c.length - 1] = { role: "assistant", content: acc };
          return c;
        });
      }
      if (!acc.trim()) {
        setMessages((prev) => {
          const c = [...prev];
          c[c.length - 1] = { role: "assistant", content: "（无回复）" };
          return c;
        });
      }
    } catch (e) {
      setMessages((prev) => {
        const c = [...prev];
        c[c.length - 1] = { role: "assistant", content: `出错了：${(e as Error).message}` };
        return c;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<CommentOutlined />}
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          width: 52,
          height: 52,
          zIndex: 1000,
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        }}
      />
      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>配置助手</span>
            <Tag color="blue">配置/安装</Tag>
          </Space>
        }
        placement="right"
        width={440}
        open={open}
        onClose={() => setOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div ref={listRef} style={{ flex: 1, overflow: "auto", paddingBottom: 12 }}>
            {messages.length === 0 && (
              <Empty
                description={
                  <Typography.Text type="secondary">
                    你好，我是配置助手。可以问我如何添加供应商、配置模型与复杂度路由、接入 Skill/MCP、客户端调用方式等。
                  </Typography.Text>
                }
                style={{ marginTop: 48 }}
              />
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 12,
                }}
              >
                <div style={{ maxWidth: "85%" }}>
                  <Space size={4} style={{ marginBottom: 2 }}>
                    {m.role === "assistant" ? <RobotOutlined /> : <UserOutlined />}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {m.role === "assistant" ? "助手" : "我"}
                    </Typography.Text>
                  </Space>
                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: m.role === "user" ? "#2563eb" : "#f0f2f5",
                      color: m.role === "user" ? "#fff" : "#000",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.content || (loading && m.role === "assistant" ? "思考中…" : "")}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Space.Compact style={{ width: "100%" }}>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="询问配置问题…（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={send} loading={loading} />
          </Space.Compact>
        </div>
      </Drawer>
    </>
  );
}
