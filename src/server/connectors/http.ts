/**
 * HTTP plumbing shared by the meeting connectors: typed errors, timeouts,
 * size-capped downloads, redirect handling that never forwards a bearer token
 * to another origin, and provider endpoints.
 *
 * Nothing here logs request headers, bodies or URLs with credentials. Error
 * messages carry only the provider's error code/description (truncated).
 */

export type IntegrationErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "REAUTH_REQUIRED"
  | "FORBIDDEN"
  | "INVALID"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TOO_LARGE"
  | "UPSTREAM"
  | "STATE_INVALID";

const STATUS: Record<IntegrationErrorCode, number> = {
  NOT_CONFIGURED: 409,
  NOT_CONNECTED: 409,
  REAUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  TOO_LARGE: 413,
  UPSTREAM: 502,
  STATE_INVALID: 400,
};

export { integrationErrorMessage } from "@/lib/integration-errors";

/** Error code safe to put in a redirect URL. */
export function integrationErrorCode(e: unknown): string {
  if (e instanceof IntegrationError) return /declin|not granted|refused|access_denied/i.test(e.message) ? "DECLINED" : e.code;
  return "FAILED";
}

export class IntegrationError extends Error {
  constructor(
    public code: IntegrationErrorCode,
    message: string,
    public retryAfterSec: number | null = null,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

/** The upstream API rejected the access token (HTTP 401). Caught by the refresh-and-retry wrapper. */
export class UpstreamUnauthorized extends Error {}

/* ------------------------------ Endpoints ------------------------------ */

/**
 * Provider endpoints. `CONVICTION_INTEGRATIONS_MOCK_URL` points every endpoint
 * at a local mock (scripts/mock-integrations.ts) for tests and offline
 * development; it is ignored when NODE_ENV=production.
 */
export function endpoints() {
  const mock = process.env.NODE_ENV === "production" ? "" : (process.env.CONVICTION_INTEGRATIONS_MOCK_URL?.trim().replace(/\/+$/, "") ?? "");
  if (mock) {
    return {
      mock,
      zoomAuthorize: `${mock}/zoom/oauth/authorize`,
      zoomToken: `${mock}/zoom/oauth/token`,
      zoomRevoke: `${mock}/zoom/oauth/revoke`,
      zoomApi: `${mock}/zoom/v2`,
      googleAuthorize: `${mock}/google/o/oauth2/v2/auth`,
      googleToken: `${mock}/google/token`,
      googleRevoke: `${mock}/google/revoke`,
      googleUserinfo: `${mock}/google/v1/userinfo`,
      meetApi: `${mock}/google/meet/v2`,
      driveApi: `${mock}/google/drive/v3`,
    };
  }
  return {
    mock: "",
    zoomAuthorize: "https://zoom.us/oauth/authorize",
    zoomToken: "https://zoom.us/oauth/token",
    zoomRevoke: "https://zoom.us/oauth/revoke",
    zoomApi: "https://api.zoom.us/v2",
    googleAuthorize: "https://accounts.google.com/o/oauth2/v2/auth",
    googleToken: "https://oauth2.googleapis.com/token",
    googleRevoke: "https://oauth2.googleapis.com/revoke",
    googleUserinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    meetApi: "https://meet.googleapis.com/v2",
    driveApi: "https://www.googleapis.com/drive/v3",
  };
}

/* ------------------------------ Requests ------------------------------ */

const API_TIMEOUT_MS = 30_000;
/** Wait for a 429 at most this long before retrying once; longer waits are surfaced to the user. */
const MAX_INLINE_RETRY_SEC = 5;

function retryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : null;
}

/** Short, credential-free description of an error body (OAuth `error`/`error_description`, Google `error.message`, Zoom `code`/`message`). */
export function describeError(body: unknown, fallback: string): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const e = b.error;
  let msg: string | null = null;
  if (e && typeof e === "object") msg = String((e as Record<string, unknown>).message ?? (e as Record<string, unknown>).status ?? "");
  else if (typeof e === "string") msg = b.error_description ? `${e}: ${String(b.error_description)}` : e;
  else if (typeof b.message === "string") msg = b.code !== undefined ? `${String(b.code)} ${b.message}` : b.message;
  else if (typeof b.reason === "string") msg = b.reason;
  return (msg || fallback).replace(/\s+/g, " ").slice(0, 200);
}

/**
 * JSON API request with a timeout. 401 → UpstreamUnauthorized (the caller
 * refreshes and retries once); 429 → one short inline retry, else RATE_LIMITED.
 */
