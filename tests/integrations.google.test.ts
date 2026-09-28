/**
 * Google Meet integration against a local mock of the documented Google OAuth,
 * Meet REST API v2 and Drive export endpoints (scripts/mock-integrations.ts):
 * OAuth URL (minimal scopes, offline access, PKCE, state), CSRF rejection,
 * granted-scope checks, encrypted token storage, refresh on 401 (Google keeps
 * the refresh token), conference record listing, transcript entries →
 * meeting segments (participant display names, timestamps), pagination, the
 * Drive Doc export fallback, disconnect and the not-configured state.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-int-google-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { structured } from "@/ai/openai";
import { getDb, schema } from "@/db/client";
import { decrypt, isEncrypted } from "@/server/crypto";
import * as meetings from "@/server/meetings";
import { parseTranscript } from "@/ingestion/transcript";
import { IntegrationError } from "@/server/connectors/http";
import { connectorStatuses } from "@/server/connectors/meeting-connectors";
import { beginAuthorization, completeAuthorization, disconnect, getConnectionRow, viewerConnections } from "@/server/connectors/oauth";
import { importRemoteMeeting, listRemoteMeetings } from "@/server/connectors/import";
import { entriesToVtt, mapEntries, normalizeDocTranscript } from "@/server/connectors/google-meet";
import { startMockIntegrations, type MockState } from "../scripts/mock-integrations";
import { actorFor, consent, setupWorkspace, stubStructured } from "./integrations.helpers";

const ORIGIN = "https://conviction.example";
const MEET = "https://www.googleapis.com/auth/meetings.space.readonly";
const DRIVE_MEET = "https://www.googleapis.com/auth/drive.meet.readonly";
const REC = "conferenceRecords/rec-abc123";
const TR = `${REC}/transcripts/tr-1`;
const OLD = "conferenceRecords/rec-old999";
let mock: MockState;
/** The mock's Meet dates are relative to today (7 and 120 days ago), like real retention windows. */
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const RECENT = { from: daysAgo(20), to: daysAgo(0) };
const OLDRANGE = { from: daysAgo(130), to: daysAgo(110) };

beforeAll(async () => {
  mock = await startMockIntegrations();
  process.env.CONVICTION_INTEGRATIONS_MOCK_URL = mock.url;
});
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = mock.clients.google.id;
  process.env.GOOGLE_CLIENT_SECRET = mock.clients.google.secret;
  mock.google.grantedScopes = null;
  stubStructured(vi.mocked(structured) as never);
});
afterAll(async () => {
  await mock.close();
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof IntegrationError ? e.code : `not an IntegrationError: ${(e as Error)?.message}`;
  }
}

async function connect(ctx: ReturnType<typeof setupWorkspace>) {
  const actor = actorFor(ctx);
  const cb = await consent(beginAuthorization("google_meet", actor, { origin: ORIGIN, returnTo: `/deals/${ctx.company.slug}/meetings` }).url);
  const done = await completeAuthorization("google_meet", actor, { state: cb.state, code: cb.code, error: null });
  return { actor, done };
}

const sealed = (row: { tokens: Buffer }) => JSON.parse(decrypt(row.tokens).toString("utf8")) as { a: string; r: string | null };
const audits = (workspaceId: string, action: string) => getDb().select().from(schema.auditLog).where(and(eq(schema.auditLog.workspaceId, workspaceId), eq(schema.auditLog.action, action))).all();

