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
  InputNumber,
  Popconfirm,
  message,
  Typography,
  AutoComplete,
} from "antd";
import { PlusOutlined, ReloadOutlined, LoadingOutlined } from "@ant-design/icons";
import { api } from "../api";
import { useCurrency } from "../currency";

interface Provider {
  id: string;
  name: string;
}
interface Tier {
  id: string;
  name: string;
}
interface Model {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  tiers: string;
  capabilities: string;
  context_window: number;
  input_price: number;
  input_cache_read_price?: number;
  input_cache_write_price?: number;
  output_price: number;
  priority: number;
  is_router: number;
  enabled: number;
  provider_name?: string;
}
interface DiscoveredModel {
  id: string;
  context_window: number | null;
}

function parseTiers(m: Model): string[] {
  try {
    const t = JSON.parse(m.tiers);
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export default function Models() {
  const [data, setData] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [form] = Form.useForm();
  const { currency, toDisplay, fromDisplay, formatPrice } = useCurrency();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<Model[]>("/api/models"),
      api.get<Provider[]>("/api/providers"),
      api.get<Tier[]>("/api/tiers"),
    ])
      .then(([m, p, t]) => {
        setData(m);
        setProviders(p);
        setTiers(t);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const fetchModels = async (providerId: string) => {
    setLoadingModels(true);
    setDiscovered([]);
    try {
      const r = await api.get<{ models: DiscoveredModel[] }>(`/api/providers/${providerId}/models`);
      setDiscovered(r.models ?? []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  };

  const onProviderChange = (providerId: string) => {
    form.setFieldsValue({ name: undefined, context_window: 128000 });
    fetchModels(providerId);
  };

  const onModelSelect = async (modelId: string) => {
    const providerId = form.getFieldValue("provider_id");
    const found = discovered.find((d) => d.id === modelId);
    if (found?.context_window) {
      form.setFieldsValue({ context_window: found.context_window });
      return;
    }
    // 列表未携带上下文，尝试拉取详情
    setContextLoading(true);
    try {
      const r = await api.get<{ context_window: number | null }>(
        `/api/providers/${providerId}/models/${encodeURIComponent(modelId)}/context`,
      );
      if (r.context_window) form.setFieldsValue({ context_window: r.context_window });
    } catch {
      /* ignore */
    } finally {
      setContextLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDiscovered([]);
    form.resetFields();
    form.setFieldsValue({
      tiers: ["medium"],
      context_window: 128000,
      input_price: 0,
      input_cache_read_price: 0,
      input_cache_write_price: 0,
      output_price: 0,
      priority: 100,
      is_router: false,
      enabled: true,
      tools: true,
      vision: false,
    });
    setOpen(true);
  };
  const openEdit = (m: Model) => {
    setEditing(m);
    let cap: { tools?: boolean; vision?: boolean } = {};
    try {
      cap = JSON.parse(m.capabilities);
    } catch {
      /* ignore */
    }
    form.setFieldsValue({
      ...m,
      tiers: parseTiers(m),
      enabled: !!m.enabled,
      is_router: !!m.is_router,
      tools: cap.tools !== false,
      vision: !!cap.vision,
      input_price: toDisplay(m.input_price),
      input_cache_read_price: toDisplay(m.input_cache_read_price ?? 0),
      input_cache_write_price: toDisplay(m.input_cache_write_price ?? 0),
      output_price: toDisplay(m.output_price),
    });
    fetchModels(m.provider_id);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const body = {
      ...values,
      input_price: fromDisplay(Number(values.input_price ?? 0)),
      input_cache_read_price: fromDisplay(Number(values.input_cache_read_price ?? 0)),
      input_cache_write_price: fromDisplay(Number(values.input_cache_write_price ?? 0)),
      output_price: fromDisplay(Number(values.output_price ?? 0)),
      capabilities: JSON.stringify({ tools: !!values.tools, vision: !!values.vision }),
    };
    delete body.tools;
    delete body.vision;
    try {
      if (editing) await api.put(`/api/models/${editing.id}`, body);
      else await api.post("/api/models", body);
      message.success("已保存");
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? id;

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          模型管理
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加模型
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={[
          { title: "显示名", dataIndex: "display_name" },
          { title: "模型 ID", dataIndex: "name", render: (v: string) => <Tag>{v}</Tag> },
          { title: "供应商", dataIndex: "provider_name" },
          {
            title: "复杂度层级",
            dataIndex: "tiers",
            render: (_: string, r: Model) =>
              parseTiers(r).map((t) => (
                <Tag key={t} color="purple">
                  {tierName(t)}
                </Tag>
              )),
          },
          {
            title: "路由模型",
            dataIndex: "is_router",
            render: (v: number) => (v ? <Tag color="cyan">复杂度判定</Tag> : "—"),
          },
          {
            title: "上下文",
            dataIndex: "context_window",
            render: (v: number) => v.toLocaleString(),
          },
          {
            title: `价格 (每1M, ${currency})`,
            render: (_: unknown, r: Model) => (
              <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                <span>未命中 {formatPrice(r.input_price)}</span>
                <span>命中缓存 {formatPrice(r.input_cache_read_price ?? 0)}</span>
                <span>缓存写入 {formatPrice(r.input_cache_write_price ?? 0)}</span>
                <span>输出 {formatPrice(r.output_price)}</span>
              </Space>
            ),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: number) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          {
            title: "操作",
            render: (_, r: Model) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该模型？"
                  onConfirm={async () => {
                    await api.del(`/api/models/${r.id}`);
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
        title={editing ? "编辑模型" : "添加模型"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="provider_id" label="供应商" rules={[{ required: true }]}>
            <Select
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="选择供应商（自动拉取该 API Key 下的模型）"
              onChange={onProviderChange}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="模型 ID"
            rules={[{ required: true }]}
            extra="选择供应商后自动列出可用模型，也可手动输入"
          >
            <AutoComplete
              options={discovered.map((d) => ({
                value: d.id,
                label: d.context_window ? `${d.id}（上下文 ${d.context_window.toLocaleString()}）` : d.id,
              }))}
              onSelect={onModelSelect}
              placeholder="如 gpt-4o"
              filterOption={(input, option) =>
                (option?.value ?? "").toString().toLowerCase().includes(input.toLowerCase())
              }
            >
              <Input suffix={loadingModels ? <LoadingOutlined /> : null} />
            </AutoComplete>
          </Form.Item>
          <Form.Item name="display_name" label="显示名">
            <Input placeholder="GPT-4o" />
          </Form.Item>
          <Form.Item name="tiers" label="适用的复杂度层级" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={tiers.map((t) => ({ value: t.id, label: `${t.name} (${t.id})` }))}
            />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="context_window" label="上下文窗口" style={{ flex: 1 }} extra={contextLoading ? "获取中…" : undefined}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="priority" label="优先级（越小越优先）" style={{ flex: 1 }}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Typography.Text strong>价格（每 1M tokens，{currency}）</Typography.Text>
          <Space size={16} style={{ display: "flex", marginTop: 8 }}>
            <Form.Item name="input_price" label="输入 · 未命中缓存" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="input_cache_read_price" label="输入 · 命中缓存" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="input_cache_write_price" label="输入 · 缓存写入" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="output_price" label="输出" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space size={24}>
            <Form.Item name="is_router" label="用作复杂度判定模型" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="tools" label="支持工具调用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="vision" label="支持视觉" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
