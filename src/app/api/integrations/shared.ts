/** Shared helpers for /api/integrations/* route handlers (session → actor, errors, same-origin check). */
import { cookies } from "next/headers";
import { z } from "zod";
import { resolveSession, SESSION_COOKIE, unsignSession } from "@/server/auth";
import { IntegrationError } from "@/server/connectors/http";
import { isConnectorId, type ConnectorId } from "@/server/connectors/meeting-connectors";
import type { Actor } from "@/server/connectors/oauth";
import { FounderCallError } from "@/orchestration/founder-call";
import { logger } from "@/lib/log";

/** The signed-in user (with the server session id, used to bind OAuth state), or null. */
export async function currentActor(): Promise<Actor | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = resolveSession(raw);
  const sessionId = unsignSession(raw);
  if (!s || !sessionId) return null;
  return { workspaceId: s.workspaceId, userId: s.userId, role: s.role, sessionId };
}

export function providerParam(raw: string): ConnectorId | null {
  return isConnectorId(raw) ? raw : null;
}

/** Reject cross-site POSTs (the session cookie is SameSite=Lax already; this is defence in depth). */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "cross-site";
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Relative redirect (no dependence on the internal host name behind the proxy). */
export function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export function withParams(path: string, params: Record<string, string>): string {
  const u = new URL(path, "http://x.invalid");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
}

export function errorResponse(e: unknown, context: string): Response {
  if (e instanceof IntegrationError) {
    const headers: Record<string, string> = e.retryAfterSec ? { "retry-after": String(e.retryAfterSec) } : {};
    return Response.json({ error: e.message, code: e.code, reauth: e.code === "REAUTH_REQUIRED", retryAfterSec: e.retryAfterSec }, { status: e.status, headers });
  }
  if (e instanceof FounderCallError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  // Messages we did not build could echo upstream content: log the class and a truncated message only.
  logger.error({ err: (e as Error)?.name, message: String((e as Error)?.message ?? e).slice(0, 200), context }, "integration request failed");
  return Response.json({ error: "The integration request failed. Try again, or upload the transcript manually." }, { status: 500 });
}
