import { useEffect, useRef, useState } from "react";
import { Card, Select, Button, Input, Space, Typography, Empty, Modal, Tag, Divider } from "antd";
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  ClearOutlined,
  ExperimentOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { api, getToken } from "../api";

interface Model {
  id: string;
  name: string;
  display_name: string;
  enabled: number;
  provider_name?: string;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** 安全的会话 ID 生成（避免 HTTP 非安全上下文下 crypto.randomUUID 不可用） */
function genId(): string {
  return `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 模型对话测试：直接测试单个模型，仅对话、不使用工具/路由 */
export default function ModelTest() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [conversationId, setConversationId] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => stopTimer(), []);

  useEffect(() => {
    api.get<Model[]>("/api/models").then((ms) => {
      setModels(ms.filter((m) => m.enabled));
    });
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  const switchModel = (newId: string) => {
    if (!newId || newId === modelId) return;
    if (messages.length > 0) {
      Modal.confirm({
        title: "切换模型",
        content: "当前已有对话，是否清除上下文？",
        okText: "清除并切换",
        cancelText: "保留上下文",
        onOk: () => {
          setMessages([]);
          setConversationId("");
          setModelId(newId);
        },
        onCancel: () => setModelId(newId),
      });
    } else {
      setModelId(newId);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !modelId) return;
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    setStatus("正在思考…");
    startTimer();
    const cid = conversationId || genId();
    if (!conversationId) setConversationId(cid);

    try {
      const token = getToken();
      const res = await fetch("/api/model-test/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model_id: modelId,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          conversation_id: cid,
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
      let errorMsg = "";
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const o = JSON.parse(payload);
            if (o.type === "error") {
              errorMsg = o.message ?? "未知错误";
              continue;
            }
            const d = o.choices?.[0]?.delta?.content;
            if (d) {
              acc += d;
              if (status) setStatus("");
            }
          } catch {
            /* ignore */
          }
        }
        setMessages((prev) => {
          const c = [...prev];
          c[c.length - 1] = {
            role: "assistant",
            content: errorMsg ? `出错了：${errorMsg}` : acc,
          };
          return c;
        });
      }
      if (!acc.trim() && !errorMsg) {
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
      stopTimer();
      setStatus("");
      setLoading(false);
    }
  };

  const clearContext = () => {
    setMessages([]);
    setConversationId("");
  };

  const currentModel = models.find((m) => m.id === modelId);

  return (
    <Card
      title={
        <Space>
          <ExperimentOutlined />
          模型对话测试
          <Tag color="blue">仅对话 · 不使用工具</Tag>
        </Space>
      }
      size="small"
      extra={
        <Space>
          <Select
            showSearch
            placeholder="选择要测试的模型（已启用）"
            style={{ width: 320 }}
            value={modelId || undefined}
            onChange={switchModel}
            optionFilterProp="label"
            options={models.map((m) => ({
              value: m.id,
              label: `${m.display_name || m.name}${m.provider_name ? `（${m.provider_name}）` : ""}`,
            }))}
          />
          <Button icon={<ClearOutlined />} onClick={clearContext} disabled={!messages.length}>
            清空上下文
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        直接调用所选模型进行对话（停用模型不可选、不可用工具、不经过复杂度路由与 Skill）。切换模型时会提示是否清除上下文；测试对话同样会计入「调用记录」与「对话历史」。
      </Typography.Paragraph>

      <div
        ref={listRef}
        style={{
          height: "calc(100vh - 300px)",
          minHeight: 320,
          overflow: "auto",
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          padding: 16,
          background: "#fafafa",
        }}
      >
        {messages.length === 0 && (
          <Empty
            description={
              <Typography.Text type="secondary">
                选择一个模型后开始对话。当前会话通过 <Typography.Text code>X-Conversation-Id</Typography.Text> 关联，可在「对话历史」中查看。
              </Typography.Text>
            }
            style={{ marginTop: 60 }}
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
            <div style={{ maxWidth: "78%" }}>
              <Space size={4} style={{ marginBottom: 2 }}>
                {m.role === "assistant" ? <RobotOutlined /> : <UserOutlined />}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {m.role === "assistant" ? currentModel?.display_name || currentModel?.name || "模型" : "我"}
                </Typography.Text>
              </Space>
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: m.role === "user" ? "#2563eb" : "#ffffff",
                  color: m.role === "user" ? "#fff" : "#000",
                  border: m.role === "assistant" ? "1px solid #e5e7eb" : "none",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content || (loading && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 2px 0",
            color: "#8c8c8c",
            fontSize: 12,
          }}
        >
          <LoadingOutlined spin />
          <span>{status || "处理中…"}</span>
          <span>· 已用时 {elapsed}s</span>
        </div>
      )}

      <Divider style={{ margin: "12px 0" }} />
      <Space.Compact style={{ width: "100%" }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={modelId ? "输入消息…（Enter 发送，Shift+Enter 换行）" : "请先选择模型"}
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={!modelId}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} loading={loading} disabled={!modelId}>
          发送
        </Button>
      </Space.Compact>
    </Card>
  );
}
