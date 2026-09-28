/**
 * Meeting platform connectors (Zoom, Google Meet) — OPTIONAL.
 *
 * The meetings workflow works fully without any connector: transcripts are
 * pasted or uploaded, recordings are uploaded and transcribed. A connector
 * lets a user import a cloud recording's transcript (or audio) straight into
 * that workflow.
 *
 * Configuration is environment-based (client id + secret per provider). Each
 * workspace member connects their OWN account from Settings → Integrations
 * (OAuth 2.0 authorization code + PKCE + state bound to the session, ./oauth.ts);
 * tokens are stored encrypted per workspace+user and only that user's tokens
 * are used for their imports (./import.ts).
 *
 * States shown in Settings:
 *   NOT_CONFIGURED  env vars missing → exact setup steps (redirect URI, scopes)
 *   CONFIGURED      credentials present; the viewer is not connected → Connect
 *   (connection)    CONNECTED → account email, Disconnect, last import
 *                   NEEDS_REAUTH → the refresh token was rejected → Reconnect
 */
import { GOOGLE_SCOPES } from "./providers";

export type ConnectorId = "zoom" | "google_meet";
export const CONNECTOR_IDS: ConnectorId[] = ["zoom", "google_meet"];
type Env = Record<string, string | undefined>;

export function isConnectorId(x: unknown): x is ConnectorId {
  return x === "zoom" || x === "google_meet";
}

export interface ConnectionView {
  status: "CONNECTED" | "NEEDS_REAUTH";
  accountEmail: string | null;
  connectedAt: string;
  scopes: string[];
  /** Required scopes the user did not grant (import is limited or impossible). */
  missingScopes: string[];
  lastError: string | null;
  lastImport: { title: string; at: string; companyId: string; meetingId: string } | null;
}

export interface ConnectorStatus {
  id: ConnectorId;
  name: string;
  state: "NOT_CONFIGURED" | "CONFIGURED";
  /** True when the viewer has a working connection (the meetings UI shows "Import from …"). */
  importEnabled: boolean;
  detail: string;
  envVars: { name: string; present: boolean; secret: boolean }[];
  redirectPath: string;
  /** Absolute redirect URI to register with the provider (null when the app URL cannot be determined). */
  redirectUri: string | null;
  scopes: { scope: string; why: string }[];
  setup: string[];
  docs: string;
  connection: ConnectionView | null;
}

interface Spec {
  id: ConnectorId;
  name: string;
  env: { clientId: string; clientSecret: string };
  scopes: { scope: string; why: string }[];
  setup: (redirectUri: string) => string[];
  docs: string;
}

export const SPECS: Record<ConnectorId, Spec> = {
  zoom: {
    id: "zoom",
    name: "Zoom",
    env: { clientId: "ZOOM_CLIENT_ID", clientSecret: "ZOOM_CLIENT_SECRET" },
    scopes: [
      { scope: "cloud_recording:read:list_user_recordings", why: "list your cloud recordings and their transcript / audio files (classic apps: recording:read)" },
      { scope: "user:read:user", why: "show which Zoom account is connected (classic apps: user:read)" },
    ],
    setup: (uri) => [
      "Zoom App Marketplace → Develop → Build App → General App, user-managed (OAuth).",
      `OAuth redirect URL and OAuth allow list: ${uri}`,
      "Scopes: cloud_recording:read:list_user_recordings and user:read:user.",
      "Copy the Client ID and Client Secret into ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET on the server, then restart.",
      "In Zoom settings, enable Cloud recording and “Create audio transcript” so recordings carry a VTT transcript (speakers + timestamps). Without it, the audio file is transcribed instead.",
      "A development app can only be authorized by users of the developer's Zoom account; other accounts need the app to be published (or shared for beta testing).",
    ],
    docs: "https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording",
  },
  google_meet: {
    id: "google_meet",
    name: "Google Meet",
    env: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
    scopes: [
      { scope: GOOGLE_SCOPES.meet, why: "conference records, participants and transcript entries (Meet REST API v2)" },
      { scope: GOOGLE_SCOPES.driveMeet, why: "fallback only: export the transcript Google Doc when entries have expired (Meet keeps entries 30 days); limited to files created by Meet" },
      { scope: "openid email", why: "show which Google account is connected" },
    ],
    setup: (uri) => [
      "Google Cloud console → APIs & Services → enable the Google Meet REST API and the Google Drive API.",
      "OAuth consent screen: add the scopes below. An Internal app (Google Workspace) needs no verification; an External app needs Google verification for these scopes (Testing mode allows up to 100 test users).",
      `Credentials → Create OAuth client ID → Web application → Authorized redirect URI: ${uri}`,
      "Copy the client ID and secret into GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server, then restart.",
      "Meet produces transcripts only on Workspace editions with transcription, when transcription was turned on in the meeting.",
    ],
    docs: "https://developers.google.com/workspace/meet/api/guides/overview",
  },
};

