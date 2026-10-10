import { useEffect, useState } from "react";
import { Card, Form, InputNumber, Switch, Input, Button, message, Typography, Space, Alert } from "antd";
import { api } from "../api";

interface CompressionConfig {
  enabled: boolean;
  anchor_messages: number;
  window_messages: number;
  summarize_middle: boolean;
  summary_model: string;
}

export default function Compression() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    api.get<CompressionConfig>("/api/compression").then((c) => {
      form.setFieldsValue(c);
      setEnabled(c.enabled);
    });
  }, [form]);

  const save = async () => {
    const v = await form.validateFields();
    setLoading(true);
    try {
      await api.put("/api/compression", { ...v, enabled });
      message.success("压缩设置已保存");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 760 }}>
      <Card title="上下文压缩">
        <Alert
          type="info"
          showIcon
          message="方案 E：头部锚点 + 近期窗口 + 中间摘要/丢弃"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              压缩在网关路由前对历史消息生效：保留开头的锚点消息（对应注意力锚点，稳定前缀可命中缓存）与最近的消息原文，
              中间部分按配置摘要或丢弃。仅影响发往上游的输入，不改动当前这条新消息。
            </Typography.Paragraph>
          }
        />
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="启用压缩" extra="关闭后消息原样透传，不产生压缩率数据">
            <Switch checked={enabled} onChange={setEnabled} />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item
              name="anchor_messages"
              label="头部锚点保留条数"
              style={{ flex: 1 }}
              extra="保留开头的若干条消息（含 system/首个任务上下文）"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={50} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="window_messages"
              label="近期保留条数"
              style={{ flex: 1 }}
              extra="保留最近的若干条消息原文"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={200} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="summarize_middle"
            label="中间部分用摘要补偿"
            valuePropName="checked"
            extra="开启后用低成本模型把中间历史摘要成一段；关闭则直接丢弃中间历史"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="summary_model" label="摘要模型（留空则自动选第一个可路由模型）">
            <Input placeholder="如 glm-5.3-flash" />
          </Form.Item>
          <Button type="primary" loading={loading} onClick={save}>
            保存
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
