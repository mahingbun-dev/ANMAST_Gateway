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

const BACKUP_MAGIC = "ANMT";

/** 用密码加密缓冲区（AES-256-GCM，scrypt 派生密钥）。输出：magic + salt + iv + tag + 密文 */
export function encryptBuffer(buf: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(BACKUP_MAGIC), salt, iv, tag, enc]);
}

/** 用密码解密缓冲区；密码错误或格式不对时抛异常 */
export function decryptBuffer(payload: Buffer, password: string): Buffer {
  if (payload.length < 48 || payload.subarray(0, 4).toString() !== BACKUP_MAGIC) {
    throw new Error("不是有效的加密备份文件");
  }
  const salt = payload.subarray(4, 20);
  const iv = payload.subarray(20, 32);
  const tag = payload.subarray(32, 48);
  const enc = payload.subarray(48);
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** AES-256-GCM 加密字符串（固定 32 字节密钥），输出 base64(iv + tag + 密文) */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** AES-256-GCM 解密字符串；密钥错误抛异常 */
export function decryptSecret(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
