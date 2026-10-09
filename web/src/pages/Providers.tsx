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
  openai_base_url: string | null;
  anthropic_base_url: string | null;
  api_key: string;
  extra_headers: string;
  enabled: number;
}

interface ProtoResult {
  protocol: "openai" | "anthropic";
  ok: boolean;
  models: { id: string; context_window: number | null }[];
  error: string | null;
  note?: string | null;
}
interface TestResult {
  ok: boolean;
  results: ProtoResult[];
}

// 已知供应商双协议端点映射（非 AI 确定性映射；空字符串表示该供应商不支持该协议）
interface KnownProvider {
  name: string;
  openai: string;
  anthropic: string;
}
const KNOWN_PROVIDERS: KnownProvider[] = [
  { name: "小米 MiMo API（按量付费）", openai: "https://api.xiaomimimo.com/v1", anthropic: "https://api.xiaomimimo.com/anthropic" },
  { name: "小米 MiMo Token Plan（订阅套餐）", openai: "https://token-plan-cn.xiaomimimo.com/v1", anthropic: "https://token-plan-cn.xiaomimimo.com/anthropic" },
  { name: "智谱 GLM", openai: "https://open.bigmodel.cn/api/paas/v4", anthropic: "https://open.bigmodel.cn/api/anthropic" },
  { name: "DeepSeek", openai: "https://api.deepseek.com/v1", anthropic: "https://api.deepseek.com/anthropic" },
  { name: "Moonshot (Kimi)", openai: "https://api.moonshot.cn/v1", anthropic: "https://api.moonshot.cn/anthropic" },
  { name: "MiniMax", openai: "https://api.minimaxi.com/v1", anthropic: "https://api.minimaxi.com/anthropic" },
  { name: "OpenAI（仅 OpenAI 协议）", openai: "https://api.openai.com/v1", anthropic: "" },
  { name: "Anthropic（仅 Anthropic 协议）", openai: "", anthropic: "https://api.anthropic.com" },
];

