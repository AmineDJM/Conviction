/**
 * Document storage behind a small adapter interface.
 *
 *  - LocalDiskStorage (default): files under STORAGE_DIR (the Render disk).
 *  - S3Storage: used only when S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY
 *    are set (optional S3_ENDPOINT, S3_REGION, S3_PREFIX). Any S3-compatible
 *    store works (AWS, Cloudflare R2, Backblaze B2, Supabase Storage).
 *
 * Every object is encrypted (AES-256-GCM, see ./crypto) before it leaves the
 * process; reads decrypt, and legacy plaintext files are read transparently.
 * Keys are content-addressed per workspace: "<workspaceId>/<sha256><ext>".
 * Deletion removes the object (§116).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./crypto";
import { S3Client, s3ConfigFromEnv } from "./s3";

export interface StorageAdapter {
  readonly kind: "local" | "s3";
  readonly description: string;
  put(key: string, data: Buffer): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export function storageRoot() {
  return process.env.STORAGE_DIR ?? path.join(process.cwd(), "data", "uploads");
}

function safeSegment(s: string) {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/** Normalize a stored key (older rows may use OS separators) and refuse traversal. */
function normalizeKey(rel: string): string {
  const key = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.split("/").some((seg) => seg === ".." || seg === "")) throw new Error("Invalid storage path");
  return key;
}

export class LocalDiskStorage implements StorageAdapter {
  readonly kind = "local" as const;
  constructor(private root: string = storageRoot()) {}
  get description() {
    return path.resolve(this.root);
  }
  private full(key: string) {
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.full(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Write-then-rename so a crash never leaves a half-written object under the final name.
    const tmp = `${full}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.full(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await fs.rm(this.full(key), { force: true });
  }
}

export class S3Storage implements StorageAdapter {
  readonly kind = "s3" as const;
  constructor(private client: S3Client) {}
  get description() {
    return this.client.description;
  }
  put(key: string, data: Buffer) {
    return this.client.put(`uploads/${key}`, data);
  }
  get(key: string) {
    return this.client.get(`uploads/${key}`);
  }
  delete(key: string) {
    return this.client.delete(`uploads/${key}`);
  }
}

let adapterOverride: StorageAdapter | null = null;

/** Tests / scripts: force a specific adapter (null restores env-based selection). */
export function setStorageAdapter(a: StorageAdapter | null) {
  adapterOverride = a;
}

export function getStorage(): StorageAdapter {
  if (adapterOverride) return adapterOverride;
  const cfg = s3ConfigFromEnv();
  return cfg ? new S3Storage(new S3Client(cfg)) : new LocalDiskStorage();
}

export function storageKind(): "local" | "s3" {
  return getStorage().kind;
}

export function storageDescription(): string {
  return getStorage().description;
}

/** Deterministic, content-addressed key (lets callers persist the document row before the async write). */
export function storageKeyFor(workspaceId: string, sha256: string, filename: string): string {
  const ext = path.extname(filename).slice(0, 10);
  return `${safeSegment(workspaceId)}/${safeSegment(sha256)}${safeSegment(ext)}`;
}

export async function storeFile(workspaceId: string, sha256: string, filename: string, buf: Buffer): Promise<string> {
  const key = storageKeyFor(workspaceId, sha256, filename);
  await getStorage().put(key, encrypt(buf));
  return key;
}

export async function readStoredFile(rel: string): Promise<Buffer> {
  const key = normalizeKey(rel);
  const store = getStorage();
  let data = await store.get(key);
  // After switching to object storage, documents uploaded earlier still live on the disk.
  if (data === null && store.kind !== "local") data = await new LocalDiskStorage().get(key);
  if (data === null) throw new Error(`Stored file not found: ${key}`);
  return decrypt(data);
}

export async function deleteStoredFile(rel: string) {
  let key: string;
  try {
    key = normalizeKey(rel);
  } catch {
    return;
  }
  const store = getStorage();
  await store.delete(key);
  if (store.kind !== "local") await new LocalDiskStorage().delete(key);
}