describe("Google OAuth", () => {
  it("requests only the Meet + Meet-files Drive scopes, offline access, PKCE and state", () => {
    const ctx = setupWorkspace();
    const u = new URL(beginAuthorization("google_meet", actorFor(ctx), { origin: ORIGIN }).url);
    expect(`${u.origin}${u.pathname}`).toBe(`${mock.url}/google/o/oauth2/v2/auth`);
    expect(u.searchParams.get("scope")!.split(" ")).toEqual(["openid", "email", MEET, DRIVE_MEET]);
    expect(u.searchParams.get("scope")).not.toContain("drive.readonly");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/google_meet/callback`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("exchanges the code (client secret + PKCE verifier) and stores the tokens encrypted", async () => {
    const ctx = setupWorkspace();
    const { done } = await connect(ctx);
    expect(done.connection).toMatchObject({ status: "CONNECTED", accountEmail: "gp@fund.example", missingScopes: [] });
    const row = getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)!;
    expect(isEncrypted(row.tokens)).toBe(true);
    const t = sealed(row);
    expect(mock.access.get(t.a)).toBe("google");
    expect(mock.refresh.get(t.r!)).toBe("google");
    expect(row.scopes.split(" ")).toEqual(expect.arrayContaining([MEET, DRIVE_MEET]));
    expect(JSON.stringify(connectorStatuses(process.env, { origin: ORIGIN, connection: viewerConnections(ctx.workspaceId, ctx.userId) }))).not.toContain(t.a);
  });

  it("rejects a callback from another session (CSRF) and a consent without the Meet scope", async () => {
    const ctx = setupWorkspace();
    const actor = actorFor(ctx);
    const cb = await consent(beginAuthorization("google_meet", actor, { origin: ORIGIN }).url);
    expect(await codeOf(completeAuthorization("google_meet", actorFor(ctx), { state: cb.state, code: cb.code, error: null }))).toBe("STATE_INVALID");
    // Granular consent: the user unticked Meet access → nothing stored, grant revoked.
    mock.google.grantedScopes = "openid https://www.googleapis.com/auth/userinfo.email";
    const cb2 = await consent(beginAuthorization("google_meet", actor, { origin: ORIGIN }).url);
    const revokedBefore = mock.revoked.length;
    expect(await codeOf(completeAuthorization("google_meet", actor, { state: cb2.state, code: cb2.code, error: null }))).toBe("FORBIDDEN");
    expect(mock.revoked.length).toBe(revokedBefore + 1);
    expect(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)).toBeUndefined();
    expect(audits(ctx.workspaceId, "INTEGRATION_CONNECT_DECLINED")).toHaveLength(1);
  });

  it("refreshes on 401 and keeps the refresh token Google does not rotate", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const t0 = sealed(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)!);
    const n0 = mock.counters.googleRefresh;
    mock.expireAccessTokens();
    await listRemoteMeetings("google_meet", actor, RECENT);
    expect(mock.counters.googleRefresh).toBe(n0 + 1);
    const t1 = sealed(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)!);
    expect(t1.a).not.toBe(t0.a);
    expect(t1.r).toBe(t0.r);
    // Revoked grant: refresh fails with invalid_grant → reconnect prompt.
    mock.expireAccessTokens();
    mock.refresh.clear();
    expect(await codeOf(listRemoteMeetings("google_meet", actor, RECENT))).toBe("REAUTH_REQUIRED");
    expect(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)!.status).toBe("NEEDS_REAUTH");
  });
});

describe("Meet transcripts", () => {
  it("lists conference records with their transcripts, titled from the transcript Doc", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const sept = await listRemoteMeetings("google_meet", actor, RECENT);
    expect(sept).toHaveLength(1);
    expect(sept[0]).toMatchObject({ externalId: REC, title: "Acme AI partner call", localDate: daysAgo(7), durationSec: 40 * 60 + 30 });
    expect(sept[0]!.items).toMatchObject([{ id: TR, kind: "TRANSCRIPT", importable: true, note: null }]);
    // Older than 30 days: entries are gone, the Doc export is announced.
    const june = await listRemoteMeetings("google_meet", actor, OLDRANGE);
    expect(june[0]!.items[0]).toMatchObject({ importable: true });
    expect(june[0]!.items[0]!.note).toMatch(/exported via Drive/);
  });

  it("maps transcript entries to meeting segments: participant names, timestamps, verbatim text", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const r = await importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId: REC, itemId: TR });
    expect(r.kind).toBe("TRANSCRIPT_ENTRIES");
    await r.promise;
    const m = meetings.getMeeting(ctx.company.id, r.meetingId)!;
    expect(m).toMatchObject({ source: "GOOGLE_MEET", title: "Acme AI partner call", heldAt: daysAgo(7), status: "READY" });
    const segs = meetings.getSegments(m.id);
    expect(segs.map((s) => [s.speaker, s.startSec, s.endSec, s.text])).toEqual([
      ["Sam Ortiz", 5, 11, "Walk me through how you calculate CAC today."],
      ["Maya Chen", 12, 19.5, "The eighteen thousand dollar CAC in the deck excludes founder time and sales engineering."],
      ["guest analyst", 40, 44, "Quick question from me: is churn in there?"],
      ["Maya Chen", 45, 52, "We did lose one customer in 2025, Northwind, after their acquisition."],
      ["+1 415-***-**12", 70, 75.25, "Gross margin is 76% as in the deck."],
      ["Participant 1", 76, 80, "And hosting is on our own AWS account."],
    ]);
    expect(getDb().select().from(schema.integrationImports).where(eq(schema.integrationImports.meetingId, m.id)).get()).toMatchObject({ provider: "google_meet", kind: "TRANSCRIPT_ENTRIES", externalId: REC, itemId: TR });
    expect(audits(ctx.workspaceId, "INTEGRATION_IMPORT")[0]!.detail).toMatch(/6 transcript entries, 5 speaker/);
  });

  it("pages through long transcripts (100 entries per page)", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const saved = mock.google.entries[TR]!;
    const base = Date.parse(`${daysAgo(7)}T14:00:00Z`);
    mock.google.entries[TR] = Array.from({ length: 230 }, (_, i) => ({
      name: `${TR}/entries/x${i}`,
      participant: `${REC}/participants/${i % 2 ? "p-maya" : "p-sam"}`,
      text: `Utterance number ${i} about the pipeline.`,
      languageCode: "en-US",
      startTime: new Date(base + i * 10_000).toISOString(),
      endTime: new Date(base + i * 10_000 + 5_000).toISOString(),
    }));
    try {
      const r = await importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId: REC, itemId: TR });
      await r.promise;
      const segs = meetings.getSegments(r.meetingId);
      expect(segs).toHaveLength(230);
      expect(segs[229]).toMatchObject({ speaker: "Maya Chen", startSec: 2290, text: "Utterance number 229 about the pipeline." });
      const pages = mock.requests.filter((q) => q.path === `/google/meet/v2/${TR}/entries`);
      expect(pages.length).toBeGreaterThanOrEqual(3);
    } finally {
      mock.google.entries[TR] = saved;
    }
  });

  it("exports the transcript Doc through Drive when the entries have expired", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const r = await importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId: OLD, itemId: `${OLD}/transcripts/tr-9` });
    expect(r.kind).toBe("TRANSCRIPT_DOC");
    await r.promise;
    const m = meetings.getMeeting(ctx.company.id, r.meetingId)!;
    expect(m).toMatchObject({ source: "GOOGLE_MEET", title: "Acme AI intro", heldAt: daysAgo(120) });
    const segs = meetings.getSegments(m.id);
    const turns = segs.filter((s) => s.speaker);
    expect(turns.map((s) => [s.speaker, s.startSec])).toEqual([
      ["Sam Ortiz", 0],
      ["Maya Chen", null],
      ["Sam Ortiz", 300],
      ["Maya Chen", null],
    ]);
    expect(turns[3]!.text).toBe("It excludes founder time; fully loaded it is closer to twenty-six thousand.");
  });

  it("without Drive access the expired transcript is refused with a clear reason", async () => {
    mock.google.grantedScopes = `openid https://www.googleapis.com/auth/userinfo.email ${MEET}`;
    const ctx = setupWorkspace();
    const { actor, done } = await connect(ctx);
    expect(done.connection.missingScopes).toEqual([DRIVE_MEET]);
    const june = await listRemoteMeetings("google_meet", actor, OLDRANGE);
    expect(june[0]!.items[0]).toMatchObject({ importable: false });
    try {
      await importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId: OLD, itemId: `${OLD}/transcripts/tr-9` });
      expect.unreachable();
    } catch (e) {
      expect((e as IntegrationError).code).toBe("FORBIDDEN");
      expect((e as Error).message).toMatch(/30 days/);
    }
    // Recent meetings still import from the entries (Meet scope only).
    const r = await importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId: REC, itemId: TR });
    expect(r.kind).toBe("TRANSCRIPT_ENTRIES");
    await r.promise;
  });

  it("rejects crafted resource names (no path traversal into other API paths)", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const crafted: [string, string][] = [
      [REC, "conferenceRecords/other/transcripts/tr-1"],
      [REC, `${REC}/transcripts/../../spaces/x`],
      ["spaces/abc", "spaces/abc/transcripts/t"],
      ["conferenceRecords/..", "conferenceRecords/../transcripts/.."],
    ];
    for (const [externalId, itemId] of crafted)
      expect(await codeOf(importRemoteMeeting("google_meet", actor, { companyId: ctx.company.id, externalId, itemId }))).toBe("INVALID");
  });

  it("disconnect revokes the grant with the refresh token and deletes it", async () => {
    const ctx = setupWorkspace();
    const { actor } = await connect(ctx);
    const t = sealed(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)!);
    expect(await disconnect("google_meet", actor)).toEqual({ removed: true, revoked: true });
    expect(mock.revoked).toContain(t.r);
    expect(getConnectionRow("google_meet", ctx.workspaceId, ctx.userId)).toBeUndefined();
    expect(await disconnect("google_meet", actor)).toEqual({ removed: false, revoked: false });
  });

  it("not configured: the connector says what to set and which redirect URI and scopes to register", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const st = connectorStatuses(process.env, { origin: ORIGIN })[1]!;
    expect(st).toMatchObject({ id: "google_meet", state: "NOT_CONFIGURED", importEnabled: false, redirectUri: `${ORIGIN}/api/integrations/google_meet/callback` });
    expect(st.scopes.map((s) => s.scope)).toEqual([MEET, DRIVE_MEET, "openid email"]);
    expect(st.setup.join("\n")).toContain(`Authorized redirect URI: ${ORIGIN}/api/integrations/google_meet/callback`);
  });
});

