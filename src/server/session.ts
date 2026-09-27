import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE, type SessionContext } from "./auth";

export async function getSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For route handlers: returns the session or a 401 response. */
export async function apiSession(): Promise<SessionContext | Response> {
  const s = await getSession();
  return s ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function canWrite(s: SessionContext) {
  return s.role !== "VIEWER";
}
