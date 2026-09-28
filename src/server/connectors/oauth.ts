/**
 * OAuth state, token storage and refresh for the meeting connectors.
 *
 *  - State: 256-bit random, stored as sha256 with the PKCE verifier (encrypted),
 *    the exact redirect URI and a sanitized return path; single-use, expires
 *    after 10 minutes, and bound to the workspace, user and browser session
 *    that started the flow (a callback from another session is rejected: CSRF /
 *    login-CSRF protection).
 *  - Tokens: AES-256-GCM (src/server/crypto.ts), one row per workspace+user+
 *    provider. The plaintext carries the row binding, so a ciphertext copied to
 *    another row does not decrypt into a usable token. Never logged, never
 *    returned to the browser (ConnectionView is the only outward shape).
 *  - Refresh: proactive when the access token expires within 60 s, and on any
 *    upstream 401 (refresh → retry once). Refreshes are single-flight per
 *    connection because Zoom rotates refresh tokens. A rejected refresh marks
 *    the connection NEEDS_REAUTH (the UI prompts to reconnect).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import { getDb, schema as s, type DB } from "@/db/client";
import { decrypt, encrypt } from "@/server/crypto";
import { newId, nowIso } from "@/server/ids";
import { audit } from "@/server/repo";
import type { SessionContext } from "@/server/auth";
import { IntegrationError, UpstreamUnauthorized } from "./http";
import { connectorConfig, redirectUriFor, SPECS, type ConnectionView, type ConnectorId } from "./meeting-connectors";
import { GOOGLE_SCOPES, PROVIDERS } from "./providers";

export const STATE_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_RETURN = "/settings?tab=integrations";

export type ConnectionRow = typeof s.integrationConnections.$inferSelect;

/** The signed-in user acting on their own connection. `sessionId` is the (unsigned) server session id. */
export interface Actor {
  workspaceId: string;
  userId: string;
  role: SessionContext["role"];
  sessionId: string;
}

const sha256 = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
export const sessionHash = (sessionId: string) => sha256(`conviction/oauth-session/${sessionId}`);

/** Connecting an account is for roles that can add meetings. */
export function canConnect(role: SessionContext["role"]) {
  return role !== "VIEWER";
}

/** Only same-origin relative paths; anything else falls back to Settings (open-redirect guard). */
export function safeReturnTo(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v || v.length > 300 || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\u0000-\u001f\\]/.test(v)) return DEFAULT_RETURN;
  try {
    const u = new URL(v, "http://x.invalid");
    return u.origin === "http://x.invalid" ? `${u.pathname}${u.search}` : DEFAULT_RETURN;
  } catch {
    return DEFAULT_RETURN;
  }
}

/* ------------------------------ Authorization ------------------------------ */

export function beginAuthorization(provider: ConnectorId, actor: Actor, v: { origin: string | null; returnTo?: string | null }, db: DB = getDb()): { url: string } {
  const cfg = connectorConfig(provider);
  const spec = SPECS[provider];
  if (!cfg) throw new IntegrationError("NOT_CONFIGURED", `${spec.name} is not configured on this server (${spec.env.clientId} / ${spec.env.clientSecret}).`);
  if (!canConnect(actor.role)) throw new IntegrationError("FORBIDDEN", "Your role is read-only; a partner or analyst can connect a meeting account.");
  const redirectUri = redirectUriFor(provider, v.origin);
  if (!redirectUri) throw new IntegrationError("INVALID", "Cannot determine this app's public URL for the OAuth redirect. Set APP_URL.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url"); // 64 chars (RFC 7636: 43–128)
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const now = Date.now();
  db.transaction((tx) => {
    tx.delete(s.integrationOauthStates).where(lt(s.integrationOauthStates.expiresAt, new Date(now).toISOString())).run();
    // At most 5 pending authorizations per user and provider (several tabs), oldest dropped.
    const keep = tx
      .select({ id: s.integrationOauthStates.id })
      .from(s.integrationOauthStates)
      .where(and(eq(s.integrationOauthStates.workspaceId, actor.workspaceId), eq(s.integrationOauthStates.userId, actor.userId), eq(s.integrationOauthStates.provider, provider)))
      .orderBy(desc(s.integrationOauthStates.createdAt))
      .limit(4)
      .all()
      .map((r) => r.id);
    tx.delete(s.integrationOauthStates)
      .where(and(eq(s.integrationOauthStates.workspaceId, actor.workspaceId), eq(s.integrationOauthStates.userId, actor.userId), eq(s.integrationOauthStates.provider, provider), notInArray(s.integrationOauthStates.id, keep.length ? keep : ["-"])))
      .run();
    tx.insert(s.integrationOauthStates)
      .values({
        id: sha256(state),
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        provider,
        sessionHash: sessionHash(actor.sessionId),
        verifier: encrypt(Buffer.from(verifier, "utf8")),
        redirectUri,
        returnTo: safeReturnTo(v.returnTo),
        expiresAt: new Date(now + STATE_TTL_MS).toISOString(),
        createdAt: new Date(now).toISOString(),
      })
      .run();
  });
  return { url: PROVIDERS[provider].authorizeUrl(cfg, { redirectUri, state, codeChallenge: challenge }) };
}