describe("Meet mapping (pure)", () => {
  it("renders entries as WebVTT voice cues the transcript parser reads back exactly", () => {
    const rows = mapEntries(
      [
        { participant: "conferenceRecords/r/participants/a", text: "  Revenue is <$4M> today.\n", startTime: "2026-09-21T14:00:03.250Z", endTime: "2026-09-21T14:00:07Z" },
        { participant: "conferenceRecords/r/participants/b", text: "42", startTime: "2026-09-21T14:00:08Z", endTime: "2026-09-21T14:00:09Z" },
        { participant: "conferenceRecords/r/participants/zz", text: "", startTime: "2026-09-21T14:00:10Z" },
      ],
      new Map([
        ["conferenceRecords/r/participants/a", "maya chen (she/her)"],
        ["conferenceRecords/r/participants/b", "Sam <Partner>"],
      ]),
      "2026-09-21T14:00:00Z",
    );
    const segs = parseTranscript(entriesToVtt(rows));
    expect(segs.map((s) => [s.speaker, s.startSec, s.endSec, s.text])).toEqual([
      ["maya chen (she/her)", 3.25, 7, "Revenue is ‹$4M› today."],
      ["Sam Partner", 8, 9, "42"],
    ]);
  });

  it("attaches the Doc's bare timestamps to the following paragraph", () => {
    expect(normalizeDocTranscript("Title\n00:00:00\n\nA B: hi\n00:05:00\nC D: yo")).toBe("Title\n\n[00:00:00] A B: hi\n[00:05:00] C D: yo");
  });
});
