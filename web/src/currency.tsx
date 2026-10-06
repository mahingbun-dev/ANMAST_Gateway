import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export type Currency = "CNY" | "USD";

interface CurrencyCtx {
  currency: Currency;
  rate: number; // 1 USD = rate CNY
  symbol: string;
  toDisplay: (usd: number) => number;
  fromDisplay: (v: number) => number;
  formatCost: (usd: number) => string;
  formatPrice: (usd: number) => string;
  reload: () => void;
}

const defaultCtx: CurrencyCtx = {
  currency: "CNY",
  rate: 7.2,
  symbol: "¥",
  toDisplay: (u) => u,
  fromDisplay: (v) => v,
  formatCost: (u) => `¥${u.toFixed(6)}`,
  formatPrice: (u) => `¥${u.toFixed(4)}`,
  reload: () => {},
};

const CurrencyContext = createContext<CurrencyCtx>(defaultCtx);

interface SettingsResp {
  currency?: string;
  usd_cny_rate?: number;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [rate, setRate] = useState(7.2);
  const [tick, setTick] = useState(0);

  const load = () => {
    api
      .get<SettingsResp>("/api/settings")
      .then((s) => {
        setCurrency((s.currency === "USD" ? "USD" : "CNY") as Currency);
        setRate(typeof s.usd_cny_rate === "number" && s.usd_cny_rate > 0 ? s.usd_cny_rate : 7.2);
      })
      .catch(() => {
        /* 保持默认 */
      });
  };

  useEffect(load, [tick]);

  const symbol = currency === "CNY" ? "¥" : "$";
  const toDisplay = (usd: number) => (currency === "CNY" ? usd * rate : usd);
  const fromDisplay = (v: number) => (currency === "CNY" ? v / rate : v);
  const formatCost = (usd: number) => `${symbol}${toDisplay(usd).toFixed(6)}`;
  const formatPrice = (usd: number) => `${symbol}${toDisplay(usd).toFixed(4)}`;

  return (
    <CurrencyContext.Provider
      value={{ currency, rate, symbol, toDisplay, fromDisplay, formatCost, formatPrice, reload: () => setTick((t) => t + 1) }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