export interface CallbackQuery {
  state: string | null;
  code: string | null;
  error: string | null;
}

/**
 * Validate the callback (state known, unused, unexpired, same provider, same
 * workspace + user + session), exchange the code and store the tokens. The
 * state row is consumed before any other check, so it can never be replayed.
 * Returns the sanitized return path recorded at the start.
 */
export async function completeAuthorization(provider: ConnectorId, actor: Actor, q: CallbackQuery, db: DB = getDb()): Promise<{ returnTo: string; connection: ConnectionView }> {
  const name = SPECS[provider].name;
  const reject = (why: string, returnTo = DEFAULT_RETURN): never => {
    audit(actor.workspaceId, actor.userId, "INTEGRATION_CONNECT_REJECTED", actor.userId, `${provider}: ${why}`, db);
    throw Object.assign(new IntegrationError("STATE_INVALID", `${name} connection rejected: ${why}. Start again from Settings → Integrations.`), { returnTo });
  };
  if (!q.state || q.state.length > 200) return reject("missing state parameter");
  const id = sha256(q.state);
  const row = db.select().from(s.integrationOauthStates).where(eq(s.integrationOauthStates.id, id)).get();
  if (row) db.delete(s.integrationOauthStates).where(eq(s.integrationOauthStates.id, id)).run();
  if (!row) return reject("unknown or already used state");
  if (row.provider !== provider) return reject("state issued for another provider");
  if (row.workspaceId !== actor.workspaceId || row.userId !== actor.userId || row.sessionHash !== sessionHash(actor.sessionId)) return reject("the authorization was started from a different session");
  if (Date.parse(row.expiresAt) < Date.now()) return reject("the authorization request expired", row.returnTo);
  if (q.error) {
    audit(actor.workspaceId, actor.userId, "INTEGRATION_CONNECT_DECLINED", actor.userId, `${provider}: ${q.error.slice(0, 80)}`, db);
    throw Object.assign(new IntegrationError("FORBIDDEN", `${name} authorization was not granted (${q.error.slice(0, 80)}).`), { returnTo: row.returnTo });
  }
  if (!q.code || q.code.length > 2048) return reject("missing authorization code", row.returnTo);
  const cfg = connectorConfig(provider);
  if (!cfg) throw new IntegrationError("NOT_CONFIGURED", `${name} is not configured on this server.`);
  const p = PROVIDERS[provider];

  const tokens = await p.exchangeCode(cfg, { code: q.code, redirectUri: row.redirectUri, codeVerifier: decrypt(row.verifier).toString("utf8") });
  const granted = (tokens.scope ?? "").split(/[\s,]+/).filter(Boolean);
  if (provider === "google_meet" && tokens.scope !== null && !granted.includes(GOOGLE_SCOPES.meet)) {
    await p.revoke(cfg, tokens.refreshToken ?? tokens.accessToken);
    audit(actor.workspaceId, actor.userId, "INTEGRATION_CONNECT_DECLINED", actor.userId, `${provider}: Meet scope not granted`, db);
    throw Object.assign(new IntegrationError("FORBIDDEN", "Google Meet access was not granted. Connect again and allow “read information about your Google Meet conferences”."), { returnTo: row.returnTo });
  }
  let account: { id: string | null; email: string | null } = { id: null, email: null };
  try {
    account = await p.account(tokens.accessToken);
  } catch (e) {
    // Missing profile scope must not block the connection; an invalid token must.
    if (e instanceof UpstreamUnauthorized) throw new IntegrationError("UPSTREAM", `${name} rejected the new access token`);
  }
  const now = nowIso();
  const existing = getConnectionRow(provider, actor.workspaceId, actor.userId, db);
  const connId = existing?.id ?? newId("int");
  const values = {
    status: "CONNECTED" as const,
    accountId: account.id,
    accountEmail: account.email,
    scopes: granted.join(" "),
    tokens: sealTokens(connId, actor.workspaceId, actor.userId, provider, { a: tokens.accessToken, r: tokens.refreshToken }),
    accessExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
    refreshedAt: now,
    lastError: null,
    updatedAt: now,
  };
  if (existing) db.update(s.integrationConnections).set(values).where(eq(s.integrationConnections.id, connId)).run();
  else db.insert(s.integrationConnections).values({ id: connId, workspaceId: actor.workspaceId, userId: actor.userId, provider, createdAt: now, ...values }).run();
  audit(actor.workspaceId, actor.userId, "INTEGRATION_CONNECTED", actor.userId, `${provider}${account.email ? ` ${account.email}` : ""} · scopes: ${granted.join(" ") || "n/a"}${tokens.refreshToken ? "" : " · no refresh token"}`, db);
  return { returnTo: row.returnTo, connection: connectionView(getConnectionRow(provider, actor.workspaceId, actor.userId, db)!, db) };
}

