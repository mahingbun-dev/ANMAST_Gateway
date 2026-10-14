import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/dist → server → 仓库根目录
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VERSION_FILE = path.join(REPO_ROOT, "VERSION");

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  newVersion: string | null;
  changes: string[];
  source: string | null; // "gitea" | "github"
}

interface GitResult {
  stdout: string;
  stderr: string;
}

function execAsync(cmd: string, cwd: string, timeoutMs = 30000): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function git(args: string[], timeoutMs = 30000): Promise<string> {
  return execAsync(`git ${args.join(" ")}`, REPO_ROOT, timeoutMs).then((r) => r.stdout.trim());
}

function readLocalVersion(): string {
  try {
    return fs.readFileSync(VERSION_FILE, "utf-8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** 读取当前运行版本号（与系统信息、更新检测共用） */
export function getVersion(): string {
  return readLocalVersion();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 尝试 fetch 某远程的 main 分支，成功返回 true */
async function fetchRemote(remote: string): Promise<boolean> {
  try {
    await git(["fetch", remote, "main", "--quiet"], 20000);
    return true;
  } catch {
    return false;
  }
}

/** 读取某远程分支上的 VERSION 文件内容 */
async function remoteVersion(ref: string): Promise<string | null> {
  try {
    const v = await git(["show", `${ref}:VERSION`], 30000);
    return v.trim() || null;
  } catch {
    return null;
  }
}

/** 检查更新：Gitea 优先、GitHub 备用；Gitea 失败静默切换，GitHub 也失败则报错 */
export async function checkForUpdate(): Promise<UpdateInfo | { error: string }> {
  const currentVersion = readLocalVersion();

  let ref: string | null = null;
  let source: string | null = null;

  // 1. Gitea 优先
  if (await fetchRemote("origin")) {
    const v = await remoteVersion("origin/main");
    if (v) {
      ref = "origin/main";
      source = "gitea";
    }
  }
  // 2. Gitea 失败 → 静默切换 GitHub
  if (!ref) {
    if (await fetchRemote("github")) {
      const v = await remoteVersion("github/main");
      if (v) {
        ref = "github/main";
        source = "github";
      }
    }
  }
  // 3. 都失败 → 报错
  if (!ref) {
    return { error: "服务器连接异常，请稍候再试" };
  }

  const newVersion = await remoteVersion(ref);
  if (!newVersion) return { error: "无法读取远程版本号" };

  const hasUpdate = compareVersions(newVersion, currentVersion) > 0;
  const changes = hasUpdate ? await getChanges("HEAD", ref) : [];

  return { hasUpdate, currentVersion, newVersion, changes, source };
}

/** 获取两个引用之间的提交主题（作为更新内容） */
async function getChanges(from: string, to: string): Promise<string[]> {
  try {
    const out = await git(["log", `${from}..${to}`, "--pretty=format:%s"], 30000);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let cached: (UpdateInfo | { error: string }) | null = null;

/** 每日定时检测：更新缓存并记录日志 */
export async function runDailyCheck(): Promise<void> {
  try {
    cached = await checkForUpdate();
    if ("error" in cached) {
      logger.warn(`每日更新检测失败：${cached.error}`);
    } else if (cached.hasUpdate) {
      logger.info(`检测到新版本 ${cached.newVersion}（来源 ${cached.source}）`);
    } else {
      logger.info("每日更新检测：已是最新版本");
    }
  } catch (e) {
    logger.warn("每日更新检测失败", e);
  }
}

/** 获取最近一次检测结果（供登录弹窗等复用，避免频繁 fetch） */
export function getCachedUpdate(): (UpdateInfo | { error: string }) | null {
  return cached;
}

/** 执行更新：git pull（主源失败切备用）→ pnpm build → 返回是否成功（重启由调用方处理） */
export async function runUpdate(): Promise<{ ok: boolean; error?: string }> {
  const beforeCommit = await git(["rev-parse", "HEAD"], 15000).catch(() => "");

  // 1. 拉取（Gitea 优先，失败切 GitHub）
  let pulled = false;
  try {
    await git(["pull", "--ff-only", "origin", "main"], 120000);
    pulled = true;
  } catch {
    try {
      await git(["pull", "--ff-only", "github", "main"], 120000);
      pulled = true;
    } catch {
      return { ok: false, error: "拉取更新失败：服务器连接异常，请稍候再试" };
    }
  }
  if (!pulled) return { ok: false, error: "拉取更新失败" };

  // 2. 构建
  try {
    const buildCmd = process.env.UPDATE_BUILD_CMD || "pnpm build";
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` };
    await runBuild(buildCmd, env);
  } catch (e) {
    // 构建失败 → 回滚
    if (beforeCommit) {
      await git(["reset", "--hard", beforeCommit], 30000).catch(() => {});
      await git(["clean", "-fd"], 30000).catch(() => {});
    }
    return { ok: false, error: `构建失败，已回滚：${(e as Error).message}` };
  }

  return { ok: true };
}

async function runBuild(cmd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    exec(cmd, { cwd: REPO_ROOT, timeout: 600000, env }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export { REPO_ROOT, VERSION_FILE };
