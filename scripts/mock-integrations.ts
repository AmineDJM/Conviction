/**
 * Local mock of the Zoom and Google (OAuth + Meet REST v2 + Drive) endpoints
 * the meeting connectors call — written from the providers' documented
 * contracts, for tests and offline development. It is NOT the real service.
 *
 *   npx tsx scripts/mock-integrations.ts          (MOCK_PORT=4020)
 *   CONVICTION_INTEGRATIONS_MOCK_URL=http://127.0.0.1:4020 ZOOM_CLIENT_ID=… ZOOM_CLIENT_SECRET=… npm run dev
 *
 * Authorization endpoints auto-consent (302 back to redirect_uri with a code).
 * Enforced like the real services: client authentication (Zoom: Basic; Google:
 * body), exact redirect_uri match, PKCE S256, single-use codes, bearer tokens
 * on every API call and download, Zoom refresh-token rotation (the previous
 * refresh token stops working), revocation. `state` lets tests expire access
 * tokens, revoke grants and inspect requests.
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

type Provider = "zoom" | "google";

export interface MockState {
  url: string;
  clients: Record<Provider, { id: string; secret: string }>;
  /** Access tokens currently valid. */
  access: Map<string, Provider>;
  /** Refresh tokens currently valid. */
  refresh: Map<string, Provider>;
  revoked: string[];
  requests: { method: string; path: string; auth: string | null }[];
  counters: { zoomRefresh: number; googleRefresh: number; tokenExchanges: number };
  /** Next N API calls answer 429 with Retry-After. */
  rateLimitNext: { count: number; retryAfter: number };
  zoom: { meetings: unknown[]; files: Map<string, { body: Buffer; type: string }> };
  google: {
    records: { name: string; startTime: string; endTime: string; space: string }[];
    spaces: Record<string, { meetingCode: string }>;
    transcripts: Record<string, { name: string; state: string; startTime: string; endTime: string; docsDestination?: { document: string; exportUri: string } }[]>;
    entries: Record<string, { name: string; participant: string; text: string; languageCode: string; startTime: string; endTime: string }[]>;
    participants: Record<string, unknown[]>;
    docs: Record<string, { name: string; text: string }>;
    grantedScopes: string | null;
  };
  expireAccessTokens(): void;
  close(): Promise<void>;
}

const b64url = (b: Buffer) => b.toString("base64url");
const tok = (p: string) => `${p}_${b64url(randomBytes(12))}`;

export const ZOOM_VTT = `WEBVTT

1
00:00:05.120 --> 00:00:11.400
Sam Ortiz: Walk me through how you calculate CAC today.

2
00:00:12.000 --> 00:00:19.850
Maya Chen: The eighteen thousand dollar CAC in the deck excludes founder time and sales engineering.

3
00:00:20.100 --> 00:00:24.300
Maya Chen: Fully loaded it is closer to twenty-six thousand.

4
00:01:03.000 --> 00:01:08.500
Sam Ortiz: Who closes enterprise deals today?

5
00:01:09.000 --> 00:01:18.250
Maya Chen: Honestly, I still close every enterprise deal myself. Our first account executive started in July.
`;