/* ------------------------------ Token storage ------------------------------ */

interface Sealed {
  v: 1;
  bind: string;
  a: string;
  r: string | null;
}

const binding = (connId: string, workspaceId: string, userId: string, provider: ConnectorId) => `${connId}|${workspaceId}|${userId}|${provider}`;

function sealTokens(connId: string, workspaceId: string, userId: string, provider: ConnectorId, t: { a: string; r: string | null }): Buffer {
  const body: Sealed = { v: 1, bind: binding(connId, workspaceId, userId, provider), a: t.a, r: t.r };
  return encrypt(Buffer.from(JSON.stringify(body), "utf8"));
}

function openTokens(row: ConnectionRow): { a: string; r: string | null } {
  let body: Sealed;
  try {
    body = JSON.parse(decrypt(row.tokens).toString("utf8")) as Sealed;
  } catch {
    throw new IntegrationError("REAUTH_REQUIRED", `The stored ${SPECS[row.provider].name} authorization cannot be read (encryption key changed?). Reconnect.`);
  }
  if (body.v !== 1 || body.bind !== binding(row.id, row.workspaceId, row.userId, row.provider)) throw new IntegrationError("REAUTH_REQUIRED", `The stored ${SPECS[row.provider].name} authorization does not belong to this connection. Reconnect.`);
  return { a: body.a, r: body.r };
}

export function getConnectionRow(provider: ConnectorId, workspaceId: string, userId: string, db: DB = getDb()): ConnectionRow | undefined {
  return db
    .select()
    .from(s.integrationConnections)
    .where(and(eq(s.integrationConnections.workspaceId, workspaceId), eq(s.integrationConnections.userId, userId), eq(s.integrationConnections.provider, provider)))
    .get();
}

const REQUIRED_SCOPES: Record<ConnectorId, string[][]> = {
  // Any one alternative in each group satisfies it (granular or classic Zoom scopes).
  zoom: [["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_user_recordings:admin", "cloud_recording:read:list_user_recordings:master", "recording:read", "recording:read:admin"]],
  google_meet: [[GOOGLE_SCOPES.meet], [GOOGLE_SCOPES.driveMeet, "https://www.googleapis.com/auth/drive.readonly"]],
};

