import { useEffect, useState } from "react";
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Popconfirm,
  message,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined, ApiOutlined } from "@ant-design/icons";
import { api } from "../api";

interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  config: string;
  enabled: number;
}

function parseConfig(c: string): Record<string, unknown> {
  try {
    return JSON.parse(c);
  } catch {
    return {};
  }
}

export default function Mcp() {
  const [data, setData] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [form] = Form.useForm();
  const transport = Form.useWatch("transport", form);

  const load = () => {
    setLoading(true);
    api.get<McpServer[]>("/api/mcp").then(setData).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ transport: "stdio" });
    setOpen(true);
  };
  const openEdit = (s: McpServer) => {
    setEditing(s);
    const cfg = parseConfig(s.config);
    form.setFieldsValue({
      name: s.name,
      transport: s.transport,
      command: (cfg.command as string) ?? "",
      args: Array.isArray(cfg.args) ? (cfg.args as string[]).join(" ") : "",
      env: cfg.env ? JSON.stringify(cfg.env, null, 2) : "",
      url: (cfg.url as string) ?? "",
      headers: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    let config: Record<string, unknown>;
    if (v.transport === "stdio") {
      config = {
        command: v.command,
        args: (v.args ?? "").split(/\s+/).filter(Boolean),
        env: v.env ? safeJson(v.env) : {},
      };
    } else {
      config = { url: v.url, headers: v.headers ? safeJson(v.headers) : {} };
    }
    try {
      if (editing) await api.put(`/api/mcp/${editing.id}`, { name: v.name, transport: v.transport, config });
      else await api.post("/api/mcp", { name: v.name, transport: v.transport, config });
      message.success("已保存");
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const showTools = async (id: string) => {
    message.loading({ content: "连接中…", key: "t" });
    try {
      const r = await api.get<{ tools: { function: { name: string; description: string } }[] }>(
        `/api/mcp/${id}/tools`,
      );
      const tools = r.tools ?? [];
      message.success({ content: `已连接，发现 ${tools.length} 个工具`, key: "t" });
      Modal.info({
        title: "可用工具",
        content: (
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {tools.map((t) => (
              <div key={t.function.name} style={{ marginBottom: 6 }}>
                <Tag color="purple">{t.function.name}</Tag>
                <Typography.Text type="secondary">{t.function.description}</Typography.Text>
              </div>
            ))}
          </div>
        ),
      });
    } catch (e) {
      message.error({ content: (e as Error).message, key: "t" });
    }
  };

  const safeJson = (s: string): Record<string, unknown> => {
    try {
      return JSON.parse(s);
    } catch {
      throw new Error("JSON 格式不正确");
    }
  };

  const toggleEnabled = async (s: McpServer) => {
    try {
      await api.put(`/api/mcp/${s.id}`, { enabled: s.enabled ? 0 : 1 });
      message.success(s.enabled ? `已停用 ${s.name}` : `已启用 ${s.name}`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const transportLabel = (t: string) =>
    t === "stdio" ? "stdio 进程" : t === "sse" ? "SSE" : "Streamable HTTP";

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          MCP 服务器
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加 MCP Server
          </Button>
        </Space>
      </Space>

      <Typography.Paragraph type="secondary">
        网关会连接 MCP Server 并在请求中注入其工具；当模型发起工具调用时由网关内执行并回填结果。
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={[
          { title: "名称", dataIndex: "name", render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
          {
            title: "传输方式",
            dataIndex: "transport",
            render: (v: string) => <Tag color="blue">{transportLabel(v)}</Tag>,
          },
          {
            title: "配置",
            dataIndex: "config",
            ellipsis: true,
            render: (v: string) => {
              const c = parseConfig(v);
              return c.command ? (
                <Typography.Text code>{c.command as string}</Typography.Text>
              ) : (
                <Typography.Text code>{c.url as string}</Typography.Text>
              );
            },
          },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: number, r: McpServer) => (
              <Switch
                checked={!!v}
                checkedChildren="启用"
                unCheckedChildren="停用"
                onChange={() => toggleEnabled(r)}
              />
            ),
          },
          {
            title: "操作",
            render: (_, r: McpServer) => (
              <Space>
                <Button size="small" icon={<ApiOutlined />} onClick={() => showTools(r.id)}>
                  工具
                </Button>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该 MCP Server？"
                  onConfirm={async () => {
                    await api.del(`/api/mcp/${r.id}`);
                    message.success("已删除");
                    load();
                  }}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? "编辑 MCP Server" : "添加 MCP Server"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 filesystem" />
          </Form.Item>
          <Form.Item name="transport" label="传输方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "stdio", label: "stdio（本地进程）" },
                { value: "sse", label: "SSE" },
                { value: "streamable-http", label: "Streamable HTTP" },
              ]}
            />
          </Form.Item>

          {transport === "stdio" && (
            <>
              <Form.Item name="command" label="命令" rules={[{ required: true }]}>
                <Input placeholder="npx" />
              </Form.Item>
              <Form.Item name="args" label="参数（空格分隔）">
                <Input placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
              </Form.Item>
              <Form.Item name="env" label="环境变量 (JSON)">
                <Input.TextArea rows={3} placeholder='{"KEY":"value"}' />
              </Form.Item>
            </>
          )}

          {(transport === "sse" || transport === "streamable-http") && (
            <>
              <Form.Item name="url" label="URL" rules={[{ required: true }]}>
                <Input placeholder="http://127.0.0.1:8080/mcp" />
              </Form.Item>
              <Form.Item name="headers" label="请求头 (JSON)">
                <Input.TextArea rows={3} placeholder='{"Authorization":"Bearer xxx"}' />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