function seedZoom(base: string) {
  const files = new Map<string, { body: Buffer; type: string }>();
  files.set("f-vtt-1", { body: Buffer.from(ZOOM_VTT), type: "text/vtt" });
  const audio = Buffer.alloc(64 * 1024, 7); // opaque M4A payload (the transcription call is mocked in tests)
  files.set("f-m4a-2", { body: audio, type: "audio/mp4" });
  files.set("f-mp4-1", { body: Buffer.alloc(2048, 1), type: "video/mp4" });
  const dl = (id: string) => `${base}/zoom/rec/download/${id}`;
  const meetings = [
    {
      uuid: "aDYlohsHRtCd4ii1uC2+hA==",
      id: 83456789012,
      topic: "Acme AI — partner call",
      start_time: "2026-09-20T15:00:00Z",
      timezone: "America/New_York",
      duration: 42,
      recording_files: [
        { id: "f-mp4-1", meeting_id: "aDYlohsHRtCd4ii1uC2+hA==", file_type: "MP4", file_extension: "MP4", file_size: 2048, download_url: dl("f-mp4-1"), status: "completed", recording_type: "shared_screen_with_speaker_view" },
        { id: "f-vtt-1", meeting_id: "aDYlohsHRtCd4ii1uC2+hA==", file_type: "TRANSCRIPT", file_extension: "VTT", file_size: ZOOM_VTT.length, download_url: dl("f-vtt-1"), status: "completed", recording_type: "audio_transcript" },
      ],
    },
    {
      uuid: "/ajXp112QmuoKj4854875==",
      id: 83456789013,
      topic: "Acme AI — follow-up (no transcript)",
      start_time: "2026-09-22T09:30:00Z",
      timezone: "Europe/Paris",
      duration: 18,
      recording_files: [{ id: "f-m4a-2", meeting_id: "/ajXp112QmuoKj4854875==", file_type: "M4A", file_extension: "M4A", file_size: audio.length, download_url: dl("f-m4a-2"), status: "completed", recording_type: "audio_only" }],
    },
    {
      uuid: "big+audio==",
      id: 83456789014,
      topic: "Long board prep",
      start_time: "2026-09-23T09:30:00Z",
      timezone: "UTC",
      duration: 95,
      recording_files: [{ id: "f-m4a-3", meeting_id: "big+audio==", file_type: "M4A", file_extension: "M4A", file_size: 80 * 1024 * 1024, download_url: dl("f-m4a-3"), status: "completed", recording_type: "audio_only" }],
    },
  ];
  return { meetings, files };
}

function seedGoogle() {
  const rec = "conferenceRecords/rec-abc123";
  const old = "conferenceRecords/rec-old999";
  const t = `${rec}/transcripts/tr-1`;
  const tOld = `${old}/transcripts/tr-9`;
  // Relative to today: the recent meeting is within Meet's 30-day entry retention, the old one is not.
  const day = (daysAgo: number, time: string) => `${new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10)}T${time}Z`;
  const t0 = day(7, "14:00:00");
  const o0 = day(120, "10:00:00");
  const at = (s: number) => new Date(Date.parse(t0) + s * 1000).toISOString();
  return {
    records: [
      { name: rec, startTime: day(7, "13:59:30"), endTime: day(7, "14:40:00"), space: "spaces/space-1" },
      { name: old, startTime: o0, endTime: day(120, "10:30:00"), space: "spaces/space-2" },
    ],
    spaces: { "spaces/space-1": { meetingCode: "abc-mnop-xyz" }, "spaces/space-2": { meetingCode: "old-code-qrs" } },
    transcripts: {
      [rec]: [{ name: t, state: "FILE_GENERATED", startTime: at(0), endTime: at(2400), docsDestination: { document: "1docAcmeTranscriptXYZ", exportUri: "https://docs.google.com/document/d/1docAcmeTranscriptXYZ/export?format=txt" } }],
      [old]: [{ name: tOld, state: "FILE_GENERATED", startTime: o0, endTime: day(120, "10:30:00"), docsDestination: { document: "1docOldTranscript999", exportUri: "https://docs.google.com/document/d/1docOldTranscript999/export?format=txt" } }],
    },
    entries: {
      [t]: [
        { name: `${t}/entries/e1`, participant: `${rec}/participants/p-sam`, text: "Walk me through how you calculate CAC today.", languageCode: "en-US", startTime: at(5), endTime: at(11) },
        { name: `${t}/entries/e2`, participant: `${rec}/participants/p-maya`, text: "The eighteen thousand dollar CAC in the deck excludes founder time and sales engineering.", languageCode: "en-US", startTime: at(12), endTime: at(19.5) },
        { name: `${t}/entries/e3`, participant: `${rec}/participants/p-guest`, text: "Quick question from me: is churn in there?", languageCode: "en-US", startTime: at(40), endTime: at(44) },
        { name: `${t}/entries/e4`, participant: `${rec}/participants/p-maya`, text: "We did lose one customer in 2025, Northwind, after their acquisition.", languageCode: "en-US", startTime: at(45), endTime: at(52) },
        { name: `${t}/entries/e5`, participant: `${rec}/participants/p-phone`, text: "Gross margin is 76% as in the deck.", languageCode: "en-US", startTime: at(70), endTime: at(75.25) },
        { name: `${t}/entries/e6`, participant: `${rec}/participants/p-unknown`, text: "And hosting is on our own AWS account.", languageCode: "en-US", startTime: at(76), endTime: at(80) },
      ],
      [tOld]: [],
    },
    participants: {
      [rec]: [
        { name: `${rec}/participants/p-sam`, signedinUser: { user: "users/1", displayName: "Sam Ortiz" } },
        { name: `${rec}/participants/p-maya`, signedinUser: { user: "users/2", displayName: "Maya Chen" } },
        { name: `${rec}/participants/p-guest`, anonymousUser: { displayName: "guest analyst" } },
        { name: `${rec}/participants/p-phone`, phoneUser: { displayName: "+1 415-***-**12" } },
      ],
      [old]: [],
    },
    docs: {
      "1docAcmeTranscriptXYZ": { name: "Acme AI partner call - Transcript", text: "unused" },
      "1docOldTranscript999": {
        name: "Acme AI intro - Transcript",
        text: "Acme AI intro - Transcript\n\n00:00:00\n\nSam Ortiz: Thanks for joining, tell us about Acme.\nMaya Chen: We automate accounts payable for the mid-market and we have ninety-two paying customers today.\n\n00:05:00\n\nSam Ortiz: What does the eighteen thousand dollar CAC include?\nMaya Chen: It excludes founder time; fully loaded it is closer to twenty-six thousand.\n",
      },
    },
    grantedScopes: null as string | null,
  };
}

