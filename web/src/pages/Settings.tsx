import { useEffect, useState } from "react";
import { Card, Form, Input, Button, message, Typography, Space, Descriptions, Alert, Segmented, InputNumber } from "antd";
import { api } from "../api";
import { useCurrency } from "../currency";

interface SystemInfo {
  requests: number;
  conversations: number;
  models: number;
  mcp_servers: number;
  skills: number;
  version: string;
  uptime: number;
}

export default function Settings() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { currency, rate, reload } = useCurrency();
  const [cur, setCur] = useState<"CNY" | "USD">(currency);
  const [rateVal, setRateVal] = useState(rate);

  useEffect(() => {
    setCur(currency);
    setRateVal(rate);
  }, [currency, rate]);

  const saveCurrency = async () => {
    try {
      await api.put("/api/settings", { currency: cur, usd_cny_rate: rateVal });
      message.success("价格单位已保存，各处价格已自动换算");
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  useEffect(() => {
    api.get<SystemInfo>("/api/system").then(setSys);
  }, []);

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
          message="远程电脑通过网关调用模型"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              网关提供 OpenAI 兼容与 Anthropic 兼容两种端点，使用「API 密钥」页创建的密钥认证。
            </Typography.Paragraph>
          }
        />
        <Descriptions column={1} style={{ marginTop: 16 }}>
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
        </Descriptions>
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
        <Typography.Paragraph type="secondary">
          model 传 <Typography.Text code>auto</Typography.Text>（或省略）时按复杂度路由；传已配置的模型名则直连该模型。未传 complexity
          且开启自动判定时，网关会自动分级。可在请求体附带 <Typography.Text code>skills</Typography.Text> 数组或{" "}
          <Typography.Text code>gateway_tools: true</Typography.Text> 启用相应能力。
        </Typography.Paragraph>
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
