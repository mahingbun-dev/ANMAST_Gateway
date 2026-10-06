import type { Provider } from "../types.js";

export interface HttpError extends Error {
  status?: number;
  body?: string;
}

/** 拼接 URL，避免重复斜杠 */
export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

/** 构造基础请求头（含供应商密钥与自定义头） */
export function buildHeaders(provider: Provider, authHeader: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("User-Agent", "anmast-gateway/0.1");
  headers.set("Authorization", authHeader);
  let extra: Record<string, string> = {};
  try {
    extra = JSON.parse(provider.extra_headers || "{}");
  } catch {
    /* ignore */
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) headers.set(k, v);
  }
  return headers;
}

async function toHttpError(res: Response): Promise<HttpError> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  const err: HttpError = new Error(
    `上游返回 ${res.status} ${res.statusText}${body ? `：${body.slice(0, 500)}` : ""}`,
  );
  err.status = res.status;
  err.body = body;
  return err;
}

/** 发送 JSON 请求并解析 JSON，非 2xx 抛出 HttpError */
export async function postJson<T = unknown>(
  url: string,
  headers: Headers,
  body: unknown,
  timeoutMs = 600000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await toHttpError(res);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 发送流式请求，返回 Response（调用方负责读取/关闭 body） */
export async function postStream(
  url: string,
  headers: Headers,
  body: unknown,
  timeoutMs = 600000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await toHttpError(res);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
