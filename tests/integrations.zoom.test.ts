/**
 * Zoom integration against a local mock of the documented Zoom OAuth + Cloud
 * Recording API (scripts/mock-integrations.ts): OAuth URL/state/PKCE, CSRF
 * rejection, token exchange with encrypted storage, refresh on 401 with
 * refresh-token rotation, recording listing, VTT import into the founder-meeting
 * workflow (speakers + timestamps preserved), the audio transcription fallback,
 * rate limits, re-auth, access control, disconnect and the not-configured state.
 * Model calls are mocked; no network beyond 127.0.0.1.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-int-zoom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  for (const k of ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL", "RENDER_EXTERNAL_URL"]) delete process.env[k];
  return dir;
});

vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async () => {
    throw new Error("structured() not stubbed");
  }),
  embed: vi.fn(async () => {
    throw new Error("no network in tests");
  }),
}));
vi.mock("@/brain/indexer", async (orig) => ({
  ...(await orig<typeof import("@/brain/indexer")>()),
  indexCompanyForBrain: vi.fn(async () => ({ chunks: 0, embedded: 0, facts: 0 })),
}));
vi.mock("@/ai/transcribe", async (orig) => ({
  ...(await orig<typeof import("@/ai/transcribe")>()),
  transcribeRecording: vi.fn(async () => ({
    segments: [
      { ref: "T-1", idx: 0, speaker: "A", startSec: 1.5, endSec: 6, text: "This came from the audio file, not a transcript." },
      { ref: "T-2", idx: 1, speaker: "B", startSec: 6.5, endSec: 12, text: "Our churn was one customer in 2025." },
    ],
    model: "gpt-4o-transcribe-diarize",
    diarized: true,
    chunks: 1,
    durationSec: 12,
    costUsd: 0.001,
  })),
}));

import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { structured } from "@/ai/openai";
import { transcribeRecording } from "@/ai/transcribe";
import { getDb, schema } from "@/db/client";
import { decrypt, isEncrypted } from "@/server/crypto";
import * as meetings from "@/server/meetings";
import * as members from "@/server/members";
import { IntegrationError } from "@/server/connectors/http";
import { appOrigin, connectorStatuses } from "@/server/connectors/meeting-connectors";
import { beginAuthorization, completeAuthorization, disconnect, getConnectionRow, safeReturnTo, viewerConnections, withAccessToken } from "@/server/connectors/oauth";
import { importRemoteMeeting, listRemoteMeetings } from "@/server/connectors/import";
import { startMockIntegrations, type MockState } from "../scripts/mock-integrations";
import { actorFor, consent, setupWorkspace, stubStructured } from "./integrations.helpers";

const ORIGIN = "https://conviction.example";
let mock: MockState;

beforeAll(async () => {
  mock = await startMockIntegrations();
  process.env.CONVICTION_INTEGRATIONS_MOCK_URL = mock.url;
});
beforeEach(() => {
  process.env.ZOOM_CLIENT_ID = mock.clients.zoom.id;
  process.env.ZOOM_CLIENT_SECRET = mock.clients.zoom.secret;
  mock.rateLimitNext = { count: 0, retryAfter: 0 };
  stubStructured(vi.mocked(structured) as never);
});
afterAll(async () => {
  await mock.close();
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const code = (e: unknown) => (e instanceof IntegrationError ? e.code : `not an IntegrationError: ${(e as Error)?.message}`);
async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return code(e);
  }
}

async function connect(ctx: ReturnType<typeof setupWorkspace>) {
  const actor = actorFor(ctx);
  const { url } = beginAuthorization("zoom", actor, { origin: ORIGIN, returnTo: `/deals/${ctx.company.slug}/meetings` });
  const cb = await consent(url);
  const done = await completeAuthorization("zoom", actor, { state: cb.state, code: cb.code, error: null });
  return { actor, done };
}

const audits = (workspaceId: string, action: string) => getDb().select().from(schema.auditLog).where(and(eq(schema.auditLog.workspaceId, workspaceId), eq(schema.auditLog.action, action))).all();
const sealed = (row: { tokens: Buffer }) => JSON.parse(decrypt(row.tokens).toString("utf8")) as { a: string; r: string | null; bind: string };

describe("Zoom OAuth", () => {
  it("builds the authorization URL with PKCE S256 and a 256-bit state bound to the session", () => {
    const ctx = setupWorkspace();
    const { url } = beginAuthorization("zoom", actorFor(ctx), { origin: ORIGIN, returnTo: "/deals/acme-ai/meetings" });
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`${mock.url}/zoom/oauth/authorize`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(mock.clients.zoom.id);
    expect(u.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/zoom/callback`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The state is stored hashed, never in clear, and the client secret never appears in the URL.
    const rows = getDb().select().from(schema.integrationOauthStates).where(eq(schema.integrationOauthStates.userId, ctx.userId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(u.searchParams.get("state"));
    expect(isEncrypted(rows[0]!.verifier)).toBe(true);
    expect(url).not.toContain(mock.clients.zoom.secret);
  });

  it("exchanges the code, stores tokens encrypted per workspace+user and never exposes them", async () => {
    const ctx = setupWorkspace();
    const { done } = await connect(ctx);
    expect(done.returnTo).toBe(`/deals/${ctx.company.slug}/meetings`);
    expect(done.connection).toMatchObject({ status: "CONNECTED", accountEmail: "gp@fund.example", missingScopes: [] });
    const row = getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!;
    expect(isEncrypted(row.tokens)).toBe(true);
    const t = sealed(row);
    expect(mock.access.get(t.a)).toBe("zoom");
    expect(mock.refresh.get(t.r!)).toBe("zoom");
    expect(row.tokens.toString("latin1")).not.toContain(t.a);
    expect(t.bind).toBe(`${row.id}|${ctx.workspaceId}|${ctx.userId}|zoom`);
    const outward = JSON.stringify([done, connectorStatuses(process.env, { origin: ORIGIN, connection: viewerConnections(ctx.workspaceId, ctx.userId) })]);
    expect(outward).not.toContain(t.a);
    expect(outward).not.toContain(t.r!);
    expect(outward).not.toContain(mock.clients.zoom.secret);
    expect(audits(ctx.workspaceId, "INTEGRATION_CONNECTED")).toHaveLength(1);
    // The state is single-use: replaying the same callback fails.
    expect(getDb().select().from(schema.integrationOauthStates).where(eq(schema.integrationOauthStates.userId, ctx.userId)).all()).toHaveLength(0);
  });

  it("rejects CSRF: another session, another user, a forged, replayed or expired state", async () => {
    const ctx = setupWorkspace();
    const actor = actorFor(ctx);
    // Same user, different browser session (e.g. a link planted by an attacker).
    let { url } = beginAuthorization("zoom", actor, { origin: ORIGIN });
    let cb = await consent(url);
    expect(await codeOf(completeAuthorization("zoom", actorFor(ctx), { state: cb.state, code: cb.code, error: null }))).toBe("STATE_INVALID");
    // …and the state was consumed by that attempt: the legitimate session cannot replay it either.
    expect(await codeOf(completeAuthorization("zoom", actor, { state: cb.state, code: cb.code, error: null }))).toBe("STATE_INVALID");
    // Another user of another workspace presenting a victim's state.
    ({ url } = beginAuthorization("zoom", actor, { origin: ORIGIN }));
    cb = await consent(url);
    const other = setupWorkspace();
    expect(await codeOf(completeAuthorization("zoom", actorFor(other), { state: cb.state, code: cb.code, error: null }))).toBe("STATE_INVALID");
    // Forged / missing state.
    expect(await codeOf(completeAuthorization("zoom", actor, { state: "forged-state-value", code: "x", error: null }))).toBe("STATE_INVALID");
    expect(await codeOf(completeAuthorization("zoom", actor, { state: null, code: "x", error: null }))).toBe("STATE_INVALID");
    // State issued for Google presented to the Zoom callback.
    process.env.GOOGLE_CLIENT_ID = "g";
    process.env.GOOGLE_CLIENT_SECRET = "s";
    const g = new URL(beginAuthorization("google_meet", actor, { origin: ORIGIN }).url).searchParams.get("state")!;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(await codeOf(completeAuthorization("zoom", actor, { state: g, code: "x", error: null }))).toBe("STATE_INVALID");
    // Expired (10-minute TTL).
    ({ url } = beginAuthorization("zoom", actor, { origin: ORIGIN }));
    cb = await consent(url);
    getDb().update(schema.integrationOauthStates).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(schema.integrationOauthStates.userId, ctx.userId)).run();
    expect(await codeOf(completeAuthorization("zoom", actor, { state: cb.state, code: cb.code, error: null }))).toBe("STATE_INVALID");
    expect(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)).toBeUndefined();
    expect(audits(ctx.workspaceId, "INTEGRATION_CONNECT_REJECTED").length).toBeGreaterThanOrEqual(4);
  });

  it("a declined consent is reported and audited, nothing is stored", async () => {
    const ctx = setupWorkspace();
    const actor = actorFor(ctx);
    const state = new URL(beginAuthorization("zoom", actor, { origin: ORIGIN }).url).searchParams.get("state");
    expect(await codeOf(completeAuthorization("zoom", actor, { state, code: null, error: "access_denied" }))).toBe("FORBIDDEN");
    expect(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)).toBeUndefined();
    expect(audits(ctx.workspaceId, "INTEGRATION_CONNECT_DECLINED")).toHaveLength(1);
  });

  it("return paths and redirect origins are validated", () => {
    expect(safeReturnTo("/deals/acme/meetings?x=1")).toBe("/deals/acme/meetings?x=1");
    for (const bad of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/%0d%0aLocation:x".replace("%0d%0a", "\r\n")]) expect(safeReturnTo(bad)).toBe("/settings?tab=integrations");
    expect(appOrigin(new Headers({ host: "evil.example/../x" }), {})).toBeNull();
    expect(appOrigin(new Headers({ host: "localhost:3000" }), {})).toBe("http://localhost:3000");
    expect(appOrigin(new Headers({ "x-forwarded-host": "app.fund.example", "x-forwarded-proto": "https", host: "10.0.0.1:10000" }), {})).toBe("https://app.fund.example");
    expect(appOrigin(new Headers({ host: "whatever" }), { APP_URL: "https://conviction.fund.example/some/path" })).toBe("https://conviction.fund.example");
  });
});

describe("Zoom recordings and import", () => {
  it("lists cloud recordings with transcript and audio items; only the connecting user's token is used", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const list = await listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" });
    expect(list.map((m) => m.title)).toEqual(["Long board prep", "Acme AI — follow-up (no transcript)", "Acme AI — partner call"]);
    const call = list.find((m) => m.title === "Acme AI — partner call")!;
    expect(call).toMatchObject({ externalId: "aDYlohsHRtCd4ii1uC2+hA==", localDate: "2026-09-20", durationSec: 42 * 60 });
    expect(call.items.map((i) => [i.kind, i.id, i.importable])).toEqual([
      ["TRANSCRIPT", "f-vtt-1", true],
      ["AUDIO", "f-mp4-1", true],
    ]);
    const followUp = list.find((m) => m.externalId === "/ajXp112QmuoKj4854875==")!;
    expect(followUp.items).toMatchObject([{ kind: "AUDIO", id: "f-m4a-2", importable: true }]);
    expect(followUp.localDate).toBe("2026-09-22");
    const big = list.find((m) => m.title === "Long board prep")!;
    expect(big.items[0]).toMatchObject({ kind: "AUDIO", importable: false });
    expect(big.items[0]!.note).toMatch(/cannot be transcribed in one request/);
    // The listing request carried this user's bearer token.
    const t = sealed(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!);
    expect(mock.requests.filter((r) => r.path === "/zoom/v2/users/me/recordings").at(-1)!.auth).toBe(`Bearer ${t.a}`);
    // Another member of the same workspace cannot use it.
    const colleague = members.inviteMember(ctx.workspaceId, ctx.userId, { email: `analyst-${Math.random()}@fund.example`, name: "Analyst", role: "ANALYST" });
    expect(await codeOf(listRemoteMeetings("zoom", actorFor({ workspaceId: ctx.workspaceId, userId: colleague.userId }, "ANALYST"), { from: "2026-09-15", to: "2026-09-30" }))).toBe("NOT_CONNECTED");
    // Range validation (Zoom: one month per request).
    expect(await codeOf(listRemoteMeetings("zoom", actor, { from: "2026-07-01", to: "2026-09-30" }))).toBe("INVALID");
    expect(audits(ctx.workspaceId, "INTEGRATION_RECORDINGS_LISTED").length).toBeGreaterThanOrEqual(1);
  });

  it("imports the VTT transcript into the meetings workflow with speakers and timestamps preserved", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const r = await importRemoteMeeting("zoom", actor, { companyId: ctx.company.id, externalId: "aDYlohsHRtCd4ii1uC2+hA==", itemId: "f-vtt-1", startTime: "2026-09-20T15:00:00Z" });
    expect(r.kind).toBe("TRANSCRIPT");
    await r.promise;
    const m = meetings.getMeeting(ctx.company.id, r.meetingId)!;
    expect(m).toMatchObject({ source: "ZOOM", title: "Acme AI — partner call", heldAt: "2026-09-20", status: "READY" });
    expect(m.transcriptDocumentId).toBeTruthy();
    expect(m.recordingDocumentId).toBeNull();
    const segs = meetings.getSegments(m.id);
    expect(segs.map((s) => [s.speaker, s.startSec, s.endSec])).toEqual([
      ["Sam Ortiz", 5.12, 11.4],
      ["Maya Chen", 12, 24.3], // two consecutive Maya cues merged, as for an uploaded .vtt
      ["Sam Ortiz", 63, 68.5],
      ["Maya Chen", 69, 78.25],
    ]);
    expect(segs[1]!.text).toBe("The eighteen thousand dollar CAC in the deck excludes founder time and sales engineering.\nFully loaded it is closer to twenty-six thousand.");
    expect(vi.mocked(transcribeRecording)).not.toHaveBeenCalled();
    const imp = getDb().select().from(schema.integrationImports).where(eq(schema.integrationImports.meetingId, m.id)).get();
    expect(imp).toMatchObject({ provider: "zoom", kind: "TRANSCRIPT", externalId: "aDYlohsHRtCd4ii1uC2+hA==", itemId: "f-vtt-1", userId: ctx.userId });
    expect(audits(ctx.workspaceId, "INTEGRATION_IMPORT")[0]!.detail).toMatch(/Zoom: VTT transcript/);
    expect(audits(ctx.workspaceId, "FOUNDER_MEETING_ADDED")[0]!.detail).toContain("(ZOOM)");
    // The listing now marks the meeting as imported, and Settings shows the last import.
    const again = await listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" });
    expect(again.find((x) => x.externalId === "aDYlohsHRtCd4ii1uC2+hA==")!.imported).toMatchObject([{ companyId: ctx.company.id, companyName: "Acme AI", meetingId: m.id }]);
    expect(viewerConnections(ctx.workspaceId, ctx.userId)("zoom")!.lastImport).toMatchObject({ title: "Acme AI — partner call", meetingId: m.id });
  });

  it("falls back to the audio file through the transcription path when there is no transcript", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    vi.mocked(transcribeRecording).mockClear();
    const r = await importRemoteMeeting("zoom", actor, { companyId: ctx.company.id, externalId: "/ajXp112QmuoKj4854875==", itemId: "f-m4a-2", startTime: "2026-09-22T09:30:00Z", title: "Follow-up with Maya" });
    expect(r.kind).toBe("AUDIO");
    expect(meetings.getMeeting(ctx.company.id, r.meetingId)!.status).toBe("TRANSCRIBING");
    await r.promise;
    expect(vi.mocked(transcribeRecording)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(transcribeRecording).mock.calls[0]![0];
    expect(arg.filename).toMatch(/^zoom-.*-2026-09-22\.m4a$/);
    expect(arg.mime).toBe("audio/mp4");
    expect(arg.data.length).toBe(64 * 1024);
    const m = meetings.getMeeting(ctx.company.id, r.meetingId)!;
    expect(m).toMatchObject({ source: "ZOOM", title: "Follow-up with Maya", heldAt: "2026-09-22", status: "READY" });
    expect(m.recordingDocumentId).toBeTruthy();
    expect(m.transcription).toMatchObject({ diarized: true });
    expect(meetings.getSegments(m.id).map((s) => s.speaker)).toEqual(["A", "B"]);
    // An M4A too large for one transcription request is refused before any download.
    const before = mock.requests.length;
    expect(await codeOf(importRemoteMeeting("zoom", actor, { companyId: ctx.company.id, externalId: "big+audio==", itemId: "f-m4a-3", startTime: "2026-09-23T09:30:00Z" }))).toBe("TOO_LARGE");
    expect(mock.requests.slice(before).some((q) => q.path.startsWith("/zoom/rec/download"))).toBe(false);
  });

  it("refreshes on 401 (refresh token rotates) and proactively before expiry", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const t0 = sealed(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!);
    const n0 = mock.counters.zoomRefresh;
    mock.expireAccessTokens(); // Zoom now answers 401 to the stored access token
    await listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" });
    expect(mock.counters.zoomRefresh).toBe(n0 + 1);
    const t1 = sealed(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!);
    expect(t1.a).not.toBe(t0.a);
    expect(t1.r).not.toBe(t0.r); // rotated and stored
    expect(mock.refresh.has(t0.r!)).toBe(false);
    // Concurrent 401s refresh once (single-flight) — a second refresh with a rotated token would fail.
    mock.expireAccessTokens();
    await Promise.all([listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" }), listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" })]);
    expect(mock.counters.zoomRefresh).toBe(n0 + 2);
    // Proactive: the access token expires within 60 s → refresh before the call.
    getDb().update(schema.integrationConnections).set({ accessExpiresAt: new Date(Date.now() + 10_000).toISOString() }).where(eq(schema.integrationConnections.userId, ctx.userId)).run();
    await withAccessToken("zoom", actor, async () => null);
    expect(mock.counters.zoomRefresh).toBe(n0 + 3);
    expect(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!.status).toBe("CONNECTED");
  });

  it("a rejected refresh marks the connection NEEDS_REAUTH and prompts to reconnect", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    mock.expireAccessTokens();
    mock.refresh.clear(); // the user removed the app in Zoom
    expect(await codeOf(listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" }))).toBe("REAUTH_REQUIRED");
    const view = viewerConnections(ctx.workspaceId, ctx.userId)("zoom")!;
    expect(view.status).toBe("NEEDS_REAUTH");
    const st = connectorStatuses(process.env, { origin: ORIGIN, connection: viewerConnections(ctx.workspaceId, ctx.userId) })[0]!;
    expect(st).toMatchObject({ importEnabled: false });
    expect(st.detail).toMatch(/Reconnect/);
    expect(audits(ctx.workspaceId, "INTEGRATION_REAUTH_REQUIRED")).toHaveLength(1);
    // Reconnecting restores it.
    await connect(ctx);
    expect(viewerConnections(ctx.workspaceId, ctx.userId)("zoom")!.status).toBe("CONNECTED");
  });

  it("handles rate limits: a short Retry-After is retried, a long one is surfaced", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    mock.rateLimitNext = { count: 1, retryAfter: 0 };
    expect(await listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" })).toHaveLength(3);
    mock.rateLimitNext = { count: 2, retryAfter: 90 };
    try {
      await listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IntegrationError);
      expect((e as IntegrationError).code).toBe("RATE_LIMITED");
      expect((e as IntegrationError).retryAfterSec).toBe(90);
      expect((e as IntegrationError).status).toBe(429);
    }
  });

  it("respects roles: viewers cannot connect, list or import", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const viewer = { ...actor, role: "VIEWER" as const };
    expect(await codeOf(Promise.resolve().then(() => beginAuthorization("zoom", viewer, { origin: ORIGIN })))).toBe("FORBIDDEN");
    expect(await codeOf(listRemoteMeetings("zoom", viewer, { from: "2026-09-15", to: "2026-09-30" }))).toBe("FORBIDDEN");
    expect(await codeOf(importRemoteMeeting("zoom", viewer, { companyId: ctx.company.id, externalId: "x", itemId: "y" }))).toBe("FORBIDDEN");
    // A company of another workspace is not found before anything is downloaded.
    const other = setupWorkspace();
    expect(await codeOf(importRemoteMeeting("zoom", actor, { companyId: other.company.id, externalId: "aDYlohsHRtCd4ii1uC2+hA==", itemId: "f-vtt-1" }))).toBe("NOT_FOUND");
  });

  it("disconnect revokes at Zoom and deletes the tokens; removing the member deletes them too", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const t = sealed(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)!);
    expect(await disconnect("zoom", actor)).toEqual({ removed: true, revoked: true });
    expect(mock.revoked).toContain(t.a);
    expect(getConnectionRow("zoom", ctx.workspaceId, ctx.userId)).toBeUndefined();
    expect(audits(ctx.workspaceId, "INTEGRATION_DISCONNECTED")[0]!.detail).toMatch(/revoked at provider/);
    expect(await codeOf(listRemoteMeetings("zoom", actor, { from: "2026-09-15", to: "2026-09-30" }))).toBe("NOT_CONNECTED");
    // Member removal cascades to their connection (composite FK → memberships).
    const colleague = members.inviteMember(ctx.workspaceId, ctx.userId, { email: `analyst-${Math.random()}@fund.example`, name: "Analyst", role: "ANALYST" });
    await connect({ ...ctx, userId: colleague.userId });
    expect(getConnectionRow("zoom", ctx.workspaceId, colleague.userId)).toBeTruthy();
    const ct = sealed(getConnectionRow("zoom", ctx.workspaceId, colleague.userId)!);
    members.removeMember(ctx.workspaceId, ctx.userId, colleague.userId);
    expect(getConnectionRow("zoom", ctx.workspaceId, colleague.userId)).toBeUndefined();
    // …and the grant is withdrawn at Zoom too (best effort, audited).
    await vi.waitFor(() => expect(mock.revoked).toContain(ct.a));
    await vi.waitFor(() => expect(audits(ctx.workspaceId, "INTEGRATION_REVOKED_ON_MEMBER_REMOVAL")[0]!.detail).toMatch(/revoked at provider/));
  });

  it("not configured: status explains setup, connect is refused, the workflow needs nothing", async () => {
    delete process.env.ZOOM_CLIENT_ID;
    delete process.env.ZOOM_CLIENT_SECRET;
    const ctx = setupWorkspace();
    const st = connectorStatuses(process.env, { origin: ORIGIN, connection: viewerConnections(ctx.workspaceId, ctx.userId) })[0]!;
    expect(st).toMatchObject({ id: "zoom", state: "NOT_CONFIGURED", importEnabled: false, connection: null, redirectUri: `${ORIGIN}/api/integrations/zoom/callback` });
    expect(st.detail).toMatch(/ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET/);
    expect(st.setup.join("\n")).toContain(`${ORIGIN}/api/integrations/zoom/callback`);
    expect(st.scopes.map((s) => s.scope)).toEqual(["cloud_recording:read:list_user_recordings", "user:read:user"]);
    expect(await codeOf(Promise.resolve().then(() => beginAuthorization("zoom", actorFor(ctx), { origin: ORIGIN })))).toBe("NOT_CONFIGURED");
    // Configured but not connected.
    process.env.ZOOM_CLIENT_ID = "id";
    process.env.ZOOM_CLIENT_SECRET = "secret";
    expect(connectorStatuses(process.env, { origin: ORIGIN, connection: viewerConnections(ctx.workspaceId, ctx.userId) })[0]).toMatchObject({ state: "CONFIGURED", importEnabled: false, connection: null });
    expect(await codeOf(listRemoteMeetings("zoom", actorFor(ctx), { from: "2026-09-15", to: "2026-09-30" }))).toBe("NOT_CONNECTED");
  });
});