export function connectionView(row: ConnectionRow, db: DB = getDb()): ConnectionView {
  const scopes = row.scopes.split(/\s+/).filter(Boolean);
  const last = db
    .select()
    .from(s.integrationImports)
    .where(and(eq(s.integrationImports.workspaceId, row.workspaceId), eq(s.integrationImports.userId, row.userId), eq(s.integrationImports.provider, row.provider)))
    .orderBy(desc(s.integrationImports.createdAt))
    .get();
  return {
    status: row.status,
    accountEmail: row.accountEmail,
    connectedAt: row.createdAt,
    scopes,
    missingScopes: scopes.length ? REQUIRED_SCOPES[row.provider].filter((alts) => !alts.some((a) => scopes.includes(a))).map((alts) => alts[0]!) : [],
    lastError: row.lastError,
    lastImport: last ? { title: last.title, at: last.createdAt, companyId: last.companyId, meetingId: last.meetingId } : null,
  };
}

/** The viewer's own connection per provider (for connectorStatuses). */
export function viewerConnections(workspaceId: string, userId: string, db: DB = getDb()) {
  return (id: ConnectorId): ConnectionView | null => {
    const row = getConnectionRow(id, workspaceId, userId, db);
    return row ? connectionView(row, db) : null;
  };
}

function markReauth(row: ConnectionRow, why: string, db: DB) {
  db.update(s.integrationConnections).set({ status: "NEEDS_REAUTH", lastError: why.slice(0, 300), updatedAt: nowIso() }).where(eq(s.integrationConnections.id, row.id)).run();
  audit(row.workspaceId, row.userId, "INTEGRATION_REAUTH_REQUIRED", row.userId, `${row.provider}: ${why.slice(0, 200)}`, db);
}

const inflight = new Map<string, Promise<string>>();

/**
 * Refresh the access token (single-flight per connection). `failedToken` is
 * the token that was rejected or is expiring: if the stored one already
 * differs, another request refreshed it meanwhile and that one is returned.
 */
export function refreshAccessToken(connId: string, failedToken: string | null, db: DB = getDb()): Promise<string> {
  const running = inflight.get(connId);
  if (running) return running;
  const p = (async () => {
    const row = db.select().from(s.integrationConnections).where(eq(s.integrationConnections.id, connId)).get();
    if (!row) throw new IntegrationError("NOT_CONNECTED", "The connection was removed.");
    const name = SPECS[row.provider].name;
    if (row.status === "NEEDS_REAUTH") throw new IntegrationError("REAUTH_REQUIRED", `Reconnect ${name} in Settings → Integrations.`);
    const t = openTokens(row);
    if (failedToken && t.a !== failedToken) return t.a;
    if (!t.r) {
      markReauth(row, "access token expired and no refresh token was issued", db);
      throw new IntegrationError("REAUTH_REQUIRED", `${name} access expired. Reconnect ${name} in Settings → Integrations.`);
    }
    const cfg = connectorConfig(row.provider);
    if (!cfg) throw new IntegrationError("NOT_CONFIGURED", `${name} is not configured on this server.`);
    let next;
    try {
      next = await PROVIDERS[row.provider].refresh(cfg, t.r);
    } catch (e) {
      if (e instanceof IntegrationError && e.code === "REAUTH_REQUIRED") markReauth(row, e.message, db);
      throw e;
    }
    const now = nowIso();
    db.update(s.integrationConnections)
      .set({
        // Zoom rotates the refresh token on every refresh; Google usually returns none (keep the current one).
        tokens: sealTokens(row.id, row.workspaceId, row.userId, row.provider, { a: next.accessToken, r: next.refreshToken ?? t.r }),
        accessExpiresAt: next.expiresIn ? new Date(Date.now() + next.expiresIn * 1000).toISOString() : null,
        scopes: next.scope ? next.scope.split(/[\s,]+/).filter(Boolean).join(" ") : row.scopes,
        refreshedAt: now,
        status: "CONNECTED",
        lastError: null,
        updatedAt: now,
      })
      .where(eq(s.integrationConnections.id, row.id))
      .run();
    return next.accessToken;
  })().finally(() => inflight.delete(connId));
  inflight.set(connId, p);
  return p;
}

/**
 * Run `fn` with the user's own access token: refreshed first when it expires
 * within 60 s; on an upstream 401 → refresh → retry once → NEEDS_REAUTH.
 */
