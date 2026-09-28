/**
 * Model provider errors. The provider's own text (which can quote request
 * content or fragments of a rejected API key) is logged server-side only; what
 * is stored on runs, meetings and chat messages — and returned to clients — is
 * a fixed, user-safe message carrying the error class.
 */
import { logger } from "@/lib/log";
import type { Usage } from "./pricing";

export type ProviderErrorClass = "QUOTA" | "RATE_LIMIT" | "AUTHENTICATION" | "INVALID_REQUEST" | "TIMEOUT" | "UNAVAILABLE";

/** Errors a retry cannot fix: retrying only wastes time (and, for rate limits of this kind, nothing will change). */
export const NON_RETRYABLE: ReadonlySet<ProviderErrorClass> = new Set(["QUOTA", "AUTHENTICATION", "INVALID_REQUEST"]);
const QUOTA_RE = /insufficient_quota|credit_balance|billing_hard_limit|billing_not_active|no credits|exceeded your current quota/i;

const LABEL: Record<ProviderErrorClass, string> = { QUOTA: "quota", RATE_LIMIT: "rate limit", AUTHENTICATION: "authentication", INVALID_REQUEST: "invalid request", TIMEOUT: "timeout", UNAVAILABLE: "unavailable" };

export class ProviderError extends Error {
  constructor(
    readonly errorClass: ProviderErrorClass,
    readonly status: number | null,
    /** Usage reported with the failure (a request the provider accepted and then failed), if any. */
    readonly usage: Usage | null = null,
  ) {
    super(
      errorClass === "QUOTA"
        ? "The OpenAI account has no credits left. Add credits in the OpenAI billing settings (platform.openai.com → Billing), then retry."
        : errorClass === "AUTHENTICATION"
          ? "The model provider rejected the API key (authentication). Check OPENAI_API_KEY, then retry."
          : `The model provider returned an error (${LABEL[errorClass]}). Retry, or check the server logs.`,
    );
    this.name = "ProviderError";
  }
}

export function classifyProviderError(status: number | null, code?: string | null): ProviderErrorClass {
  // Out of credits arrives as a 429 but is not a rate limit: waiting does not help.
  if (QUOTA_RE.test(code ?? "")) return "QUOTA";
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status !== null && status >= 400 && status < 500) return "INVALID_REQUEST";
  // No HTTP status (stream events, transport) or a 5xx: the provider's error code decides.
  const c = (code ?? "").toLowerCase();
  if (/rate_limit|rate limit|quota/.test(c)) return "RATE_LIMIT";
  if (/invalid_api_key|authenticat|unauthorized|api key/.test(c)) return "AUTHENTICATION";
  if (/timeout|timed out/.test(c)) return "TIMEOUT";
  if (/invalid/.test(c)) return "INVALID_REQUEST";
  return "UNAVAILABLE";
}

/** Strips anything that looks like a credential before provider text reaches a log line. */
export function redactSecrets(text: string): string {
  return text.replace(/\b(sk|rk|pk|sess)-[A-Za-z0-9_*.\-]{3,}/g, "$1-[redacted]").replace(/Bearer\s+[^\s"',]+/gi, "Bearer [redacted]");
}

/** Logs the provider's text (redacted) and returns the user-safe error. */
export function providerError(where: string, status: number | null, detail: string, opts: { code?: string | null; usage?: Usage | null } = {}): ProviderError {
  const err = new ProviderError(classifyProviderError(status, `${opts.code ?? ""} ${detail}`), status, opts.usage ?? null);
  logger.error({ where, status, errorClass: err.errorClass, detail: redactSecrets(detail).slice(0, 1000) }, "model provider error");
  return err;
}
