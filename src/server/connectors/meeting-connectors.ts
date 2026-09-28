/**
 * Meeting platform connectors (Zoom, Google Meet) — OPTIONAL.
 *
 * The meetings workflow works fully without any connector: transcripts are
 * pasted or uploaded, recordings are uploaded and transcribed. A connector
 * would only automate fetching a cloud recording / transcript.
 *
 * Status in this build: documented stubs. Configuration is environment-based
 * and surfaced read-only in Settings → Integrations; every connector reports
 * NOT_CONFIGURED until its credentials are present, and even then it reports
 * that automatic import is not enabled — no OAuth flow is simulated. To
 * implement one, fill in `listRecordings` / `fetchRecording` behind a real
 * OAuth 2.0 authorization-code flow (Zoom: Cloud Recording API
 * `GET /users/me/recordings`, scope `cloud_recording:read`; Google Meet REST
 * API `conferenceRecords.recordings` / `.transcripts`, scope
 * `meetings.space.readonly`, files via Drive) and hand the file to
 * `startFounderCall({ recording })` with source ZOOM / GOOGLE_MEET.
 */

export type ConnectorId = "zoom" | "google_meet";
type Env = Record<string, string | undefined>;

export interface ConnectorStatus {
  id: ConnectorId;
  name: string;
  state: "NOT_CONFIGURED" | "CREDENTIALS_PRESENT";
  /** Always false in this build: automatic import is not implemented. */
  importEnabled: false;
  detail: string;
  envVars: { name: string; present: boolean; secret: boolean }[];
  redirectPath: string;
  scopes: string[];
  docs: string;
}

export interface RemoteRecording {
  externalId: string;
  title: string;
  startedAt: string;
  durationSec: number | null;
  hasTranscript: boolean;
}

export interface MeetingConnector {
  readonly id: ConnectorId;
  readonly name: string;
  status(env?: Env): ConnectorStatus;
  listRecordings(): Promise<RemoteRecording[]>;
  fetchRecording(externalId: string): Promise<{ data: Buffer; filename: string; mime: string }>;
}

export class ConnectorNotAvailableError extends Error {
  constructor(public connector: ConnectorId) {
    super(`${connector === "zoom" ? "Zoom" : "Google Meet"} import is not available in this build. Download the recording or transcript and upload it on the deal's Meetings tab.`);
  }
}

interface Spec {
  id: ConnectorId;
  name: string;
  env: { name: string; secret: boolean }[];
  scopes: string[];
  docs: string;
}

const SPECS: Spec[] = [
  {
    id: "zoom",
    name: "Zoom",
    env: [
      { name: "ZOOM_CLIENT_ID", secret: false },
      { name: "ZOOM_CLIENT_SECRET", secret: true },
    ],
    scopes: ["cloud_recording:read"],
    docs: "https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording",
  },
  {
    id: "google_meet",
    name: "Google Meet",
    env: [
      { name: "GOOGLE_CLIENT_ID", secret: false },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ],
    scopes: ["https://www.googleapis.com/auth/meetings.space.readonly", "https://www.googleapis.com/auth/drive.readonly"],
    docs: "https://developers.google.com/meet/api/guides/overview",
  },
];

class StubConnector implements MeetingConnector {
  constructor(private spec: Spec) {}
  get id() {
    return this.spec.id;
  }
  get name() {
    return this.spec.name;
  }
  status(env: Env = process.env): ConnectorStatus {
    const envVars = this.spec.env.map((e) => ({ name: e.name, secret: e.secret, present: !!env[e.name]?.trim() }));
    const configured = envVars.every((e) => e.present);
    return {
      id: this.spec.id,
      name: this.spec.name,
      state: configured ? "CREDENTIALS_PRESENT" : "NOT_CONFIGURED",
      importEnabled: false,
      detail: configured
        ? `Credentials detected, but automatic ${this.spec.name} import is not enabled in this build. Import recordings by upload.`
        : `Not configured. Set ${envVars.filter((e) => !e.present).map((e) => e.name).join(" and ")} to prepare the connector. The meetings workflow does not need it: upload the recording or transcript instead.`,
      envVars,
      redirectPath: `/api/integrations/${this.spec.id}/callback`,
      scopes: this.spec.scopes,
      docs: this.spec.docs,
    };
  }
  async listRecordings(): Promise<RemoteRecording[]> {
    throw new ConnectorNotAvailableError(this.spec.id);
  }
  async fetchRecording(): Promise<{ data: Buffer; filename: string; mime: string }> {
    throw new ConnectorNotAvailableError(this.spec.id);
  }
}

export const MEETING_CONNECTORS: MeetingConnector[] = SPECS.map((s) => new StubConnector(s));

export function connectorStatuses(env: Env = process.env): ConnectorStatus[] {
  return MEETING_CONNECTORS.map((c) => c.status(env));
}
