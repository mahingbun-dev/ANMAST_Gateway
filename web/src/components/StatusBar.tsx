import { useEffect, useState } from "react";
import { api } from "../api";

interface LiveSpeed {
  source_speed: number | null;
  egress_speed: number | null;
  active: number;
}

/** 底部状态栏：实时显示全局调用速度（每秒更新） */
export default function StatusBar() {
  const [live, setLive] = useState<LiveSpeed>({ source_speed: null, egress_speed: null, active: 0 });

  useEffect(() => {
    const load = () => api.get<LiveSpeed>("/api/usage/live").then(setLive).catch(() => {});
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 220,
        right: 0,
        height: 28,
        background: "#001529",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        fontSize: 12,
        zIndex: 1000,
      }}
    >
      <span>
        源速度 <b>{fmt(live.source_speed)}</b> tok/s · 出口速度 <b>{fmt(live.egress_speed)}</b> tok/s
      </span>
      <span>活跃请求 <b>{live.active}</b></span>
    </div>
  );
}
