import { useEffect, useState } from "react";
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Popconfirm,
  message,
  Typography,
  Alert,
} from "antd";
import { PlusOutlined, ReloadOutlined, CopyOutlined } from "@ant-design/icons";
import { api } from "../api";
import dayjs from "dayjs";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  enabled: number;
  monthly_limit_tokens: number | null;
  skill_ids: string;
  mcp_server_ids: string;
  created_at: number;
  last_used_at: number | null;
}
interface SkillOpt {
  id: string;
  name: string;
}
interface McpOpt {
  id: string;
  name: string;
}

function parseArr(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

export default function ApiKeys() {
  const [data, setData] = useState<ApiKey[]>([]);
  const [skills, setSkills] = useState<SkillOpt[]>([]);
  const [mcps, setMcps] = useState<McpOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<ApiKey[]>("/api/keys"),
      api.get<SkillOpt[]>("/api/skills"),
      api.get<McpOpt[]>("/api/mcp"),
    ])
      .then(([k, s, m]) => {
        setData(k);
        setSkills(s);
        setMcps(m);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setCreatedKey(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true, skill_ids: [], mcp_server_ids: [] });
    setOpen(true);
  };
  const openEdit = (k: ApiKey) => {
    setEditing(k);
    setCreatedKey(null);
    form.setFieldsValue({
      name: k.name,
      enabled: !!k.enabled,
      monthly_limit_tokens: k.monthly_limit_tokens ?? null,
      skill_ids: parseArr(k.skill_ids),
      mcp_server_ids: parseArr(k.mcp_server_ids),
    });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      name: v.name,
      enabled: v.enabled,
      monthly_limit_tokens: v.monthly_limit_tokens ?? null,
      skill_ids: v.skill_ids ?? [],
      mcp_server_ids: v.mcp_server_ids ?? [],
    };
    try {
      if (editing) {
        await api.put(`/api/keys/${editing.id}`, body);
        message.success("已保存");
        setOpen(false);
      } else {
        const r = await api.post<ApiKey & { key: string }>("/api/keys", body);
        setCreatedKey(r.key);
        message.success("密钥已创建");
      }
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          API 密钥
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建密钥
          </Button>
        </Space>
      </Space>

      <Typography.Paragraph type="secondary">
        远程电脑通过网关调用模型时使用这些密钥认证；可为每个密钥单独绑定要启用的 Skill 与 MCP Server。
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={[
          { title: "名称", dataIndex: "name" },
          {
            title: "密钥前缀",
            dataIndex: "key_prefix",
            render: (v: string) => <Typography.Text code>{v}…</Typography.Text>,
          },
          {
            title: "绑定 Skill",
            dataIndex: "skill_ids",
            render: (v: string) => {
              const ids = parseArr(v);
              if (!ids.length) return "—";
              return ids.map((id) => (
                <Tag key={id} color="blue">
                  {skills.find((s) => s.id === id)?.name ?? id}
                </Tag>
              ));
            },
          },
          {
            title: "绑定 MCP",
            dataIndex: "mcp_server_ids",
            render: (v: string) => {
              const ids = parseArr(v);
              if (!ids.length) return "—";
              return ids.map((id) => (
                <Tag key={id} color="purple">
                  {mcps.find((m) => m.id === id)?.name ?? id}
                </Tag>
              ));
            },
          },
          {
            title: "当月额度 (tokens)",
            dataIndex: "monthly_limit_tokens",
            render: (v: number | null) => (v == null ? "不限" : v.toLocaleString()),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: number) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          {
            title: "创建时间",
            dataIndex: "created_at",
            render: (v: number) => dayjs(v).format("YYYY-MM-DD HH:mm"),
          },
          {
            title: "最近使用",
            dataIndex: "last_used_at",
            render: (v: number | null) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—"),
          },
          {
            title: "操作",
            render: (_, r: ApiKey) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该密钥？使用它的客户端将无法再调用。"
                  onConfirm={async () => {
                    await api.del(`/api/keys/${r.id}`);
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
        title={editing ? "编辑密钥" : "创建密钥"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={560}
        footer={createdKey ? [<Button key="ok" type="primary" onClick={() => setOpen(false)}>关闭</Button>] : undefined}
      >
        {createdKey ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert type="warning" message="请立即保存该密钥，关闭后无法再次查看完整密钥。" showIcon />
            <Input.Group compact style={{ display: "flex" }}>
              <Input value={createdKey} readOnly style={{ flex: 1 }} />
              <Button
                icon={<CopyOutlined />}
                onClick={async () => {
                  await navigator.clipboard.writeText(createdKey);
                  message.success("已复制");
                }}
              >
                复制
              </Button>
            </Input.Group>
          </Space>
        ) : (
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input placeholder="如 mac-mini-remote" />
            </Form.Item>
            <Form.Item name="monthly_limit_tokens" label="当月 token 额度（留空为不限）">
              <InputNumber style={{ width: "100%" }} min={0} placeholder="如 100000000" />
            </Form.Item>
            <Form.Item name="skill_ids" label="绑定 Skill（该密钥调用时自动激活）">
              <Select
                mode="multiple"
                allowClear
                placeholder="选择要启用的 Skill"
                options={skills.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Form.Item>
            <Form.Item name="mcp_server_ids" label="绑定 MCP Server（注入其工具）">
              <Select
                mode="multiple"
                allowClear
                placeholder="选择要注入的 MCP Server 工具"
                options={mcps.map((m) => ({ value: m.id, label: m.name }))}
              />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
