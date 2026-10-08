import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface RefreshState {
  tick: number;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  sec: number;
  setSec: (v: number) => void;
}

const RefreshContext = createContext<RefreshState>({
  tick: 0,
  enabled: false,
  setEnabled: () => {},
  sec: 3,
  setSec: () => {},
});

/** 全局自动刷新：顶部开关 + 间隔秒数，所有页面共享，tick 变化时各页面重载 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("anmast_refresh_enabled") === "1",
  );
  const [sec, setSec] = useState(() => Number(localStorage.getItem("anmast_refresh_sec") ?? 3));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    localStorage.setItem("anmast_refresh_enabled", enabled ? "1" : "0");
  }, [enabled]);

  useEffect(() => {
    localStorage.setItem("anmast_refresh_sec", String(sec));
  }, [sec]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setTick((x) => x + 1), sec * 1000);
    return () => clearInterval(t);
  }, [enabled, sec]);

  return (
    <RefreshContext.Provider value={{ tick, enabled, setEnabled, sec, setSec }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}
