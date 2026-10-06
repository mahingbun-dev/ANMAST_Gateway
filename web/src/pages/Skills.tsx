import { useEffect, useRef, useState } from "react";
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Switch,
  Popconfirm,
  message,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined, UploadOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { api } from "../api";

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools_config: string;
  triggers: string | null;
  enabled: number;
}

function parseArr(json: string | null, key: string): string[] {
  try {
    const o = JSON.parse(json ?? "{}");
    return Array.isArray(o[key]) ? o[key] : [];
  } catch {
    return [];
  }
}

export default function Skills() {
  const [data, setData] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form] = Form.useForm();
  const [pathOpen, setPathOpen] = useState(false);
  const [pathVal, setPathVal] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    api.get<Skill[]>("/api/skills").then(setData).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setOpen(true);
  };
  const openEdit = (s: Skill) => {
    setEditing(s);
    form.setFieldsValue({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      enabled: !!s.enabled,
      triggerKeywords: parseArr(s.triggers, "keywords").join(", "),
      tools: parseArr(s.tools_config, "tools").join(", "),
    });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const split = (s: string | undefined) =>
      (s ?? "")
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    const body = {
      name: v.name,
      description: v.description ?? "",
      instructions: v.instructions ?? "",
      enabled: v.enabled,
      triggers: JSON.stringify({ keywords: split(v.triggerKeywords) }),
      tools_config: JSON.stringify({ tools: split(v.tools) }),
    };
    try {
      if (editing) await api.put(`/api/skills/${editing.id}`, body);
      else await api.post("/api/skills", body);
      message.success("已保存");
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setImporting(true);
      try {
        const content = String(reader.result ?? "");
        await api.post("/api/skills/import", { content, fileName: file.name });
        message.success(`已导入 ${file.name}`);
        load();
      } catch (err) {
        message.error((err as Error).message);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const importFromPath = async () => {
    if (!pathVal.trim()) return;
    setImporting(true);
    try {
      const r = await api.post<{ imported: string[] }>("/api/skills/import-path", { path: pathVal.trim() });
      message.success(`已导入 ${r.imported.length} 个 Skill：${r.imported.join(", ")}`);
      setPathOpen(false);
      setPathVal("");
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          Skill 管理
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()}>
            导入文件
          </Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => setPathOpen(true)}>
            导入路径
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加 Skill
          </Button>
        </Space>
      </Space>

      <Typography.Paragraph type="secondary">
        Skill 是可注入的指令/流程包：激活后其指令会加入系统提示；可通过显式请求（请求体 skills 字段）或关键词触发；声明的 MCP 工具会在激活时自动可用。
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={[
          { title: "名称", dataIndex: "name", render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
          { title: "描述", dataIndex: "description", ellipsis: true },
          {
            title: "触发关键词",
            dataIndex: "triggers",
            render: (v: string | null) =>
              parseArr(v, "keywords").map((k) => (
                <Tag key={k} color="blue">
                  {k}
                </Tag>
              )),
          },
          {
            title: "绑定工具",
            dataIndex: "tools_config",
            render: (v: string) =>
              parseArr(v, "tools").map((k) => (
                <Tag key={k} color="purple">
                  {k}
                </Tag>
              )),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: number) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          {
            title: "操作",
            render: (_, r: Skill) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该 Skill？"
                  onConfirm={async () => {
                    await api.del(`/api/skills/${r.id}`);
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
        title={editing ? "编辑 Skill" : "添加 Skill"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 code-review" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简要说明该 Skill 的用途" />
          </Form.Item>
          <Form.Item name="instructions" label="指令内容" rules={[{ required: true }]} extra="激活后注入系统提示的完整指引">
            <Input.TextArea rows={8} placeholder="详细的 Skill 指令…" />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="triggerKeywords" label="触发关键词（逗号分隔）" style={{ flex: 1 }}>
              <Input placeholder="如 代码审查, review" />
            </Form.Item>
            <Form.Item name="tools" label="绑定 MCP 工具名（逗号分隔）" style={{ flex: 1 }}>
              <Input placeholder="如 fetch_url" />
            </Form.Item>
          </Space>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
      <Modal
        title="从本地路径导入"
        open={pathOpen}
        onOk={importFromPath}
        onCancel={() => setPathOpen(false)}
        confirmLoading={importing}
      >
        <Typography.Paragraph type="secondary">
          填写服务器（Mac Mini）上的文件或目录路径；目录会扫描其中的 .md 文件。支持 SKILL.md 的 YAML frontmatter（name / description / tools）。
        </Typography.Paragraph>
        <Input
          value={pathVal}
          onChange={(e) => setPathVal(e.target.value)}
          placeholder="如 /Users/you/skills 或 /Users/you/skills/my-skill.md"
        />
      </Modal>
    </div>
  );
}
