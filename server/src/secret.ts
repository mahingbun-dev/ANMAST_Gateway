import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { encryptSecret, decryptSecret } from "./lib/crypto.js";

const ENC_PREFIX = "enc:v1:";
let masterKey: Buffer | null = null;

/** 加载/生成供应商密钥加密主密钥（优先 GATEWAY_SECRET 环境变量，否则用数据目录 gateway.key） */
function loadMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const secret = config.gatewaySecret;
  if (secret && secret.length >= 8) {
    masterKey = crypto.createHash("sha256").update(secret).digest();
    return masterKey;
  }
  const keyFile = path.join(config.dataDir, "gateway.key");
  if (fs.existsSync(keyFile)) {
    const buf = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
    if (buf.length === 32) {
      masterKey = buf;
      return masterKey;
    }
  }
  masterKey = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, masterKey.toString("hex"), { mode: 0o600 });
  return masterKey;
}

export function getMasterKey(): Buffer {
  return loadMasterKey();
}

/** 加密供应商密钥（已加密则不重复处理） */
export function encryptApiKey(plain: string): string {
  if (!plain) return "";
  if (plain.startsWith(ENC_PREFIX)) return plain;
  return ENC_PREFIX + encryptSecret(plain, getMasterKey());
}

/** 解密供应商密钥（明文/旧数据原样返回） */
export function decryptApiKey(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    return decryptSecret(stored.slice(ENC_PREFIX.length), getMasterKey());
  } catch {
    // 解密失败（主密钥变更等）→ 返回空串，避免把密文当明文使用
    return "";
  }
}

export const ENCRYPTED_API_KEY_PREFIX = ENC_PREFIX;
