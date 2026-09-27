/**
 * Encryption at rest for stored documents and off-site backups.
 *
 * Format (version 1):  "CVE1" | IV (12 bytes) | ciphertext | GCM auth tag (16 bytes)
 *
 * AES-256-GCM with a random IV per object. The key is derived with
 * HKDF-SHA256 from DATA_ENCRYPTION_KEY (any string). Fallbacks, in order:
 *  - production without DATA_ENCRYPTION_KEY → key derived from SESSION_SECRET (warning logged)
 *  - development / test                     → fixed development key
 * Decryption tries every configured key (current, DATA_ENCRYPTION_KEY_PREVIOUS,
 * SESSION_SECRET-derived) so adding or rotating DATA_ENCRYPTION_KEY never
 * strands files written under an earlier key. Buffers without the header are
 * legacy plaintext and are returned unchanged.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

export const MAGIC = Buffer.from("CVE1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN;
const DEV_KEY_MATERIAL = "conviction-development-only-data-key";

export class DecryptionError extends Error {}

function derive(material: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(material, "utf8"), Buffer.from("conviction/data-at-rest/v1", "utf8"), Buffer.from("aes-256-gcm document key", "utf8"), 32));
}

let warned = false;

interface KeySet {
  primary: Buffer;
  source: "DATA_ENCRYPTION_KEY" | "SESSION_SECRET" | "DEVELOPMENT";
  candidates: Buffer[];
}

let cached: { fingerprint: string; keys: KeySet } | null = null;

/** Resolve the key set from the environment (cached per environment value). */
export function encryptionKeys(): KeySet {
  const dataKey = process.env.DATA_ENCRYPTION_KEY?.trim() || "";
  const previous = process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim() || "";
  const session = process.env.SESSION_SECRET?.trim() || "";
  const prod = process.env.NODE_ENV === "production";
  const fingerprint = [dataKey, previous, session, prod ? "p" : "d"].join("\u0000");
  if (cached?.fingerprint === fingerprint) return cached.keys;

  let primary: Buffer;
  let source: KeySet["source"];
  if (dataKey) {
    primary = derive(dataKey);
    source = "DATA_ENCRYPTION_KEY";
  } else if (prod) {
    if (!session) throw new Error("DATA_ENCRYPTION_KEY (or SESSION_SECRET) must be set in production");
    if (!warned) {
      warned = true;
      console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", app: "conviction", msg: "DATA_ENCRYPTION_KEY is not set: documents are encrypted with a key derived from SESSION_SECRET. Set DATA_ENCRYPTION_KEY (render.yaml generates one)." }));
    }
    primary = derive(`session:${session}`);
    source = "SESSION_SECRET";
  } else {
    primary = derive(DEV_KEY_MATERIAL);
    source = "DEVELOPMENT";
  }
  const candidates = [primary];
  const add = (k: Buffer) => {
    if (!candidates.some((c) => c.equals(k))) candidates.push(k);
  };
  if (previous) add(derive(previous));
  if (session) add(derive(`session:${session}`));
  if (!prod) add(derive(DEV_KEY_MATERIAL));
  const keys = { primary, source, candidates };
  cached = { fingerprint, keys };
  return keys;
}

export function encryptionKeySource() {
  return encryptionKeys().source;
}

export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= HEADER_LEN + TAG_LEN && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encrypt(plain: Buffer, key: Buffer = encryptionKeys().primary): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

/** Decrypt a CVE1 buffer; legacy plaintext (no header) is returned unchanged. Throws DecryptionError on tampering or unknown key. */
export function decrypt(buf: Buffer, keys: Buffer[] = encryptionKeys().candidates): Buffer {
  if (!isEncrypted(buf)) return buf;
  const iv = buf.subarray(MAGIC.length, HEADER_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const body = buf.subarray(HEADER_LEN, buf.length - TAG_LEN);
  for (const key of keys) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]);
    } catch {
      // wrong key or tampered data — try the next candidate
    }
  }
  throw new DecryptionError("Encrypted object failed authentication (tampered, truncated, or encrypted with an unknown key)");
}

/* ------------------------------ Files (streaming, for large backups) ------------------------------ */

export async function encryptFile(src: string, dest: string, key: Buffer = encryptionKeys().primary): Promise<void> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = fs.createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), () => resolve()).on("error", reject));
}

/** Decrypt a CVE1 file to dest (plaintext files are copied). Output is removed if authentication fails. */
export async function decryptFile(src: string, dest: string, keys: Buffer[] = encryptionKeys().candidates): Promise<void> {
  const size = fs.statSync(src).size;
  const fd = fs.openSync(src, "r");
  const head = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    fs.readSync(fd, head, 0, HEADER_LEN, 0);
    if (size < HEADER_LEN + TAG_LEN || !head.subarray(0, MAGIC.length).equals(MAGIC)) {
      fs.copyFileSync(src, dest);
      return;
    }
    fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    fs.closeSync(fd);
  }
  const iv = head.subarray(MAGIC.length);
  for (const key of keys) {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    try {
      await pipeline(
        fs.createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
        d,
        fs.createWriteStream(dest),
      );
      return;
    } catch {
      fs.rmSync(dest, { force: true });
    }
  }
  throw new DecryptionError(`${src}: failed authentication (tampered, truncated, or unknown key)`);
}
