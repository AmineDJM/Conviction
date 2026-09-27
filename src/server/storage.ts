/**
 * Document storage. Files are stored per workspace under STORAGE_DIR with
 * content-addressed names. Deployments must place STORAGE_DIR on encrypted
 * storage; deletion removes the file (§116).
 */
import fs from "node:fs/promises";
import path from "node:path";

export function storageRoot() {
  return process.env.STORAGE_DIR ?? path.join(process.cwd(), "data", "uploads");
}

function safeSegment(s: string) {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export async function storeFile(workspaceId: string, sha256: string, filename: string, buf: Buffer): Promise<string> {
  const dir = path.join(storageRoot(), safeSegment(workspaceId));
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(filename).slice(0, 10);
  const rel = path.join(safeSegment(workspaceId), `${sha256}${safeSegment(ext)}`);
  await fs.writeFile(path.join(storageRoot(), rel), buf);
  return rel;
}

export async function readStoredFile(rel: string): Promise<Buffer> {
  const full = path.resolve(storageRoot(), rel);
  if (!full.startsWith(path.resolve(storageRoot()))) throw new Error("Invalid storage path");
  return fs.readFile(full);
}

export async function deleteStoredFile(rel: string) {
  const full = path.resolve(storageRoot(), rel);
  if (!full.startsWith(path.resolve(storageRoot()))) return;
  await fs.rm(full, { force: true });
}
