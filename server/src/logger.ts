type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: Level = "info";

export function setLogLevel(level: string) {
  if (level in order) currentLevel = level as Level;
}

function log(level: Level, msg: string, extra?: unknown) {
  if (order[level] < order[currentLevel]) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.log(line, extra);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  debug: (m: string, e?: unknown) => log("debug", m, e),
  info: (m: string, e?: unknown) => log("info", m, e),
  warn: (m: string, e?: unknown) => log("warn", m, e),
  error: (m: string, e?: unknown) => log("error", m, e),
};