export const redirectPath = (id: ConnectorId) => `/api/integrations/${id}/callback`;

/** Client credentials from the environment, or null when the connector is not configured. */
export function connectorConfig(id: ConnectorId, env: Env = process.env): { clientId: string; clientSecret: string } | null {
  const spec = SPECS[id];
  const clientId = env[spec.env.clientId]?.trim();
  const clientSecret = env[spec.env.clientSecret]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function cleanOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol === "http:" && !local && process.env.NODE_ENV === "production") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Public origin used to build OAuth redirect URIs: APP_URL, else Render's
 * RENDER_EXTERNAL_URL, else the request's own origin (forwarded headers from
 * the platform proxy). The redirect URI is recorded with the state and reused
 * verbatim for the token exchange.
 */
export function appOrigin(headers?: Headers | null, env: Env = process.env): string | null {
  const configured = cleanOrigin(env.APP_URL) ?? cleanOrigin(env.RENDER_EXTERNAL_URL);
  if (configured) return configured;
  if (!headers) return null;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host)) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0]!.trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return cleanOrigin(`${proto === "http" ? "http" : "https"}://${host}`);
}

export function redirectUriFor(id: ConnectorId, origin: string | null): string | null {
  return origin ? `${origin}${redirectPath(id)}` : null;
}

/**
 * Status of every connector for the Settings page and the meetings UI. Pass a
 * viewer + connection lookup to include the viewer's own connection.
 */
export function connectorStatuses(env: Env = process.env, opts: { origin?: string | null; connection?: (id: ConnectorId) => ConnectionView | null } = {}): ConnectorStatus[] {
  return CONNECTOR_IDS.map((id) => {
    const spec = SPECS[id];
    const envVars = [
      { name: spec.env.clientId, secret: false, present: !!env[spec.env.clientId]?.trim() },
      { name: spec.env.clientSecret, secret: true, present: !!env[spec.env.clientSecret]?.trim() },
    ];
    const configured = envVars.every((e) => e.present);
    const uri = redirectUriFor(id, opts.origin ?? null);
    const connection = configured ? (opts.connection?.(id) ?? null) : null;
    const missing = envVars.filter((e) => !e.present).map((e) => e.name);
    const detail = !configured
      ? `Not configured: set ${missing.join(" and ")} on the server. Optional — the meetings workflow does not need it (paste or upload the transcript or recording instead).`
      : !connection
        ? `Configured. Connect your ${spec.name} account to import cloud recordings and transcripts into a deal's meetings. Only your own account is used for your imports.`
        : connection.status === "NEEDS_REAUTH"
          ? `${spec.name} no longer accepts the stored authorization${connection.lastError ? ` (${connection.lastError})` : ""}. Reconnect to import again.`
          : `Connected${connection.accountEmail ? ` as ${connection.accountEmail}` : ""}. “Import from ${spec.name}” is available on each deal's Meetings tab.`;
    return {
      id,
      name: spec.name,
      state: configured ? "CONFIGURED" : "NOT_CONFIGURED",
      importEnabled: connection?.status === "CONNECTED",
      detail,
      envVars,
      redirectPath: redirectPath(id),
      redirectUri: uri,
      scopes: spec.scopes,
      setup: spec.setup(uri ?? `<APP_URL>${redirectPath(id)}`),
      docs: spec.docs,
      connection,
    };
  });
}
