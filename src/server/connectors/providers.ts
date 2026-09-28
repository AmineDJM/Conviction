/**
 * OAuth 2.0 provider contracts for Zoom and Google (authorization-code flow
 * with PKCE S256 and a state parameter). Pure HTTP against the documented
 * endpoints; persistence lives in ./oauth.ts.
 *
 * Zoom (user-managed "General" app, https://developers.zoom.us/docs/integrations/oauth/):
 *   authorize  GET  https://zoom.us/oauth/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256
 *   token      POST https://zoom.us/oauth/token  (Basic client_id:client_secret; grant_type=authorization_code, code, redirect_uri, code_verifier)
 *   refresh    POST https://zoom.us/oauth/token  (grant_type=refresh_token) — the refresh token ROTATES: always store the new one
 *   revoke     POST https://zoom.us/oauth/revoke (Basic; token=…)
 *   account    GET  https://api.zoom.us/v2/users/me
 *   Scopes are configured on the Marketplace app, not requested in the URL.
 *
 * Google (web application client, https://developers.google.com/identity/protocols/oauth2/web-server):
 *   authorize  GET  https://accounts.google.com/o/oauth2/v2/auth?…&scope&access_type=offline&prompt=consent&code_challenge…
 *   token      POST https://oauth2.googleapis.com/token (client_id, client_secret, code, code_verifier, redirect_uri)
 *   refresh    POST same, grant_type=refresh_token — Google normally keeps the refresh token (a new one is stored if returned)
 *   revoke     POST https://oauth2.googleapis.com/revoke (token in the form body, not the URL)
 *   account    GET  https://openidconnect.googleapis.com/v1/userinfo (scopes openid email)
 */
import { apiJson, describeError, endpoints, IntegrationError, oauthPost } from "./http";
import type { ConnectorId } from "./meeting-connectors";

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
}

export interface OAuthProvider {
  id: ConnectorId;
  name: string;
  authorizeUrl(cfg: ClientConfig, p: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(cfg: ClientConfig, p: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet>;
  /** Throws IntegrationError REAUTH_REQUIRED when the refresh token is rejected. */
  refresh(cfg: ClientConfig, refreshToken: string): Promise<TokenSet>;
  /** Best effort; returns whether the provider confirmed the revocation. */
  revoke(cfg: ClientConfig, token: string): Promise<boolean>;
  account(accessToken: string): Promise<{ id: string | null; email: string | null }>;
}

function tokenSet(provider: string, body: Record<string, unknown> | null): TokenSet {
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new IntegrationError("UPSTREAM", `${provider} returned no access token`);
  return {
    accessToken,
    refreshToken: typeof body?.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresIn: typeof body?.expires_in === "number" ? body.expires_in : Number(body?.expires_in) || null,
    scope: typeof body?.scope === "string" ? body.scope : null,
  };
}

/** A refresh rejected by the authorization server (revoked, expired, rotated elsewhere) needs a new consent; 5xx does not. */
function refreshFailure(provider: string, status: number, body: Record<string, unknown> | null): never {
  if (status === 400 || status === 401) throw new IntegrationError("REAUTH_REQUIRED", `${provider} no longer accepts the stored authorization (${describeError(body, `HTTP ${status}`)}). Reconnect ${provider} in Settings → Integrations.`);
  throw new IntegrationError("UPSTREAM", `${provider} token refresh failed (HTTP ${status})`);
}

const basic = (cfg: ClientConfig) => `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;

export const zoomProvider: OAuthProvider = {
  id: "zoom",
  name: "Zoom",
  authorizeUrl(cfg, p) {
    const u = new URL(endpoints().zoomAuthorize);
    u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: p.redirectUri, state: p.state, code_challenge: p.codeChallenge, code_challenge_method: "S256" }).toString();
    return u.toString();
  },
  async exchangeCode(cfg, p) {
    const r = await oauthPost("Zoom", endpoints().zoomToken, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier }, { authorization: basic(cfg) });
    if (r.status !== 200) throw new IntegrationError("INVALID", `Zoom rejected the authorization code (${describeError(r.body, `HTTP ${r.status}`)})`);
    return tokenSet("Zoom", r.body);
  },
  async refresh(cfg, refreshToken) {
    const r = await oauthPost("Zoom", endpoints().zoomToken, { grant_type: "refresh_token", refresh_token: refreshToken }, { authorization: basic(cfg) });
    if (r.status !== 200) refreshFailure("Zoom", r.status, r.body);
    return tokenSet("Zoom", r.body);
  },
  async revoke(cfg, token) {
    const r = await oauthPost("Zoom", endpoints().zoomRevoke, { token }, { authorization: basic(cfg) }).catch(() => null);
    return !!r && r.status === 200;
  },
  async account(accessToken) {
    const me = await apiJson<{ id?: string; email?: string }>("Zoom", `${endpoints().zoomApi}/users/me`, { token: accessToken });
    return { id: me.id ?? null, email: me.email ?? null };
  },
};

export const GOOGLE_SCOPES = {
  /** Conference records, participants, transcripts and transcript entries (Meet REST API v2). Sensitive. */
  meet: "https://www.googleapis.com/auth/meetings.space.readonly",
  /** Only Drive files created or edited by Google Meet — the transcript Doc, for the export fallback. Restricted, but far narrower than drive.readonly. */
  driveMeet: "https://www.googleapis.com/auth/drive.meet.readonly",
} as const;

export const googleProvider: OAuthProvider = {
  id: "google_meet",
  name: "Google Meet",
  authorizeUrl(cfg, p) {
    const u = new URL(endpoints().googleAuthorize);
    u.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: p.redirectUri,
      response_type: "code",
      scope: ["openid", "email", GOOGLE_SCOPES.meet, GOOGLE_SCOPES.driveMeet].join(" "),
      access_type: "offline",
      prompt: "consent",
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return u.toString();
  },
  async exchangeCode(cfg, p) {
    const r = await oauthPost("Google", endpoints().googleToken, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier, client_id: cfg.clientId, client_secret: cfg.clientSecret });
    if (r.status !== 200) throw new IntegrationError("INVALID", `Google rejected the authorization code (${describeError(r.body, `HTTP ${r.status}`)})`);
    return tokenSet("Google", r.body);
  },
  async refresh(cfg, refreshToken) {
    const r = await oauthPost("Google", endpoints().googleToken, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
    if (r.status !== 200) refreshFailure("Google", r.status, r.body);
    return tokenSet("Google", r.body);
  },
  async revoke(_cfg, token) {
    const r = await oauthPost("Google", endpoints().googleRevoke, { token }).catch(() => null);
    return !!r && r.status === 200;
  },
  async account(accessToken) {
    const me = await apiJson<{ sub?: string; email?: string }>("Google", endpoints().googleUserinfo, { token: accessToken });
    return { id: me.sub ?? null, email: me.email ?? null };
  },
};

export const PROVIDERS: Record<ConnectorId, OAuthProvider> = { zoom: zoomProvider, google_meet: googleProvider };
