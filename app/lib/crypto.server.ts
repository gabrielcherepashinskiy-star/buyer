import crypto from "node:crypto";

// AES-256-GCM encryption for sensitive seller ID numbers.
// ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32).

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY is not valid base64");
  }
  if (key.length !== 32) {
    // Allow a hex key as a fallback.
    const hex = Buffer.from(raw, "hex");
    if (hex.length === 32) return hex;
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (use: openssl rand -base64 32)");
  }
  return key;
}

/** Encrypt a plaintext string. Returns "iv:tag:ciphertext" in base64. */
export function encrypt(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** Decrypt a value produced by encrypt(). Returns null on failure. */
export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const key = getKey();
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export function last4(value: string): string {
  const trimmed = value.replace(/\s+/g, "");
  return trimmed.slice(-4);
}
