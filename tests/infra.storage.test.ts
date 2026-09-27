import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decrypt, decryptFile, DecryptionError, encrypt, encryptFile, isEncrypted, MAGIC } from "@/server/crypto";
import { signV4, S3Client, s3ConfigFromEnv } from "@/server/s3";
import { LocalDiskStorage, readStoredFile, S3Storage, setStorageAdapter, storageKind, storeFile, deleteStoredFile } from "@/server/storage";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-storage-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("crypto (AES-256-GCM, CVE1)", () => {
  it("round-trips and uses a fresh IV per object", () => {
    const plain = Buffer.from("Series A deck — confidential ✓".repeat(100));
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a.subarray(0, 4).equals(MAGIC)).toBe(true);
    expect(isEncrypted(a)).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from("confidential"))).toBe(false);
    expect(decrypt(a).equals(plain)).toBe(true);
    expect(decrypt(b).equals(plain)).toBe(true);
    expect(decrypt(encrypt(Buffer.alloc(0))).length).toBe(0);
  });

  it("detects tampering (ciphertext, tag, IV) and truncation", () => {
    const enc = encrypt(Buffer.from("the numbers are real"));
    for (const pos of [5, 20, enc.length - 1]) {
      const t = Buffer.from(enc);
      t[pos]! ^= 0x01;
      expect(() => decrypt(t)).toThrow(DecryptionError);
    }
    expect(() => decrypt(enc.subarray(0, enc.length - 3))).toThrow(DecryptionError);
  });

  it("fails with a different key", () => {
    const enc = encrypt(Buffer.from("secret"));
    const other = Buffer.alloc(32, 7);
    expect(() => decrypt(enc, [other])).toThrow(DecryptionError);
  });

  it("reads legacy plaintext (no header) unchanged", () => {
    const legacy = Buffer.from("%PDF-1.7 legacy plaintext file");
    expect(isEncrypted(legacy)).toBe(false);
    expect(decrypt(legacy).equals(legacy)).toBe(true);
  });

  it("derives keys from DATA_ENCRYPTION_KEY and still reads data written under the previous key", () => {
    const prev = process.env.DATA_ENCRYPTION_KEY;
    try {
      process.env.DATA_ENCRYPTION_KEY = "key-one";
      const enc1 = encrypt(Buffer.from("under key one"));
      process.env.DATA_ENCRYPTION_KEY = "key-two";
      expect(() => decrypt(enc1)).toThrow(DecryptionError);
      process.env.DATA_ENCRYPTION_KEY_PREVIOUS = "key-one";
      expect(decrypt(enc1).toString()).toBe("under key one");
    } finally {
      delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
      if (prev === undefined) delete process.env.DATA_ENCRYPTION_KEY;
      else process.env.DATA_ENCRYPTION_KEY = prev;
    }
  });

  it("streams files (encryptFile/decryptFile) and rejects a tampered file", async () => {
    const src = path.join(tmp, "big.bin");
    const data = Buffer.alloc(3 * 1024 * 1024 + 17);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
    fs.writeFileSync(src, data);
    await encryptFile(src, `${src}.cve`);
    const enc = fs.readFileSync(`${src}.cve`);
    expect(decrypt(enc).equals(data)).toBe(true); // buffer and stream formats are identical
    await decryptFile(`${src}.cve`, `${src}.out`);
    expect(fs.readFileSync(`${src}.out`).equals(data)).toBe(true);
    enc[1000]! ^= 0xff;
    fs.writeFileSync(`${src}.bad`, enc);
    await expect(decryptFile(`${src}.bad`, `${src}.bad.out`)).rejects.toThrow(DecryptionError);
    expect(fs.existsSync(`${src}.bad.out`)).toBe(false);
  });
});