export async function apiJson<T>(provider: string, url: string, init: RequestInit & { token: string }): Promise<T> {
  const { token, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...rest, headers: { accept: "application/json", ...(rest.headers ?? {}), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(API_TIMEOUT_MS), redirect: "error" });
    } catch (e) {
      throw new IntegrationError("UPSTREAM", `${provider} did not respond (${(e as Error).name === "TimeoutError" ? "timeout" : "network error"})`);
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return body as T;
    if (res.status === 401) throw new UpstreamUnauthorized(describeError(body, "unauthorized"));
    if (res.status === 429) {
      const wait = retryAfter(res);
      if (attempt === 0 && wait !== null && wait <= MAX_INLINE_RETRY_SEC) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new IntegrationError("RATE_LIMITED", `${provider} rate limit reached${wait ? ` — retry in ${wait < 120 ? `${wait} s` : `${Math.ceil(wait / 60)} min`}` : " — retry later"}.`, wait);
    }
    const detail = describeError(body, res.statusText || `HTTP ${res.status}`);
    if (res.status === 403) throw new IntegrationError("FORBIDDEN", `${provider} refused access (${detail}). Check the granted scopes and reconnect.`);
    if (res.status === 404) throw new IntegrationError("NOT_FOUND", `${provider}: not found (${detail})`);
    if (res.status === 400) throw new IntegrationError("INVALID", `${provider} rejected the request (${detail})`);
    throw new IntegrationError("UPSTREAM", `${provider} error ${res.status} (${detail})`);
  }
}

/** Form-encoded POST to an OAuth endpoint. Returns status + parsed JSON (never throws on HTTP status). */
export async function oauthPost(provider: string, url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...headers },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (e) {
    throw new IntegrationError("UPSTREAM", `${provider} authorization server did not respond (${(e as Error).name === "TimeoutError" ? "timeout" : "network error"})`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body };
}

/* ------------------------------ Downloads ------------------------------ */

/** Read a response body, aborting once it exceeds `max` bytes. */
export async function readCapped(res: Response, max: number, what: string): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new IntegrationError("TOO_LARGE", `${what} is ${(declared / 1024 / 1024).toFixed(1)} MB; the limit is ${(max / 1024 / 1024).toFixed(0)} MB`);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Buffer[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      throw new IntegrationError("TOO_LARGE", `${what} exceeds the ${(max / 1024 / 1024).toFixed(0)} MB limit`);
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

/**
 * Authenticated download. Redirects are followed manually (≤ 5 hops, https
 * only) and the bearer token is sent only to trusted origins — never to a
 * redirect target on another origin (signed CDN URLs do not need it).
 */
export async function download(provider: string, url: string, v: { token: string; max: number; what: string; trusted: (u: URL) => boolean; timeoutMs?: number }): Promise<{ data: Buffer; contentType: string | null }> {
  let current = new URL(url);
  if (!v.trusted(current)) throw new IntegrationError("INVALID", `${provider} returned a download location on an untrusted host`);
  const signal = AbortSignal.timeout(v.timeoutMs ?? 5 * 60_000);
  for (let hop = 0; hop < 6; hop++) {
    const withToken = v.trusted(current);
    let res: Response;
    try {
      res = await fetch(current, { headers: withToken ? { authorization: `Bearer ${v.token}` } : {}, redirect: "manual", signal });
    } catch (e) {
      throw new IntegrationError("UPSTREAM", `${provider} download failed (${(e as Error).name === "TimeoutError" ? "timeout" : "network error"})`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      const next = new URL(res.headers.get("location")!, current);
      const local = endpoints().mock && next.origin === new URL(endpoints().mock).origin;
      if (next.protocol !== "https:" && !local) throw new IntegrationError("INVALID", `${provider} redirected the download to a non-HTTPS location`);
      current = next;
      continue;
    }
    if (res.status === 401 && withToken) throw new UpstreamUnauthorized("download unauthorized");
    if (res.status === 429) throw new IntegrationError("RATE_LIMITED", `${provider} rate limit reached while downloading — retry later.`, retryAfter(res));
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new IntegrationError(res.status === 404 ? "NOT_FOUND" : "UPSTREAM", `${provider} download failed (HTTP ${res.status})`);
    }
    return { data: await readCapped(res, v.max, v.what), contentType: res.headers.get("content-type") };
  }
  throw new IntegrationError("UPSTREAM", `${provider} download redirected too many times`);
}
