import { useEffect, useRef, useState } from "react";
import {
  Card,
  Form,
  Input,
  Button,
  message,
  Typography,
  Space,
  Descriptions,
  Alert,
  Segmented,
  InputNumber,
  Modal,
  Divider,
} from "antd";
import { api, getToken } from "../api";
import { useCurrency } from "../currency";
import dayjs from "dayjs";

interface SystemInfo {
  requests: number;
  conversations: number;
  models: number;
  mcp_servers: number;
  skills: number;
  version: string;
  uptime: number;
}

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  newVersion: string | null;
  changes: string[];
  source: string | null;
  error?: string;
}

export default function Settings() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { currency, rate, reload } = useCurrency();
  const [cur, setCur] = useState<"CNY" | "USD">(currency);
  const [rateVal, setRateVal] = useState(rate);
  const fileRef = useRef<HTMLInputElement>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setCur(currency);
    setRateVal(rate);
  }, [currency, rate]);

  useEffect(() => {
    api.get<SystemInfo>("/api/system").then(setSys);
  }, []);

  const saveCurrency = async () => {
    try {
      await api.put("/api/settings", { currency: cur, usd_cny_rate: rateVal });
      message.success("价格单位已保存，各处价格已自动换算");
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const changePassword = async (v: { current: string; next: string; confirm: string }) => {
    if (v.next !== v.confirm) {
      message.error("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/password", { currentPassword: v.current, newPassword: v.next });
      message.success("密码已修改");
      form.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 二次确认
  const doubleConfirm = (title: string, content: string, onOk: () => void) => {
    Modal.confirm({
      title,
      content,
      okText: "确认",
      okType: "danger",
      onOk: () => {
        Modal.confirm({
          title: "再次确认",
          content: "该操作不可撤销，请确认是否继续？",
          okText: "确定执行",
          okType: "danger",
          onOk: () => onOk(),
        });
      },
    });
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const r = await api.get<UpdateInfo>("/api/update/check");
      setUpdateInfo(r);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const doUpdate = () => {
    Modal.confirm({
      title: "立即更新",
      content: `将更新到版本 ${updateInfo?.newVersion ?? ""}，更新期间服务会短暂重启。是否继续？`,
      okText: "更新",
      onOk: async () => {
        setUpdating(true);
        try {
          await api.post("/api/update/run", {});
          message.success("更新完成，服务即将重启");
          setTimeout(() => (window.location.href = "/"), 2500);
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setUpdating(false);
        }
      },
    });
  };

  const resetData = () =>
    doubleConfirm(
      "重置数据",
      "将清空所有调用记录、对话历史与消息（保留供应商、模型、密钥、Skill、MCP 等配置）。",
      async () => {
        try {
          await api.post("/api/system/reset-data");
          message.success("已重置所有计数器数据");
          api.get<SystemInfo>("/api/system").then(setSys);
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    );

  const factoryReset = () =>
    doubleConfirm(
      "恢复出厂设置",
      "将删除所有用户数据（供应商、模型、密钥、Skill、MCP、调用记录、对话、设置等），恢复到安装初始状态。建议先执行备份！",
      async () => {
        try {
          await api.post("/api/system/factory-reset");
          message.success("已恢复出厂设置，即将跳转到登录页（默认 admin/admin123456）");
          setTimeout(() => (window.location.href = "/login"), 1500);
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    );

  const downloadBackup = async () => {
    try {
      const token = getToken();
      const res = await fetch("/api/system/backup", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        message.error("备份失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `anmast-backup-${dayjs().format("YYYYMMDD-HHmmss")}.db`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("备份已下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const restoreBackup = (file: File) => {
    doubleConfirm(
      "恢复备份",
      `将用「${file.name}」覆盖当前数据（会先清空当前所有用户数据），确定继续？`,
      () => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const data = (reader.result as string).split(",")[1] ?? "";
            await api.post("/api/system/restore", { data });
            message.success("恢复成功，即将重新登录");
            setTimeout(() => (window.location.href = "/login"), 1500);
          } catch (e) {
            message.error((e as Error).message);
          }
        };
        reader.readAsDataURL(file);
      },
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) restoreBackup(f);
    e.target.value = "";
  };

  const base = `${window.location.protocol}//${window.location.host}`;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 900 }}>
      <Card title="修改管理员密码">
        <Form form={form} layout="vertical" onFinish={changePassword} style={{ maxWidth: 420 }}>
          <Form.Item name="current" label="当前密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="next" label="新密码" rules={[{ required: true, min: 8, message: "至少 8 位" }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirm" label="确认新密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            修改密码
          </Button>
        </Form>
      </Card>

      <Card title="价格单位">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
              计价单位
            </Typography.Text>
            <Segmented
              value={cur}
              onChange={(v) => setCur(v as "CNY" | "USD")}
              options={[
                { label: "¥ 人民币 (CNY)", value: "CNY" },
                { label: "$ 美元 (USD)", value: "USD" },
              ]}
            />
          </div>
          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
              汇率（1 USD = ? CNY）
            </Typography.Text>
            <InputNumber
              min={0.01}
              step={0.1}
              value={rateVal}
              onChange={(v) => setRateVal(Number(v ?? 7.2))}
              style={{ width: 200 }}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            模型价格与成本统一以 USD 存储；切换单位后，模型页、仪表盘与调用记录中的价格/成本会自动按汇率换算显示。
          </Typography.Paragraph>
          <Button type="primary" onClick={saveCurrency}>
            保存价格单位
          </Button>
        </Space>
      </Card>

      <Card title="接入方式">
        <Alert
          type="info"
          showIcon
          message="远程电脑 / 第三方平台通过网关调用模型"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              网关提供 OpenAI 兼容、Anthropic 兼容，以及一个「自动判断协议」的统一入口，使用「API 密钥」页创建的密钥认证（Bearer 或 x-api-key）。
            </Typography.Paragraph>
          }
        />
        <Descriptions column={1} style={{ marginTop: 16 }}>
          <Descriptions.Item label="统一入口（自动判断协议）">
            <Typography.Text code copyable>
              {base}/v1/chat
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="OpenAI 兼容">
            <Typography.Text code copyable>
              {base}/v1/chat/completions
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Anthropic 兼容">
            <Typography.Text code copyable>
              {base}/v1/messages
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="模型列表">
            <Typography.Text code copyable>
              {base}/v1/models
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="认证">
            <Typography.Text code>Authorization: Bearer sk-anmast-xxx</Typography.Text>
            {"　或　"}
            <Typography.Text code>x-api-key: sk-anmast-xxx</Typography.Text>
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type="success"
          showIcon
          style={{ marginTop: 12 }}
          message="OpenAI 兼容应用只需填 Base URL 到 /v1 即可"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              多数 OpenAI 兼容应用（如 Open WebUI、Chatbox 等）配置时 Base URL 填 <Typography.Text code>{base}/v1</Typography.Text>{" "}
              即可正常获取模型与对话：它们会自动访问 <Typography.Text code>/v1/models</Typography.Text>（列模型）与{" "}
              <Typography.Text code>/v1/chat/completions</Typography.Text>（对话），这两个端点网关都已提供。
              统一入口 <Typography.Text code>/v1/chat</Typography.Text> 是额外提供的「自动判断协议」端点，适用于需要同时接入 OpenAI 与 Anthropic 两类客户端的场景。
            </Typography.Paragraph>
          }
        />

        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="统一入口 /v1/chat 的自动协议判断与调用顺序"
          description={
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                <b>协议判断顺序（非 AI 规则）</b>：① 请求头带 <Typography.Text code>anthropic-version</Typography.Text> →
                判定为 Anthropic；② 请求体含顶层 <Typography.Text code>system</Typography.Text>、消息 content 为数组块、或含{" "}
                <Typography.Text code>thinking</Typography.Text>/<Typography.Text code>metadata</Typography.Text> →
                判定为 Anthropic；③ 否则判定为 OpenAI。
              </Typography.Paragraph>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                <b>上游调用顺序</b>：客户端协议与供应商支持的协议<b>一致时优先同协议直连</b>（真流式透传，实时速度更准确）；
                供应商不支持客户端协议时，才回退到跨协议转换。供应商可同时配置 OpenAI 与 Anthropic 两种 Base URL（分别测试通过后保存）。
              </Typography.Paragraph>
            </div>
          }
        />

        <Divider orientation="left" plain>
          调用参数
        </Divider>
        <Typography.Paragraph>
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 6, overflow: "auto" }}>
{`# OpenAI 兼容（用 gateway 的 key）
curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-anmast-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "complexity": "medium",
    "conversation_id": "my-thread-1",
    "messages": [{"role":"user","content":"你好"}]
  }'`}
          </pre>
        </Typography.Paragraph>
        <Descriptions column={1} size="small" bordered style={{ marginTop: 8 }}>
          <Descriptions.Item label="model">
            <Typography.Text code>auto</Typography.Text>（或省略）按复杂度路由；填已配置的模型名直连该模型
          </Descriptions.Item>
          <Descriptions.Item label="complexity">
            <Typography.Text code>low / medium / high</Typography.Text>（或自定义层级 id），显式指定复杂度；未传且开启自动判定时网关自动分级
          </Descriptions.Item>
          <Descriptions.Item label="conversation_id / session_id">
            会话 id，用于聚合对话历史；未传时网关自动识别（如 Claude Code 的 session_id）或生成
          </Descriptions.Item>
          <Descriptions.Item label="skills">
            字符串数组，显式激活的 Skill 名称/ID（受该密钥的 Skill 允许列表约束）
          </Descriptions.Item>
          <Descriptions.Item label="gateway_tools">
            <Typography.Text code>true</Typography.Text> 时注入已启用 MCP 服务器的工具
          </Descriptions.Item>
          <Descriptions.Item label="stream">
            <Typography.Text code>true</Typography.Text> 流式返回
          </Descriptions.Item>
          <Descriptions.Item label="多模态">
            支持 <Typography.Text code>image_url</Typography.Text>（OpenAI）与 <Typography.Text code>image</Typography.Text>（Anthropic）图片透传
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="备份与恢复">
        <Alert
          type="warning"
          showIcon
          message="备份包含所有用户数据（配置、密钥、调用记录、对话等），恢复会先清空当前数据。"
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" onClick={downloadBackup}>
            立即备份
          </Button>
          <Button onClick={() => fileRef.current?.click()}>恢复备份</Button>
        </Space>
        <input ref={fileRef} type="file" accept=".db" style={{ display: "none" }} onChange={handleFileSelect} />
      </Card>

      <Card title="重置">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <div>
              <Typography.Text strong>重置数据</Typography.Text>
              <div>
                <Typography.Text type="secondary">清空所有计数器数据（调用记录、对话历史、消息），保留配置</Typography.Text>
              </div>
            </div>
            <Button danger onClick={resetData}>
              重置数据
            </Button>
          </Space>
          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <div>
              <Typography.Text strong>恢复出厂设置</Typography.Text>
              <div>
                <Typography.Text type="secondary">删除所有用户数据，恢复到安装初始状态</Typography.Text>
              </div>
            </div>
            <Button danger type="primary" onClick={factoryReset}>
              恢复出厂设置
            </Button>
          </Space>
        </Space>
      </Card>

      <Card title="系统更新">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            每日自动检测更新（Gitea 优先、GitHub 备用）；检测到新版本后，请在此确认后手动更新。
          </Typography.Paragraph>
          <Space>
            <Button loading={checkingUpdate} onClick={checkUpdate}>
              检查更新
            </Button>
            <Button type="primary" loading={updating} disabled={!updateInfo?.hasUpdate} onClick={doUpdate}>
              立即更新
            </Button>
          </Space>
          {updateInfo && (
            <Alert
              type={updateInfo.hasUpdate ? "warning" : "success"}
              showIcon
              message={
                updateInfo.error
                  ? updateInfo.error
                  : updateInfo.hasUpdate
                    ? `发现新版本 ${updateInfo.newVersion}`
                    : `已是最新版本（当前 ${updateInfo.currentVersion}）`
              }
              description={
                updateInfo.hasUpdate ? (
                  <div>
                    <div>当前版本：{updateInfo.currentVersion}</div>
                    <div>新版本：{updateInfo.newVersion}（来源：{updateInfo.source === "github" ? "GitHub" : "Gitea"}）</div>
                    {updateInfo.changes.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Typography.Text strong>本次更新内容：</Typography.Text>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                          {updateInfo.changes.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : undefined
              }
            />
          )}
        </Space>
      </Card>

      <Card title="系统信息">
        <Descriptions column={2}>
          <Descriptions.Item label="版本">{sys?.version ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="运行时长">
            {sys ? `${Math.floor((sys.uptime ?? 0) / 60)} 分钟` : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="累计调用">{sys?.requests ?? 0}</Descriptions.Item>
          <Descriptions.Item label="对话数">{sys?.conversations ?? 0}</Descriptions.Item>
          <Descriptions.Item label="模型数">{sys?.models ?? 0}</Descriptions.Item>
          <Descriptions.Item label="MCP 服务器">{sys?.mcp_servers ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Skill 数">{sys?.skills ?? 0}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}