describe("SigV4 (AWS published examples)", () => {
  const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", amzDate: "20130524T000000Z" };
  const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("GET object with Range", () => {
    const r = signV4({ ...creds, method: "GET", path: "/test.txt", headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": empty, "x-amz-date": creds.amzDate }, payloadHash: empty });
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  it("GET bucket (list objects) with query parameters", () => {
    const r = signV4({ ...creds, method: "GET", path: "/", query: { "max-keys": "2", prefix: "J" }, headers: { host: "examplebucket.s3.amazonaws.com", "x-amz-content-sha256": empty, "x-amz-date": creds.amzDate }, payloadHash: empty });
    expect(r.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("storage adapters", () => {
  it("local: storeFile encrypts on disk, readStoredFile decrypts, legacy plaintext is readable, delete removes", async () => {
    const root = path.join(tmp, "uploads");
    setStorageAdapter(new LocalDiskStorage(root));
    try {
      expect(storageKind()).toBe("local");
      const doc = Buffer.from("%PDF-1.4 fictional deck");
      const key = await storeFile("ws_1", "abc123", "deck.pdf", doc);
      expect(key).toBe("ws_1/abc123.pdf");
      const onDisk = fs.readFileSync(path.join(root, key));
      expect(isEncrypted(onDisk)).toBe(true);
      expect(onDisk.includes(Buffer.from("fictional"))).toBe(false);
      expect((await readStoredFile(key)).equals(doc)).toBe(true);

      fs.writeFileSync(path.join(root, "ws_1", "legacy.pdf"), Buffer.from("plain legacy"));
      expect((await readStoredFile("ws_1/legacy.pdf")).toString()).toBe("plain legacy");

      await expect(readStoredFile("../etc/passwd")).rejects.toThrow(/Invalid storage path/);
      await deleteStoredFile(key);
      expect(fs.existsSync(path.join(root, key))).toBe(false);
      await expect(readStoredFile(key)).rejects.toThrow(/not found/);
    } finally {
      setStorageAdapter(null);
    }
  });

  it("s3 config only when bucket + both keys are set", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" })).toBeNull();
    const c = s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com/" })!;
    expect(c.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
    expect(c.region).toBe("us-east-1");
  });

  describe("s3 against a mock S3 server (path-style, signature verified)", () => {
    const objects = new Map<string, Buffer>();
    const seen: { method: string; url: string }[] = [];
    let server: http.Server;
    let endpoint = "";
    const secret = "test-secret-key";

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          seen.push({ method: req.method!, url: req.url! });
          const url = new URL(req.url!, "http://x");
          // Verify the signature exactly as S3 would.
          const auth = String(req.headers.authorization ?? "");
          const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(";") ?? [];
          const headers = Object.fromEntries(signed.map((h) => [h, String(req.headers[h] ?? "")]));
          const query = Object.fromEntries(url.searchParams.entries());
          const expected = signV4({ method: req.method!, path: url.pathname, query, headers, payloadHash: String(req.headers["x-amz-content-sha256"]), accessKeyId: "AKTEST", secretAccessKey: secret, region: "auto", amzDate: String(req.headers["x-amz-date"]) });
          if (!auth.includes(`Signature=${expected.signature}`)) {
            res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
            return;
          }
          if (!url.pathname.startsWith("/bucket")) {
            res.writeHead(404).end("<Error><Code>NoSuchBucket</Code></Error>");
            return;
          }
          const key = decodeURIComponent(url.pathname.slice("/bucket/".length));
          if (req.method === "PUT") {
            objects.set(key, body);
            res.writeHead(200).end();
          } else if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
            const prefix = url.searchParams.get("prefix") ?? "";
            const items = [...objects.entries()].filter(([k]) => k.startsWith(prefix));
            res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult>${items.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
          } else if (req.method === "GET") {
            const v = objects.get(key);
            if (!v) res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
            else res.writeHead(200).end(v);
          } else if (req.method === "DELETE") {
            objects.delete(key);
            res.writeHead(204).end();
          } else res.writeHead(405).end();
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("put/get/list/delete with encryption; falls back to local disk for pre-S3 files", async () => {
      const client = new S3Client({ bucket: "bucket", accessKeyId: "AKTEST", secretAccessKey: secret, region: "auto", endpoint, prefix: "" });
      setStorageAdapter(new S3Storage(client));
      const prevDir = process.env.STORAGE_DIR;
      process.env.STORAGE_DIR = path.join(tmp, "legacy-disk");
      try {
        const doc = Buffer.from("deck bytes with spaces & ünïcode");
        const key = await storeFile("ws_9", "f00d", "My Deck (final).pdf", doc);
        expect(objects.has(`uploads/${key}`)).toBe(true);
        expect(isEncrypted(objects.get(`uploads/${key}`)!)).toBe(true);
        expect((await readStoredFile(key)).equals(doc)).toBe(true);
        expect((await client.list("uploads/ws_9/")).map((o) => o.key)).toEqual([`uploads/${key}`]);
        await deleteStoredFile(key);
        expect(objects.has(`uploads/${key}`)).toBe(false);

        // Documents stored on the disk before S3 was configured remain readable.
        fs.mkdirSync(path.join(process.env.STORAGE_DIR, "ws_9"), { recursive: true });
        fs.writeFileSync(path.join(process.env.STORAGE_DIR, "ws_9", "old.pdf"), encrypt(Buffer.from("old deck")));
        expect((await readStoredFile("ws_9/old.pdf")).toString()).toBe("old deck");

        // Key with characters that need encoding round-trips through the signature.
        await client.put("backups/a b+c=d.db.cve", Buffer.from("x"));
        expect((await client.get("backups/a b+c=d.db.cve"))?.toString()).toBe("x");
        expect(await client.get("backups/missing")).toBeNull();
        expect(seen.every((r) => r.url.startsWith("/bucket"))).toBe(true); // path-style
      } finally {
        setStorageAdapter(null);
        if (prevDir === undefined) delete process.env.STORAGE_DIR;
        else process.env.STORAGE_DIR = prevDir;
      }
    });

    it("surfaces S3 errors with status and code", async () => {
      const bad = new S3Client({ bucket: "bucket", accessKeyId: "AKTEST", secretAccessKey: "wrong", region: "auto", endpoint, prefix: "" });
      await expect(bad.put("k", Buffer.from("x"))).rejects.toThrow(/403 SignatureDoesNotMatch/);
    });
  });
});
