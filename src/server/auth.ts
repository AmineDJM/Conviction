/**
 * Authentication and workspace access (§116). Email/password with scrypt,
 * server-side sessions, HMAC-signed session cookie. Every request resolves to
 * exactly one workspace; all repository queries are scoped by it.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { newId, nowIso } from "./ids";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { upsertDefaultFund } from "./repo";

export const SESSION_COOKIE = "cv_session";
const SESSION_DAYS = 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (≥16 chars) in production");
    return "dev-only-session-secret-change-me";
  }
  return s;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && timingSafeEqual(hash, expected);
}

export function signSession(id: string) {
  const mac = createHmac("sha256", secret()).update(id).digest("base64url");
  return `${id}.${mac}`;
}

export function unsignSession(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const id = value.slice(0, i);
  const mac = Buffer.from(value.slice(i + 1));
  const expected = Buffer.from(createHmac("sha256", secret()).update(id).digest("base64url"));
  return mac.length === expected.length && timingSafeEqual(mac, expected) ? id : null;
}

export interface SessionContext {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
  role: "OWNER" | "PARTNER" | "ANALYST" | "VIEWER";
  workspaceName: string;
}

export function createSession(userId: string, workspaceId: string, db: DB = getDb()) {
  const id = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.insert(schema.sessions).values({ id, userId, workspaceId, expiresAt: expires, createdAt: nowIso() }).run();
  return { cookie: signSession(id), expires };
}

export function resolveSession(cookieValue: string | undefined, db: DB = getDb()): SessionContext | null {
  const id = unsignSession(cookieValue);
  if (!id) return null;
  const row = db
    .select({
      userId: schema.sessions.userId,
      workspaceId: schema.sessions.workspaceId,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.memberships.role,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.sessions.userId), eq(schema.memberships.workspaceId, schema.sessions.workspaceId)))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, nowIso())))
    .get();
  return row ?? null;
}

export function destroySession(cookieValue: string | undefined, db: DB = getDb()) {
  const id = unsignSession(cookieValue);
  if (id) db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
}

/* Login throttling: in-memory, per (email, client IP). Failures only; a success clears the key. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { n: number; since: number }>();

export class LoginThrottledError extends Error {
  constructor(readonly retryAfterSec: number) {
    super(`Too many sign-in attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`);
  }
}

let dummyHash: string | null = null;

/** Throws LoginThrottledError after LOGIN_MAX_FAILURES failures within LOGIN_WINDOW_MS for the same email and IP. */
export function login(email: string, password: string, db: DB = getDb(), client: { ip?: string | null } = {}) {
  const addr = email.toLowerCase().trim();
  const key = `${addr}|${client.ip ?? ""}`;
  const now = Date.now();
  const f = failures.get(key);
  if (f && now - f.since < LOGIN_WINDOW_MS && f.n >= LOGIN_MAX_FAILURES) throw new LoginThrottledError((f.since + LOGIN_WINDOW_MS - now) / 1000);
  const user = db.select().from(schema.users).where(eq(schema.users.email, addr)).get();
  // Unknown emails pay the same scrypt cost as known ones (no timing oracle on account existence).
  const ok = verifyPassword(password, user?.passwordHash ?? (dummyHash ??= hashPassword(randomBytes(16).toString("hex"))));
  const m = user && ok ? db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).get() : undefined;
  if (!user || !ok || !m) {
    if (failures.size > 10_000) for (const [k, v] of failures) if (now - v.since >= LOGIN_WINDOW_MS) failures.delete(k);
    failures.set(key, f && now - f.since < LOGIN_WINDOW_MS ? { n: f.n + 1, since: f.since } : { n: 1, since: now });
    return null;
  }
  failures.delete(key);
  return createSession(user.id, m.workspaceId, db);
}

/**
 * Backups hold the whole SQLite file (every workspace): only owners of the instance's setup workspace — the
 * first one created — manage them. Owners of other workspaces use the per-workspace export.
 */
export function isInstanceOwner(s: Pick<SessionContext, "role" | "workspaceId">, db: DB = getDb()) {
  if (s.role !== "OWNER") return false;
  const first = db.select({ id: schema.workspaces.id }).from(schema.workspaces).orderBy(asc(schema.workspaces.createdAt), asc(schema.workspaces.id)).limit(1).get();
  return first?.id === s.workspaceId;
}

/** Create a user + workspace (used by setup and seed). */
export function createWorkspaceWithOwner(v: { email: string; name: string; password: string; workspaceName: string }, db: DB = getDb()) {
  const userId = newId("usr");
  const workspaceId = newId("ws");
  db.transaction((tx) => {
    tx.insert(schema.users).values({ id: userId, email: v.email.toLowerCase().trim(), name: v.name, passwordHash: hashPassword(v.password), createdAt: nowIso() }).run();
    tx.insert(schema.workspaces).values({ id: workspaceId, name: v.workspaceName, createdAt: nowIso() }).run();
    tx.insert(schema.memberships).values({ userId, workspaceId, role: "OWNER" }).run();
  });
  upsertDefaultFund(workspaceId, { ...DEFAULT_FUND_PROFILE, name: `${v.workspaceName} Fund Profile` }, db);
  return { userId, workspaceId };
}

export function hasAnyUser(db: DB = getDb()) {
  return !!db.select({ id: schema.users.id }).from(schema.users).limit(1).get();
}
