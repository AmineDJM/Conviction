/**
 * Workspace members and roles. Every mutation is audited.
 *
 * Roles: OWNER (members, backups, export) · PARTNER (decisions, deletion) ·
 * ANALYST (analyses, edits) · VIEWER (read-only).
 * Invariant: a workspace always keeps at least one OWNER.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s, type DB } from "@/db/client";
import { hashPassword, verifyPassword } from "./auth";
import { newId, nowIso } from "./ids";
import { audit } from "./repo";

export const ROLES = ["OWNER", "PARTNER", "ANALYST", "VIEWER"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ROLE_DESCRIPTION: Record<Role, string> = {
  OWNER: "Everything, plus members, backups and full export",
  PARTNER: "Analyses, IC decisions, permanent deletion of deals",
  ANALYST: "Analyses, corrections, fund memory",
  VIEWER: "Read-only",
};

export class MemberError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastSessionAt: string | null;
}

export function listMembers(workspaceId: string, db: DB = getDb()): Member[] {
  return db
    .select({
      userId: s.users.id,
      email: s.users.email,
      name: s.users.name,
      role: s.memberships.role,
      createdAt: s.users.createdAt,
      lastSessionAt: sql<string | null>`(select max(${s.sessions.createdAt}) from ${s.sessions} where ${s.sessions.userId} = ${s.users.id} and ${s.sessions.workspaceId} = ${workspaceId})`,
    })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.workspaceId, workspaceId))
    .orderBy(s.users.createdAt)
    .all();
}

function membership(workspaceId: string, userId: string, db: DB) {
  return db.select().from(s.memberships).where(and(eq(s.memberships.workspaceId, workspaceId), eq(s.memberships.userId, userId))).get();
}

function ownerCount(workspaceId: string, db: DB) {
  return db.select({ n: sql<number>`count(*)` }).from(s.memberships).where(and(eq(s.memberships.workspaceId, workspaceId), eq(s.memberships.role, "OWNER"))).get()?.n ?? 0;
}

/** 16 characters from an unambiguous alphabet (~95 bits). Shown once, never stored in clear. */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  role: Role,
});

/** Create an account for a new member; returns the one-time temporary password. */
export function inviteMember(workspaceId: string, actorUserId: string, input: z.input<typeof InviteInput>, db: DB = getDb()) {
  const v = InviteInput.parse(input);
  const existing = db.select().from(s.users).where(eq(s.users.email, v.email)).get();
  if (existing) {
    if (membership(workspaceId, existing.id, db)) throw new MemberError(`${v.email} is already a member of this workspace`, 409);
    throw new MemberError(`${v.email} already has a Conviction account in another workspace`, 409);
  }
  const password = temporaryPassword();
  const userId = newId("usr");
  db.transaction((tx) => {
    tx.insert(s.users).values({ id: userId, email: v.email, name: v.name, passwordHash: hashPassword(password), createdAt: nowIso() }).run();
    tx.insert(s.memberships).values({ userId, workspaceId, role: v.role }).run();
  });
  audit(workspaceId, actorUserId, "MEMBER_INVITED", userId, `${v.email} as ${v.role}`, db);
  return { userId, email: v.email, temporaryPassword: password };
}

export function changeRole(workspaceId: string, actorUserId: string, userId: string, role: Role, db: DB = getDb()) {
  const r = Role.parse(role);
  const m = membership(workspaceId, userId, db);
  if (!m) throw new MemberError("Not a member of this workspace", 404);
  if (m.role === r) return { changed: false };
  if (m.role === "OWNER" && r !== "OWNER" && ownerCount(workspaceId, db) <= 1) throw new MemberError("The workspace must keep at least one owner", 409);
  db.update(s.memberships).set({ role: r }).where(and(eq(s.memberships.workspaceId, workspaceId), eq(s.memberships.userId, userId))).run();
  audit(workspaceId, actorUserId, "MEMBER_ROLE_CHANGED", userId, `${m.role} → ${r}`, db);
  return { changed: true };
}

