import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/** 使用 scrypt 对密码进行加盐哈希，格式：salt:hash(hex) */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEYLEN);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = await scrypt(password, salt, KEYLEN);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** 生成安全随机 token（十六进制） */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** SHA-256 摘要，用于存储 API Key / Session token 的哈希 */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** 生成网关 API Key，形如 sk-anmast-xxxx */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sk-anmast-${crypto.randomBytes(24).toString("base64url")}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 12) };
}

/** 常量时间字符串比较 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
