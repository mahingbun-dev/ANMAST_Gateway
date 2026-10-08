import { useEffect, useRef, useState } from "react";
import { Space, Switch, InputNumber, Typography } from "antd";

interface Props {
  onRefresh: () => void;
  defaultInterval?: number;
}

/** 自动刷新控制：开关 + 间隔秒数（默认 3 秒） */
export default function AutoRefresh({ onRefresh, defaultInterval = 3 }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [sec, setSec] = useState(defaultInterval);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => cbRef.current(), sec * 1000);
    return () => clearInterval(t);
  }, [enabled, sec]);

  return (
    <Space>
      <Typography.Text type="secondary">自动刷新</Typography.Text>
      <Switch size="small" checked={enabled} onChange={setEnabled} />
      {enabled && (
        <>
          <InputNumber
            size="small"
            min={1}
            max={3600}
            value={sec}
            onChange={(v) => setSec(v ?? defaultInterval)}
            style={{ width: 64 }}
          />
          <Typography.Text type="secondary">秒</Typography.Text>
        </>
      )}
    </Space>
  );
}
