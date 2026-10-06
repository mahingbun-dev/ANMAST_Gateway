import { useEffect, useState } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Popconfirm,
  message,
  Typography,
  Divider,
} from "antd";
import { PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { api } from "../api";

interface Tier {
  id: string;
  name: string;
  description: string;
  sort: number;
}
interface Model {
  id: string;
  name: string;
  display_name: string;
  is_router: number;
}
interface Settings {
  router_model_id: string;
  assistant_model_id: string;
  auto_detect_enabled: boolean;
  default_tier: string;
  mcp_tools_mode: string;
  max_tool_steps: number;
}

export default function Routing() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tierOpen, setTierOpen] = useState(false);
  const [editing, setEditing] = useState<Tier | null>(null);
  const [form] = Form.useForm();

  const load = () => {
    Promise.all([
      api.get<Tier[]>("/api/tiers"),
      api.get<Model[]>("/api/models"),
      api.get<Settings>("/api/settings"),
    ]).then(([t, m, s]) => {
      setTiers(t);
      setModels(m);
      setSettings(s);
    });
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ sort: 0 });
    setTierOpen(true);
  };
  const openEdit = (t: Tier) => {
    setEditing(t);
    form.setFieldsValue(t);
    setTierOpen(true);
  };
  const submitTier = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await api.put(`/api/tiers/${editing.id}`, v);
      else await api.post("/api/tiers", v);
      message.success("已保存");
      setTierOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await api.put("/api/settings", settings);
      message.success("设置已保存");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const routerModels = models.filter((m) => m.is_router);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="复杂度层级"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加层级
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          每个模型可分配到多个层级；请求通过 complexity 参数或自动判定命中对应层级后，在该层级内按优先级选择模型，无可用模型时自动降级/提升。
        </Typography.Paragraph>
        <Table
          rowKey="id"
          dataSource={tiers}
          pagination={false}
          columns={[
            { title: "ID", dataIndex: "id", render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
            { title: "名称", dataIndex: "name" },
            { title: "描述", dataIndex: "description" },
            { title: "排序", dataIndex: "sort" },
            {
              title: "操作",
              render: (_, r: Tier) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除该层级？"
                    onConfirm={async () => {
                      await api.del(`/api/tiers/${r.id}`);
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
      </Card>

      <Card title="路由设置">
        {settings && (
          <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 640 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <div>
                <Typography.Text strong>自动复杂度判定</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    客户端未显式指定 complexity 时，用路由模型自动分级
                  </Typography.Text>
                </div>
              </div>
              <Switch
                checked={settings.auto_detect_enabled}
                onChange={(v) => setSettings({ ...settings, auto_detect_enabled: v })}
              />
            </Space>

            <div>
              <Typography.Text strong>判定用路由模型</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 8 }}
                placeholder="选择判定模型（需在模型管理中将某模型标记为路由模型）"
                value={settings.router_model_id || undefined}
                onChange={(v) => setSettings({ ...settings, router_model_id: v })}
                options={routerModels.map((m) => ({
                  value: m.id,
                  label: `${m.display_name || m.name} (${m.name})`,
                }))}
              />
            </div>

            <div>
              <Typography.Text strong>网页 AI 助手模型</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: "4px 0" }}>
                右下角「配置助手」使用的模型；未选择时依次回退到路由模型或第一个可用模型。
              </Typography.Paragraph>
              <Select
                style={{ width: "100%", marginTop: 8 }}
                placeholder="选择助手模型"
                allowClear
                value={settings.assistant_model_id || undefined}
                onChange={(v) => setSettings({ ...settings, assistant_model_id: v ?? "" })}
                options={models.map((m) => ({
                  value: m.id,
                  label: `${m.display_name || m.name} (${m.name})`,
                }))}
              />
            </div>

            <div>
              <Typography.Text strong>默认复杂度层级</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 8 }}
                value={settings.default_tier}
                onChange={(v) => setSettings({ ...settings, default_tier: v })}
                options={tiers.map((t) => ({ value: t.id, label: `${t.name} (${t.id})` }))}
              />
            </div>

            <div>
              <Typography.Text strong>MCP 工具注入模式</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 8 }}
                value={settings.mcp_tools_mode}
                onChange={(v) => setSettings({ ...settings, mcp_tools_mode: v })}
                options={[
                  { value: "off", label: "关闭（不注入 MCP 工具）" },
                  { value: "on_demand", label: "按需（请求带 gateway_tools:true 时注入）" },
                  { value: "auto", label: "自动（每次请求都注入 MCP 工具）" },
                ]}
              />
            </div>

            <div>
              <Typography.Text strong>最大工具调用步数</Typography.Text>
              <InputNumber
                style={{ width: "100%", marginTop: 8 }}
                min={1}
                max={64}
                value={settings.max_tool_steps}
                onChange={(v) => setSettings({ ...settings, max_tool_steps: Number(v ?? 8) })}
              />
            </div>

            <Divider />
            <Button type="primary" icon={<SaveOutlined />} onClick={saveSettings}>
              保存设置
            </Button>
          </Space>
        )}
      </Card>

      <Modal
        title={editing ? "编辑层级" : "添加层级"}
        open={tierOpen}
        onOk={submitTier}
        onCancel={() => setTierOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="ID" rules={[{ required: true }]} extra="英文标识，如 low / medium / high">
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