function matchKnown(baseUrl: string): KnownProvider | undefined {
  try {
    const host = new URL(baseUrl).hostname;
    return KNOWN_PROVIDERS.find((p) => {
      const hosts = [p.openai, p.anthropic].filter(Boolean).map((u) => new URL(u).hostname);
      return hosts.includes(host);
    });
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
  const [testResults, setTestResults] = useState<ProtoResult[] | null>(null);
  const [fullApiKey, setFullApiKey] = useState("");
  const [form] = Form.useForm();
  const watchedOpenai = Form.useWatch("openai_base_url", form) as string | undefined;
  const watchedAnthropic = Form.useWatch("anthropic_base_url", form) as string | undefined;

  // 从任意一个已填写的 Base URL 检测已知供应商，用于补全另一协议
  const knownFromOpenai = watchedOpenai ? matchKnown(String(watchedOpenai)) : undefined;
  const knownFromAnthropic = watchedAnthropic ? matchKnown(String(watchedAnthropic)) : undefined;
  const known = knownFromOpenai ?? knownFromAnthropic;
  const missingOpenai = known && !watchedOpenai && known.openai;
  const missingAnthropic = known && !watchedAnthropic && known.anthropic;

  const load = () => {
    setLoading(true);
    api.get<Provider[]>("/api/providers").then(setData).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resetTest = () => {
    setTestPassed(false);
    setTestResults(null);
  };

  const openCreate = () => {
    setEditing(null);
    setFullApiKey("");
    form.resetFields();
    form.setFieldsValue({ enabled: true, extra_headers: "{}" });
    resetTest();
    setOpen(true);
  };
  const openEdit = (p: Provider) => {
    setEditing(p);
    form.setFieldsValue({
      ...p,
      enabled: !!p.enabled,
      api_key: "",
    });
    resetTest();
    setOpen(true);
    api.get<Provider>(`/api/providers/${p.id}`).then((full) => setFullApiKey(full.api_key)).catch(() => setFullApiKey(""));
  };

  const runTest = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields(["name", "openai_base_url", "anthropic_base_url", "api_key", "extra_headers"]);
    } catch {
      return;
    }
    if (!String(values.openai_base_url ?? "").trim() && !String(values.anthropic_base_url ?? "").trim()) {
      message.warning("请至少填写一种协议的 Base URL");
      return;
    }
    const apiKey = String(values.api_key ?? "").trim() || fullApiKey;
    setTesting(true);
    try {
      const r = await api.post<TestResult>("/api/providers/test", { ...values, api_key: apiKey });
      setTestResults(r.results);
      setTestPassed(r.ok);
      if (r.ok) message.success("所有协议均测试通过");
      else message.error("存在未通过的协议，请查看详情");
    } catch (e) {
      resetTest();
      message.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!testPassed) {
      message.warning("请先点击「测试连接」并全部通过后再保存");
      return;
    }
    const values = await form.validateFields();
    const apiKey = String(values.api_key ?? "").trim();
    const body = {
      name: values.name,
      openai_base_url: String(values.openai_base_url ?? "").trim() || null,
      anthropic_base_url: String(values.anthropic_base_url ?? "").trim() || null,
      api_key: apiKey || fullApiKey,
      extra_headers: values.extra_headers,
      enabled: values.enabled,
    };
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
      const ok = r.results.filter((x) => x.ok).length;
      message.success({ content: `测试完成：${ok}/${r.results.length} 个协议通过`, key: "test" });
      Modal.info({
        title: "测试结果",
        content: (
          <Space direction="vertical" style={{ width: "100%" }}>
            {r.results.map((x) => (
              <div key={x.protocol}>
                <Tag color={x.ok ? "green" : "red"}>{x.protocol === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"}</Tag>
                {x.ok ? `发现 ${x.models.length} 个模型` : x.error}
              </div>
            ))}
          </Space>
        ),
      });
    } catch (e) {
      message.error({ content: (e as Error).message, key: "test" });
    }
  };

  const protoTags = (p: Provider) => (
    <Space size={4}>
      {p.openai_base_url && <Tag color="blue">OpenAI 兼容</Tag>}
      {p.anthropic_base_url && <Tag color="orange">Anthropic 兼容</Tag>}
    </Space>
  );

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
          { title: "协议", render: (_, r: Provider) => protoTags(r) },
          { title: "Base URL", render: (_, r: Provider) => r.openai_base_url ?? r.anthropic_base_url ?? r.base_url, ellipsis: true },
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
              placeholder="选择后自动填充名称与两种协议的 Base URL"
              options={KNOWN_PROVIDERS.map((p) => ({ value: p.name, label: p.name }))}
              onChange={(name) => {
                const p = KNOWN_PROVIDERS.find((x) => x.name === name);
                if (p) {
                  form.setFieldsValue({
                    name: p.name.replace(/（.*）/, ""),
                    openai_base_url: p.openai || undefined,
                    anthropic_base_url: p.anthropic || undefined,
                  });
                }
              }}
            />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 OpenAI / DeepSeek / 小米 MiMo" />
          </Form.Item>
          <Form.Item
            name="openai_base_url"
            label="OpenAI 兼容 Base URL"
            extra="留空表示不支持 OpenAI 协议"
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item
            name="anthropic_base_url"
            label="Anthropic 兼容 Base URL"
            extra="留空表示不支持 Anthropic 协议"
          >
            <Input placeholder="https://api.example.com/anthropic" />
          </Form.Item>
          {known && (missingOpenai || missingAnthropic) && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`检测到「${known.name}」，可补全另一协议端点`}
              description={
                <Space direction="vertical" size={8}>
                  {missingOpenai && (
                    <Typography.Text code copyable>
                      OpenAI: {known.openai}
                    </Typography.Text>
                  )}
                  {missingAnthropic && (
                    <Typography.Text code copyable>
                      Anthropic: {known.anthropic}
                    </Typography.Text>
                  )}
                  <Button
                    size="small"
                    onClick={() =>
                      form.setFieldsValue({
                        openai_base_url: known.openai || undefined,
                        anthropic_base_url: known.anthropic || undefined,
                      })
                    }
                  >
                    一键补全
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
            {testResults && (
              <Space direction="vertical" style={{ width: "100%" }}>
                {testResults.map((x) => (
                  <Alert
                    key={x.protocol}
                    type={x.ok ? "success" : "error"}
                    showIcon
                    icon={x.ok ? <CheckCircleOutlined /> : undefined}
                    message={
                      x.ok
                        ? `${x.protocol === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"} ✓ ${x.models.length ? `发现 ${x.models.length} 个模型` : x.note ?? "已连通"}`
                        : `${x.protocol === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"} ✗ ${x.error ?? "测试失败"}`
                    }
                  />
                ))}
              </Space>
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
