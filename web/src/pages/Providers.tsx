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
  Alert,
} from "antd";
import { PlusOutlined, ReloadOutlined, ApiOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { api } from "../api";

interface Provider {
  id: string;
  name: string;
  type: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  extra_headers: string;
  enabled: number;
}

interface TestResult {
  ok: boolean;
  models: { id: string; context_window: number | null }[];
}

// 已知同时提供 OpenAI / Anthropic 双协议端点的供应商（非 AI 确定性映射，用于自动推导另一种协议的 Base URL）
interface KnownProvider {
  name: string;
  openai: string;
  anthropic: string;
}
const KNOWN_PROVIDERS: KnownProvider[] = [
  { name: "智谱 GLM", openai: "https://open.bigmodel.cn/api/paas/v4", anthropic: "https://open.bigmodel.cn/api/anthropic" },
  { name: "DeepSeek", openai: "https://api.deepseek.com/v1", anthropic: "https://api.deepseek.com/anthropic" },
  { name: "Moonshot (Kimi)", openai: "https://api.moonshot.cn/v1", anthropic: "https://api.moonshot.cn/anthropic" },
  { name: "MiniMax", openai: "https://api.minimaxi.com/v1", anthropic: "https://api.minimaxi.com/anthropic" },
];

function matchKnown(baseUrl: string): KnownProvider | undefined {
  try {
    const host = new URL(baseUrl).hostname;
    return KNOWN_PROVIDERS.find((p) => new URL(p.openai).hostname === host);
  } catch {
    return undefined;
  }
}

export default function Providers() {
  const [data, setData] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [fullApiKey, setFullApiKey] = useState("");
  const [form] = Form.useForm();
  const watchedType = Form.useWatch("type", form) as "openai" | "anthropic" | undefined;
  const watchedBase = Form.useWatch("base_url", form) as string | undefined;
  const known = watchedBase ? matchKnown(String(watchedBase)) : undefined;
  const alternate = known ? (watchedType === "anthropic" ? known.openai : known.anthropic) : undefined;

  const load = () => {
    setLoading(true);
    api.get<Provider[]>("/api/providers").then(setData).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resetTest = () => {
    setTestPassed(false);
    setModelCount(null);
  };

  const openCreate = () => {
    setEditing(null);
    setFullApiKey("");
    form.resetFields();
    form.setFieldsValue({ type: "openai", enabled: true, extra_headers: "{}" });
    resetTest();
    setOpen(true);
  };
  const openEdit = (p: Provider) => {
    setEditing(p);
    form.setFieldsValue({ ...p, enabled: !!p.enabled, api_key: "" });
    resetTest();
    setOpen(true);
    // 拉取完整密钥用于「留空则保持原密钥」的测试与保存
    api.get<Provider>(`/api/providers/${p.id}`).then((full) => setFullApiKey(full.api_key)).catch(() => setFullApiKey(""));
  };

  const runTest = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields(["name", "type", "base_url", "api_key", "extra_headers"]);
    } catch {
      return;
    }
    const apiKey = String(values.api_key ?? "").trim() || fullApiKey;
    setTesting(true);
    try {
      const r = await api.post<TestResult>("/api/providers/test", { ...values, api_key: apiKey });
      setTestPassed(true);
      setModelCount(r.models?.length ?? 0);
      message.success(`连接成功，发现 ${r.models?.length ?? 0} 个模型`);
    } catch (e) {
      resetTest();
      message.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!testPassed) {
      message.warning("请先点击「测试连接」并通过后再保存");
      return;
    }
    const values = await form.validateFields();
    const apiKey = String(values.api_key ?? "").trim();
    const body = { ...values, api_key: apiKey || fullApiKey };
    try {
      if (editing) await api.put(`/api/providers/${editing.id}`, body);
      else await api.post("/api/providers", body);
      message.success("已保存");
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const testRow = async (id: string) => {
    message.loading({ content: "测试连接中…", key: "test" });
    try {
      const r = await api.post<TestResult>(`/api/providers/${id}/test`);
      message.success({ content: `连接成功，发现 ${r.models.length} 个模型`, key: "test" });
      Modal.info({
        title: "上游可用模型",
        content: (
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {r.models.map((m) => (
              <div key={m.id}>
                <Tag>{m.id}</Tag>
                {m.context_window && (
                  <Typography.Text type="secondary">上下文 {m.context_window.toLocaleString()}</Typography.Text>
                )}
              </div>
            ))}
          </div>
        ),
      });
    } catch (e) {
      message.error({ content: (e as Error).message, key: "test" });
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          供应商管理
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加供应商
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={[
          { title: "名称", dataIndex: "name" },
          {
            title: "类型",
            dataIndex: "type",
            render: (v: string) => <Tag color={v === "anthropic" ? "orange" : "blue"}>{v}</Tag>,
          },
          { title: "Base URL", dataIndex: "base_url", ellipsis: true },
          { title: "API Key", dataIndex: "api_key", render: (v: string) => v || "—" },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: number) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          {
            title: "操作",
            render: (_, r: Provider) => (
              <Space>
                <Button size="small" icon={<ApiOutlined />} onClick={() => testRow(r.id)}>
                  测试
                </Button>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该供应商？其下模型也将被删除。"
                  onConfirm={async () => {
                    await api.del(`/api/providers/${r.id}`);
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
        title={editing ? "编辑供应商" : "添加供应商"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={640}
        okButtonProps={{ disabled: !testPassed }}
        okText={testPassed ? "保存" : "测试通过后可保存"}
      >
        <Form form={form} layout="vertical" onValuesChange={resetTest}>
          <Form.Item label="已知供应商（可选快速填充）">
            <Select
              allowClear
              placeholder="选择后自动填充名称与 Base URL"
              options={KNOWN_PROVIDERS.map((p) => ({ value: p.name, label: p.name }))}
              onChange={(name) => {
                const p = KNOWN_PROVIDERS.find((x) => x.name === name);
                if (p) {
                  const curType = form.getFieldValue("type") || "openai";
                  form.setFieldsValue({
                    name: p.name,
                    base_url: curType === "anthropic" ? p.anthropic : p.openai,
                  });
                }
              }}
            />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 OpenAI / DeepSeek / 本地 Ollama" />
          </Form.Item>
          <Form.Item name="type" label="协议类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "openai", label: "OpenAI 兼容" },
                { value: "anthropic", label: "Anthropic 兼容" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            rules={[{ required: true }]}
            extra="OpenAI 兼容填如 https://api.openai.com/v1；Anthropic 填如 https://api.anthropic.com"
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          {known && alternate && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`检测到「${known.name}」，其 ${watchedType === "anthropic" ? "OpenAI" : "Anthropic"} 兼容端点为`}
              description={
                <Space direction="vertical" size={8}>
                  <Typography.Text code copyable>
                    {alternate}
                  </Typography.Text>
                  <Button
                    size="small"
                    onClick={() => {
                      form.setFieldsValue({
                        base_url: alternate,
                        type: watchedType === "anthropic" ? "openai" : "anthropic",
                      });
                    }}
                  >
                    填充此端点（切换协议类型）
                  </Button>
                </Space>
              }
            />
          )}
          <Form.Item name="api_key" label="API Key" extra={editing ? "留空则保持已保存的密钥" : undefined}>
            <Input.Password placeholder={editing ? "留空则保持原密钥" : "sk-..."} />
          </Form.Item>
          <Form.Item name="extra_headers" label="额外请求头 (JSON)" extra='例如 {"X-Title":"app"}'>
            <Input.TextArea rows={2} placeholder="{}" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Space direction="vertical" style={{ width: "100%" }}>
            <Button icon={<ApiOutlined />} loading={testing} onClick={runTest} block>
              测试连接
            </Button>
            {testPassed && (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`测试通过，发现 ${modelCount ?? 0} 个可用模型`}
              />
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