export function removeMember(workspaceId: string, actorUserId: string, userId: string, db: DB = getDb()) {
  const m = membership(workspaceId, userId, db);
  if (!m) throw new MemberError("Not a member of this workspace", 404);
  if (m.role === "OWNER" && ownerCount(workspaceId, db) <= 1) throw new MemberError("The last owner cannot be removed", 409);
  const user = db.select().from(s.users).where(eq(s.users.id, userId)).get();
  db.transaction((tx) => {
    tx.delete(s.sessions).where(and(eq(s.sessions.userId, userId), eq(s.sessions.workspaceId, workspaceId))).run();
    tx.delete(s.memberships).where(and(eq(s.memberships.workspaceId, workspaceId), eq(s.memberships.userId, userId))).run();
    // Accounts without any workspace are removed so the email can be invited again.
    const other = tx.select({ w: s.memberships.workspaceId }).from(s.memberships).where(eq(s.memberships.userId, userId)).get();
    if (!other) tx.delete(s.users).where(eq(s.users.id, userId)).run();
  });
  audit(workspaceId, actorUserId, "MEMBER_REMOVED", userId, user ? `${user.email} (${m.role})` : m.role, db);
}

/** Issue a new one-time temporary password and sign the member out everywhere. */
export function resetPassword(workspaceId: string, actorUserId: string, userId: string, db: DB = getDb()) {
  if (!membership(workspaceId, userId, db)) throw new MemberError("Not a member of this workspace", 404);
  const password = temporaryPassword();
  db.transaction((tx) => {
    tx.update(s.users).set({ passwordHash: hashPassword(password) }).where(eq(s.users.id, userId)).run();
    tx.delete(s.sessions).where(eq(s.sessions.userId, userId)).run();
  });
  audit(workspaceId, actorUserId, "MEMBER_PASSWORD_RESET", userId, undefined, db);
  return { temporaryPassword: password };
}

export const PasswordChange = z.object({ current: z.string().min(1), next: z.string().min(10, "Use at least 10 characters").max(200) });

/** Self-service password change (replaces a temporary password). Other sessions are signed out. */
export function changeOwnPassword(workspaceId: string, userId: string, currentSessionId: string | null, input: z.input<typeof PasswordChange>, db: DB = getDb()) {
  const v = PasswordChange.parse(input);
  const user = db.select().from(s.users).where(eq(s.users.id, userId)).get();
  if (!user || !verifyPassword(v.current, user.passwordHash)) throw new MemberError("Current password is incorrect", 403);
  db.transaction((tx) => {
    tx.update(s.users).set({ passwordHash: hashPassword(v.next) }).where(eq(s.users.id, userId)).run();
    const others = tx.select({ id: s.sessions.id }).from(s.sessions).where(eq(s.sessions.userId, userId)).all();
    for (const o of others) if (o.id !== currentSessionId) tx.delete(s.sessions).where(eq(s.sessions.id, o.id)).run();
  });
  audit(workspaceId, userId, "PASSWORD_CHANGED", userId, undefined, db);
}

/* ------------------------------ Audit log ------------------------------ */

export interface AuditFilter {
  action?: string | null;
  userId?: string | null;
  q?: string | null;
  limit?: number;
}

export function listAudit(workspaceId: string, f: AuditFilter = {}, db: DB = getDb()) {
  const conds = [eq(s.auditLog.workspaceId, workspaceId)];
  if (f.action) conds.push(eq(s.auditLog.action, f.action));
  if (f.userId) conds.push(f.userId === "system" ? sql`${s.auditLog.userId} is null` : eq(s.auditLog.userId, f.userId));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(like(s.auditLog.target, q), like(s.auditLog.detail, q), like(s.auditLog.action, q))!);
  }
  return db
    .select({
      id: s.auditLog.id,
      action: s.auditLog.action,
      target: s.auditLog.target,
      detail: s.auditLog.detail,
      createdAt: s.auditLog.createdAt,
      userId: s.auditLog.userId,
      userName: s.users.name,
      userEmail: s.users.email,
    })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
    .where(and(...conds))
    .orderBy(desc(s.auditLog.createdAt))
    .limit(Math.min(f.limit ?? 200, 1000))
    .all();
}

export function auditActions(workspaceId: string, db: DB = getDb()): string[] {
  return db
    .selectDistinct({ a: s.auditLog.action })
    .from(s.auditLog)
    .where(eq(s.auditLog.workspaceId, workspaceId))
    .orderBy(s.auditLog.action)
    .all()
    .map((r) => r.a);
}
