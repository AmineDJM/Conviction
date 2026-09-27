/**
 * Minimal S3-compatible client: AWS Signature Version 4 with node:crypto +
 * fetch, path-style URLs (https://endpoint/bucket/key) so the same code works
 * with AWS S3, Cloudflare R2, Backblaze B2, MinIO and Supabase Storage's S3
 * endpoint. Only what Conviction needs: PUT, GET, DELETE, HEAD, LIST (v2).
 */
import { createHash, createHmac } from "node:crypto";

export interface S3Config {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com — no bucket, no trailing slash. */
  endpoint: string;
  /** Optional key prefix inside the bucket (e.g. "conviction/"). */
  prefix: string;
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const region = env.S3_REGION?.trim() || "us-east-1";
  const endpoint = (env.S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`).replace(/\/+$/, "");
  const prefix = (env.S3_PREFIX?.trim() || "").replace(/^\/+/, "");
  return { bucket, accessKeyId, secretAccessKey, region, endpoint, prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix };
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding as required by SigV4 (slash kept for paths). */
export function uriEncode(s: string, keepSlash: boolean) {
  let out = "";
  for (const ch of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(ch);
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-" || c === "_" || c === "." || c === "~") out += c;
    else if (c === "/" && keepSlash) out += c;
    else out += `%${ch.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export interface SignInput {
  method: string;
  /** Already-encoded canonical path, e.g. /bucket/key%20name */
  path: string;
  query?: Record<string, string>;
  /** Must include host. Names are lower-cased for signing. */
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** yyyymmddThhmmssZ */
  amzDate: string;
}

/** Compute the SigV4 Authorization header (pure; tested against AWS's published example). */
export function signV4(v: SignInput): { authorization: string; signature: string; canonicalRequest: string } {
  const service = v.service ?? "s3";
  const date = v.amzDate.slice(0, 8);
  const headerEntries = Object.entries(v.headers)
    .map(([k, val]) => [k.toLowerCase().trim(), String(val).trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = headerEntries.map(([k, val]) => `${k}:${val}\n`).join("");
  const signedHeaders = headerEntries.map(([k]) => k).join(";");
  const canonicalQuery = Object.entries(v.query ?? {})
    .map(([k, val]) => [uriEncode(k, false), uriEncode(val, false)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, val]) => `${k}=${val}`)
    .join("&");
  const canonicalRequest = [v.method, v.path, canonicalQuery, canonicalHeaders, signedHeaders, v.payloadHash].join("\n");
  const scope = `${date}/${v.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", v.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${v.secretAccessKey}`, date);
  const kRegion = hmac(kDate, v.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${v.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature, canonicalRequest };
}

export class S3Error extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export class S3Client {
  constructor(private cfg: S3Config) {}

  get description() {
    return `${this.cfg.endpoint}/${this.cfg.bucket}${this.cfg.prefix ? `/${this.cfg.prefix}` : ""}`;
  }

  private async request(method: string, key: string | null, opts: { body?: Buffer; query?: Record<string, string>; contentType?: string } = {}) {
    const url = new URL(this.cfg.endpoint);
    const basePath = url.pathname.replace(/\/+$/, "");
    const objectPath = key === null ? "" : `/${uriEncode(this.cfg.prefix + key, true)}`;
    const path = `${basePath}/${uriEncode(this.cfg.bucket, false)}${objectPath}`;
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const payloadHash = sha256Hex(opts.body ?? Buffer.alloc(0));
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (opts.contentType) headers["content-type"] = opts.contentType;
    const { authorization } = signV4({ method, path, query: opts.query, headers, payloadHash, accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, region: this.cfg.region, amzDate });
    const qs = Object.entries(opts.query ?? {})
      .map(([k, v]) => `${uriEncode(k, false)}=${uriEncode(v, false)}`)
      .join("&");
    const sendHeaders: Record<string, string> = { ...headers, authorization };
    delete sendHeaders.host; // fetch sets Host itself (same value as signed)
    const res = await fetch(`${url.protocol}//${url.host}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: sendHeaders,
      body: opts.body ? new Uint8Array(opts.body) : undefined,
    });
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new S3Error(`S3 ${what} failed: ${res.status}${code ? ` ${code}` : ""}`, res.status);
  }

  async put(key: string, body: Buffer, contentType = "application/octet-stream") {
    const res = await this.request("PUT", key, { body, contentType });
    if (!res.ok) await this.fail(res, `PUT ${key}`);
  }

  /** Returns null when the object does not exist. */
  async get(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, `GET ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) await this.fail(res, `DELETE ${key}`);
  }

  async list(prefix: string): Promise<{ key: string; size: number; lastModified: string }[]> {
    const out: { key: string; size: number; lastModified: string }[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix: this.cfg.prefix + prefix };
      if (token) query["continuation-token"] = token;
      const res = await this.request("GET", null, { query });
      if (!res.ok) await this.fail(res, "LIST");
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const body = m[1]!;
        const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1] ?? "");
        out.push({ key: key.slice(this.cfg.prefix.length), size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0), lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(body)?.[1] ?? "" });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined : undefined;
    } while (token);
    return out;
  }
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