export async function withAccessToken<T>(provider: ConnectorId, owner: { workspaceId: string; userId: string }, fn: (token: string, row: ConnectionRow) => Promise<T>, db: DB = getDb()): Promise<T> {
  const name = SPECS[provider].name;
  const row = getConnectionRow(provider, owner.workspaceId, owner.userId, db);
  if (!row) throw new IntegrationError("NOT_CONNECTED", `Connect your ${name} account in Settings → Integrations first.`);
  if (row.status === "NEEDS_REAUTH") throw new IntegrationError("REAUTH_REQUIRED", `${name} needs to be reconnected (Settings → Integrations).`);
  let token = openTokens(row).a;
  if (row.accessExpiresAt && Date.parse(row.accessExpiresAt) - Date.now() < REFRESH_MARGIN_MS) token = await refreshAccessToken(row.id, token, db);
  try {
    return await fn(token, row);
  } catch (e) {
    if (!(e instanceof UpstreamUnauthorized)) throw e;
  }
  token = await refreshAccessToken(row.id, token, db);
  try {
    return await fn(token, row);
  } catch (e) {
    if (!(e instanceof UpstreamUnauthorized)) throw e;
    const fresh = db.select().from(s.integrationConnections).where(eq(s.integrationConnections.id, row.id)).get();
    if (fresh) markReauth(fresh, `${name} rejected a freshly refreshed token`, db);
    throw new IntegrationError("REAUTH_REQUIRED", `${name} rejected the authorization. Reconnect ${name} in Settings → Integrations.`);
  }
}

/* ------------------------------ Disconnect ------------------------------ */

/**
 * For member removal: capture the member's tokens while the rows still exist and return a
 * function that revokes them at the providers (best effort, audited). Local rows are removed
 * by the database cascade when the membership goes; this makes sure the grant is also
 * withdrawn at Zoom / Google.
 */
export function prepareRevokeForMember(workspaceId: string, userId: string, db: DB = getDb()): () => Promise<void> {
  const rows = db.select().from(s.integrationConnections).where(and(eq(s.integrationConnections.workspaceId, workspaceId), eq(s.integrationConnections.userId, userId))).all();
  const captured = rows.flatMap((row) => {
    try {
      const t = openTokens(row);
      const provider = row.provider as ConnectorId;
      return [{ provider, token: provider === "google_meet" ? (t.r ?? t.a) : t.a, email: row.accountEmail }];
    } catch {
      return [];
    }
  });
  return async () => {
    for (const c of captured) {
      const cfg = connectorConfig(c.provider);
      let revoked = false;
      try {
        if (cfg) revoked = await PROVIDERS[c.provider].revoke(cfg, c.token);
      } catch {
        revoked = false;
      }
      audit(workspaceId, null, "INTEGRATION_REVOKED_ON_MEMBER_REMOVAL", userId, `${c.provider}${c.email ? ` ${c.email}` : ""} · ${revoked ? "revoked at provider" : "not confirmed revoked at provider"}`, db);
    }
  };
}



/** Revoke at the provider (best effort) and delete the stored tokens and pending states. Audited. */
export async function disconnect(provider: ConnectorId, owner: { workspaceId: string; userId: string }, db: DB = getDb()): Promise<{ removed: boolean; revoked: boolean }> {
  const row = getConnectionRow(provider, owner.workspaceId, owner.userId, db);
  db.delete(s.integrationOauthStates)
    .where(and(eq(s.integrationOauthStates.workspaceId, owner.workspaceId), eq(s.integrationOauthStates.userId, owner.userId), eq(s.integrationOauthStates.provider, provider)))
    .run();
  if (!row) return { removed: false, revoked: false };
  let revoked = false;
  const cfg = connectorConfig(provider);
  try {
    const t = openTokens(row);
    // Google: revoking the refresh token revokes the whole grant. Zoom: revoking the access token removes the app authorization.
    if (cfg) revoked = await PROVIDERS[provider].revoke(cfg, provider === "google_meet" ? (t.r ?? t.a) : t.a);
  } catch {
    revoked = false; // unreadable tokens or provider unreachable: still delete locally
  }
  db.delete(s.integrationConnections).where(eq(s.integrationConnections.id, row.id)).run();
  audit(owner.workspaceId, owner.userId, "INTEGRATION_DISCONNECTED", owner.userId, `${provider}${row.accountEmail ? ` ${row.accountEmail}` : ""} · ${revoked ? "revoked at provider" : "not confirmed revoked at provider (tokens deleted locally)"}`, db);
  return { removed: true, revoked };
}