export async function startMockIntegrations(port = 0): Promise<MockState> {
  const codes = new Map<string, { provider: Provider; redirectUri: string; challenge: string; clientId: string }>();
  const state = {} as MockState;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const auth = req.headers.authorization ?? null;
    state.requests.push({ method: req.method ?? "GET", path, auth });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const form = new URLSearchParams(raw);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const bearer = (p: Provider) => {
      const t = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      return state.access.get(t) === p;
    };
    const unauthorized = (p: Provider) => (p === "zoom" ? json(401, { code: 124, message: "Invalid access token." }) : json(401, { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } }));
    const rateLimited = () => {
      if (state.rateLimitNext.count > 0) {
        state.rateLimitNext.count--;
        json(429, { code: 429, message: "You have reached the maximum per-second rate limit for this API." }, { "retry-after": String(state.rateLimitNext.retryAfter) });
        return true;
      }
      return false;
    };
    const issue = (p: Provider, withRefresh = true) => {
      const a = tok(p === "zoom" ? "zat" : "gat");
      state.access.set(a, p);
      const r = withRefresh ? tok(p === "zoom" ? "zrt" : "grt") : null;
      if (r) state.refresh.set(r, p);
      return { a, r };
    };

    /* ---------------- OAuth (both) ---------------- */
    const authorizeMatch = path === "/zoom/oauth/authorize" ? "zoom" : path === "/google/o/oauth2/v2/auth" ? "google" : null;
    if (authorizeMatch && req.method === "GET") {
      const p = authorizeMatch as Provider;
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      if (clientId !== state.clients[p].id || url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) return json(400, { error: "invalid_request" });
      const code = tok("code");
      codes.set(code, { provider: p, redirectUri, challenge: url.searchParams.get("code_challenge")!, clientId });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    const tokenMatch = path === "/zoom/oauth/token" ? "zoom" : path === "/google/token" ? "google" : null;
    if (tokenMatch && req.method === "POST") {
      const p = tokenMatch as Provider;
      let clientId: string | null;
      let secret: string | null;
      if (p === "zoom") {
        const dec = auth?.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString("utf8") : "";
        [clientId, secret] = dec.includes(":") ? [dec.slice(0, dec.indexOf(":")), dec.slice(dec.indexOf(":") + 1)] : [null, null];
      } else {
        clientId = form.get("client_id");
        secret = form.get("client_secret");
      }
      if (clientId !== state.clients[p].id || secret !== state.clients[p].secret) return json(401, { error: "invalid_client", error_description: "Invalid client_id or client_secret" });
      const grant = form.get("grant_type");
      if (grant === "authorization_code") {
        const c = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!c || c.provider !== p) return json(400, { error: "invalid_grant", error_description: "Invalid authorization code" });
        if (c.redirectUri !== form.get("redirect_uri")) return json(400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        const verifier = form.get("code_verifier") ?? "";
        if (b64url(createHash("sha256").update(verifier).digest()) !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        state.counters.tokenExchanges++;
        const t = issue(p);
        return p === "zoom"
          ? json(200, { access_token: t.a, token_type: "bearer", refresh_token: t.r, expires_in: 3599, scope: "cloud_recording:read:list_user_recordings user:read:user", api_url: "https://api.zoom.us" })
          : json(200, { access_token: t.a, expires_in: 3599, refresh_token: t.r, scope: state.google.grantedScopes ?? "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/drive.meet.readonly", token_type: "Bearer", id_token: "x.y.z" });
      }
      if (grant === "refresh_token") {
        const r = form.get("refresh_token") ?? "";
        if (state.refresh.get(r) !== p) return json(400, p === "zoom" ? { reason: "Invalid Token!", error: "invalid_request" } : { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        if (p === "zoom") {
          state.counters.zoomRefresh++;
          state.refresh.delete(r); // rotation: the old refresh token is no longer valid
          const t = issue(p);
          return json(200, { access_token: t.a, token_type: "bearer", refresh_token: t.r, expires_in: 3599, scope: "cloud_recording:read:list_user_recordings user:read:user" });
        }
        state.counters.googleRefresh++;
        const t = issue(p, false);
        return json(200, { access_token: t.a, expires_in: 3599, scope: state.google.grantedScopes ?? "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/drive.meet.readonly", token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if ((path === "/zoom/oauth/revoke" || path === "/google/revoke") && req.method === "POST") {
      const t = form.get("token") ?? "";
      const p: Provider = path.startsWith("/zoom") ? "zoom" : "google";
      if (p === "zoom") {
        const dec = auth?.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString("utf8") : "";
        if (dec !== `${state.clients.zoom.id}:${state.clients.zoom.secret}`) return json(401, { error: "invalid_client" });
      }
      if (state.access.get(t) !== p && state.refresh.get(t) !== p) return json(400, { error: "invalid_token" });
      state.revoked.push(t);
      // Revoking a grant invalidates every token of that provider in this single-user mock.
      for (const [k, v] of [...state.access]) if (v === p) state.access.delete(k);
      for (const [k, v] of [...state.refresh]) if (v === p) state.refresh.delete(k);
      return p === "zoom" ? json(200, { status: "success" }) : json(200, {});
    }

    /* ---------------- Zoom API ---------------- */
    if (path.startsWith("/zoom/v2/") || path.startsWith("/zoom/rec/")) {
      if (!bearer("zoom")) return unauthorized("zoom");
      if (rateLimited()) return;
      if (path === "/zoom/v2/users/me") return json(200, { id: "zu_123", email: "gp@fund.example", first_name: "Sam", last_name: "Ortiz", type: 2 });
      if (path === "/zoom/v2/users/me/recordings") {
        const from = url.searchParams.get("from") ?? "";
        const to = url.searchParams.get("to") ?? "";
        const inRange = (state.zoom.meetings as { start_time: string }[]).filter((m) => m.start_time.slice(0, 10) >= from && m.start_time.slice(0, 10) <= to);
        return json(200, { from, to, page_count: 1, page_size: 300, total_records: inRange.length, next_page_token: "", meetings: inRange });
      }
      const dl = path.match(/^\/zoom\/rec\/download\/([\w-]+)$/);
      if (dl) {
        if (!state.zoom.files.has(dl[1]!)) return json(404, { code: 3301, message: "This recording does not exist." });
        // Like Zoom: redirect to a signed CDN location that needs no Authorization header.
        res.writeHead(302, { location: `/zoom-cdn/${dl[1]}?sig=${b64url(randomBytes(8))}` });
        return res.end();
      }
      return json(404, { code: 404, message: "Not found" });
    }
    const cdn = path.match(/^\/zoom-cdn\/([\w-]+)$/);
    if (cdn) {
      const f = state.zoom.files.get(cdn[1]!);
      if (!f || !url.searchParams.get("sig")) return json(403, { message: "Forbidden" });
      res.writeHead(200, { "content-type": f.type, "content-length": String(f.body.length) });
      return res.end(f.body);
    }

    /* ---------------- Google ---------------- */
    if (path.startsWith("/google/v1/") || path.startsWith("/google/meet/") || path.startsWith("/google/drive/")) {
      if (!bearer("google")) return unauthorized("google");
      if (rateLimited()) return;
      if (path === "/google/v1/userinfo") return json(200, { sub: "10987654321", email: "gp@fund.example", email_verified: true });
      const g = state.google;
      const page = <T>(list: T[], key: string) => {
        const size = Math.min(Number(url.searchParams.get("pageSize") ?? 10) || 10, 100);
        const start = Number(url.searchParams.get("pageToken") || 0);
        const slice = list.slice(start, start + size);
        const next = start + size < list.length ? String(start + size) : undefined;
        return json(200, { [key]: slice, ...(next ? { nextPageToken: next } : {}) });
      };
      const m = path.replace(/^\/google\/meet\/v2\//, "");
      if (path.startsWith("/google/meet/v2/")) {
        if (m === "conferenceRecords") {
          const f = url.searchParams.get("filter") ?? "";
          const ge = f.match(/start_time>="([^"]+)"/)?.[1];
          const le = f.match(/start_time<="([^"]+)"/)?.[1];
          const list = g.records.filter((r) => (!ge || r.startTime >= ge) && (!le || r.startTime <= le)).sort((a, b) => b.startTime.localeCompare(a.startTime));
          return page(list, "conferenceRecords");
        }
        let mm: RegExpMatchArray | null;
        if ((mm = m.match(/^(conferenceRecords\/[\w-]+)\/transcripts$/))) return page(g.transcripts[mm[1]!] ?? [], "transcripts");
        if ((mm = m.match(/^(conferenceRecords\/[\w-]+\/transcripts\/[\w-]+)\/entries$/))) {
          const list = g.entries[mm[1]!];
          return list ? page(list, "transcriptEntries") : json(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
        }
        if ((mm = m.match(/^(conferenceRecords\/[\w-]+)\/participants$/))) return page(g.participants[mm[1]!] ?? [], "participants");
        if ((mm = m.match(/^(conferenceRecords\/[\w-]+)\/transcripts\/[\w-]+$/))) {
          const t = (g.transcripts[mm[1]!] ?? []).find((x) => x.name === m);
          return t ? json(200, t) : json(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
        }
        if ((mm = m.match(/^spaces\/[\w-]+$/))) return g.spaces[m] ? json(200, { name: m, meetingUri: `https://meet.google.com/${g.spaces[m]!.meetingCode}`, ...g.spaces[m] }) : json(404, { error: { code: 404, status: "NOT_FOUND" } });
        return json(404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
      }
      const d = path.match(/^\/google\/drive\/v3\/files\/([\w-]+)(\/export)?$/);
      if (d) {
        const doc = g.docs[d[1]!];
        const scopes = g.grantedScopes ?? "drive.meet.readonly";
        if (!scopes.includes("drive")) return json(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
        if (!doc) return json(404, { error: { code: 404, message: "File not found." } });
        if (d[2]) {
          if (url.searchParams.get("mimeType") !== "text/plain") return json(400, { error: { code: 400, message: "Bad mimeType" } });
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          return res.end(doc.text);
        }
        return json(200, { name: doc.name });
      }
      return json(404, { error: { code: 404, message: "Not found" } });
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(state, {
    url: base,
    clients: { zoom: { id: "zoom-client-id", secret: "zoom-client-secret" }, google: { id: "google-client-id.apps.googleusercontent.com", secret: "google-client-secret" } },
    access: new Map(),
    refresh: new Map(),
    revoked: [],
    requests: [],
    counters: { zoomRefresh: 0, googleRefresh: 0, tokenExchanges: 0 },
    rateLimitNext: { count: 0, retryAfter: 0 },
    zoom: seedZoom(base),
    google: seedGoogle(),
    expireAccessTokens() {
      state.access.clear();
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  } satisfies Omit<MockState, never>);
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  startMockIntegrations(Number(process.env.MOCK_PORT ?? 4020)).then((s) => {
    console.log(`mock integrations on ${s.url}`);
    console.log(`  ZOOM_CLIENT_ID=${s.clients.zoom.id} ZOOM_CLIENT_SECRET=${s.clients.zoom.secret}`);
    console.log(`  GOOGLE_CLIENT_ID=${s.clients.google.id} GOOGLE_CLIENT_SECRET=${s.clients.google.secret}`);
    console.log(`  CONVICTION_INTEGRATIONS_MOCK_URL=${s.url}`);
  });
}
