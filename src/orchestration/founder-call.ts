/**
 * §65 Founder meeting — update, never restart, the analysis.
 *
 * FOUNDER MEETING WORKFLOW (see src/domain/meetings.ts):
 *   ingestion   pasted / uploaded transcript, or an uploaded recording → OpenAI
 *               transcription (speakers + timestamps). The verbatim transcript is
 *               stored as an encrypted TRANSCRIPT document plus one segment row per
 *               speaker turn. The current version is frozen as the meeting's
 *               PRE_MEETING_ANALYSIS; a PRE_MEETING_BRIEF is ensured for it.
 *   CALL        one structured pass (founder_call_update_v3) reads the transcript
 *               against the record; every item cites transcript turns.
 *   UPDATE      code applies it (assemble.applyFounderCall — founder statements stay
 *               company-reported, rating upgrades are guarded), recomputes the
 *               deterministic layer and saves POST_MEETING_ANALYSIS_Vn.
 *   BRIEF       the POST_MEETING_BRIEF is assembled from the extraction, re-anchored
 *               to the transcript, with the deterministic Before → After diff.
 *   INDEX       Fund Brain re-index.
 */
import { createHash } from "node:crypto";
import { CostController, BudgetExceededError } from "@/ai/cost";
import { structured, PRIMARY_MODEL } from "@/ai/openai";
import { detectInjection, wrapUntrusted } from "@/ai/untrusted";
import { FounderCallOutput, founderCallInstructions, FOUNDER_CALL_UPDATE } from "@/ai/prompts/founder-call";
import { TRANSCRIBE_MODEL, AUDIO_EXTENSIONS, MAX_RECORDING_BYTES, mimeFor, transcribeRecording } from "@/ai/transcribe";
import { MeetingParticipant, PostMeetingBrief, POST_MEETING_BRIEF_BUILDER, PreMeetingBrief, type TranscriptSegment } from "@/domain/meetings";
import { parseTranscript, renderTranscript, transcriptForModel } from "@/ingestion/transcript";
import { buildPostMeetingBrief } from "@/reports/meeting-briefs";
import { applyFounderCall } from "./assemble";
import { claimsDigest, metricsTable } from "./context";
import { ensurePreMeetingBrief } from "./pre-meeting-brief";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { storeFile } from "@/server/storage";
import { commitCanonicalUpdate } from "@/server/versioning";
import { logger } from "@/lib/log";

export const FOUNDER_CALL_STEPS = [
  { step: "TRANSCRIBE", label: "Transcribing recording" },
  { step: "CALL", label: "Reading meeting transcript" },
  { step: "UPDATE", label: "Post-meeting analysis" },
  { step: "BRIEF", label: "Post-meeting brief" },
  { step: "INDEX", label: "Updating deal memory" },
];

/** The analysis pass is a single call: small, explicit budget. */
export const FOUNDER_CALL_BUDGET = { hardCapUsd: 0.1, targetUsd: 0.06 } as const;
/** Recording transcription has its own cap (≈ $0.02–0.03 per audio minute). */
export const TRANSCRIPTION_BUDGET_USD = Number(process.env.MEETING_TRANSCRIPTION_CAP_USD ?? 3);
export const MAX_TRANSCRIPT_CHARS = 200_000;
export const MIN_TRANSCRIPT_CHARS = 200;
const MAX_OUTPUT_TOKENS = 20_000;

export class FounderCallError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Split a transcript into ~3k-character "pages" on paragraph boundaries for the raw document viewer. */
export function transcriptPages(text: string, size = 3000): { pageNo: number; text: string }[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}|\n(?=[A-Z][\w .'-]{0,40}:)/);
  const pages: string[] = [];
  let cur = "";
  for (const p of paras) {
    const piece = p.trim();
    if (!piece) continue;
    if (cur && cur.length + piece.length + 2 > size) {
      pages.push(cur);
      cur = "";
    }
    if (piece.length > size) {
      for (let i = 0; i < piece.length; i += size) pages.push(piece.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur) pages.push(cur);
  return pages.map((t, i) => ({ pageNo: i + 1, text: t }));
}

async function storeTranscriptDocument(workspaceId: string, companyId: string, filename: string, text: string) {
  const buf = Buffer.from(text, "utf8");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const name = filename.endsWith(".txt") ? filename : `${filename}.txt`;
  const storagePath = await storeFile(workspaceId, sha256, name, buf);
  return repo.saveDocument({ workspaceId, companyId, filename: name, mime: "text/plain", kind: "TRANSCRIPT", sizeBytes: buf.length, sha256, storagePath, pages: transcriptPages(text) });
}

export interface StartFounderCallInput {
  workspaceId: string;
  userId: string | null;
  companyIdOrSlug: string;
  /** Pasted or uploaded transcript text … */
  transcript?: string | null;
  /** … or a meeting recording to transcribe. */
  recording?: { data: Buffer; filename: string; mime: string } | null;
  /** Original upload name, if the transcript came from a file. */
  filename?: string | null;
  callDate?: string | null;
  title?: string | null;
  participants?: MeetingParticipant[];
  source?: meetings.MeetingSource;
}

/**
 * Validates and stores the meeting input, freezes the PRE_MEETING_ANALYSIS, and
 * creates the meeting + run synchronously; the rest runs in the returned promise
 * (progress lives on the run row).
 */
export async function startFounderCall(inp: StartFounderCallInput) {
  const company = repo.getCompany(inp.workspaceId, inp.companyIdOrSlug);
  if (!company) throw new FounderCallError("Not found", 404);
  const current = repo.getCurrentVersion(company);
  if (!current) throw new FounderCallError("The deck analysis has not produced a version yet", 409);
  const latest = repo.latestRun(company.id);
  if (latest && (latest.status === "RUNNING" || latest.status === "QUEUED")) throw new FounderCallError("An analysis run is already in progress for this company", 409);

  const day = inp.callDate && /^\d{4}-\d{2}-\d{2}$/.test(inp.callDate) ? inp.callDate : new Date().toISOString().slice(0, 10);
  const participants = (inp.participants ?? []).map((p) => MeetingParticipant.parse(p)).slice(0, 20);
  let segments: TranscriptSegment[] | null = null;
  let transcript: string | null = null;
  if (inp.recording) {
    const r = inp.recording;
    if (!AUDIO_EXTENSIONS.test(r.filename)) throw new FounderCallError("Upload an audio or video recording (wav, mp3, m4a, mp4, webm, ogg, flac)");
    if (r.data.length > MAX_RECORDING_BYTES) throw new FounderCallError(`Recording exceeds ${MAX_RECORDING_BYTES / 1024 / 1024} MB`);
    if (r.data.length < 1024) throw new FounderCallError("Recording is empty");
  } else {
    transcript = (inp.transcript ?? "").replace(/\u0000/g, "").trim();
    if (transcript.length < MIN_TRANSCRIPT_CHARS) throw new FounderCallError(`Transcript is too short (${transcript.length} characters)`);
    if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new FounderCallError(`Transcript exceeds ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters`);
    segments = parseTranscript(transcript);
    if (!segments.length) throw new FounderCallError("The transcript contains no text");
  }

  // The meeting is held against the version that is current now: freeze it as PRE_MEETING_ANALYSIS and make sure its brief exists.
  const preBrief = await ensurePreMeetingBrief({ workspaceId: inp.workspaceId, userId: inp.userId, company, version: current, useModel: false, note: "No pre-meeting brief had been generated before the meeting; this one was rendered from the same pre-meeting analysis at ingestion." });

  let transcriptDocumentId: string | null = null;
  let recordingDocumentId: string | null = null;
  let filename = inp.filename?.trim() || `founder-meeting-${day}.txt`;
  if (transcript !== null) {
    transcriptDocumentId = await storeTranscriptDocument(inp.workspaceId, company.id, filename, transcript);
  } else {
    const r = inp.recording!;
    filename = r.filename;
    const sha256 = createHash("sha256").update(r.data).digest("hex");
    const storagePath = await storeFile(inp.workspaceId, sha256, r.filename, r.data);
    recordingDocumentId = repo.saveDocument({ workspaceId: inp.workspaceId, companyId: company.id, filename: r.filename, mime: mimeFor(r.filename, r.mime), kind: "OTHER", sizeBytes: r.data.length, sha256, storagePath, pages: [] });
  }

  const run = repo.createRun({
    workspaceId: inp.workspaceId,
    companyId: company.id,
    kind: "FOUNDER_CALL",
    mode: "STANDARD",
    model: PRIMARY_MODEL,
    promptVersions: { [FOUNDER_CALL_UPDATE.id]: FOUNDER_CALL_UPDATE.version, ...(inp.recording ? { transcription: TRANSCRIBE_MODEL } : {}) },
    registryId: current.row.registryId,
    budgetUsd: FOUNDER_CALL_BUDGET.hardCapUsd + (inp.recording ? TRANSCRIPTION_BUDGET_USD : 0),
    steps: FOUNDER_CALL_STEPS,
  });
  const source: meetings.MeetingSource = inp.source ?? (inp.recording ? "RECORDING_UPLOAD" : inp.filename ? "TRANSCRIPT_FILE" : "PASTED_TRANSCRIPT");
  const meeting = meetings.createMeeting({
    workspaceId: inp.workspaceId,
    companyId: company.id,
    title: inp.title?.trim() || `Founder meeting — ${day}`,
    heldAt: day,
    participants,
    source,
    status: inp.recording ? "TRANSCRIBING" : "PROCESSING",
    preAnalysisVersionId: current.row.id,
    preBriefId: preBrief.id,
    transcriptDocumentId,
    recordingDocumentId,
    runId: run.id,
    createdBy: inp.userId,
  });
  if (segments) meetings.saveSegments(meeting.id, segments);
  if (!inp.recording) repo.updateRunStep(run.id, "TRANSCRIBE", "SKIPPED", "Transcript provided");
  repo.audit(inp.workspaceId, inp.userId, "FOUNDER_MEETING_ADDED", company.id, `${meeting.id} #${meeting.seq} ${run.id} ${filename} (${source})`);

  const promise = runFounderCall({ workspaceId: inp.workspaceId, userId: inp.userId, companyId: company.id, runId: run.id, meetingId: meeting.id, recording: inp.recording ?? null });
  return { company, run, meeting, documentId: transcriptDocumentId ?? recordingDocumentId, promise };
}

export interface RunFounderCallInput {
  workspaceId: string;
  userId: string | null;
  companyId: string;
  runId: string;
  meetingId: string;
  recording: { data: Buffer; filename: string; mime: string } | null;
}

export async function runFounderCall(inp: RunFounderCallInput): Promise<void> {
  const log = logger.child({ runId: inp.runId, companyId: inp.companyId, meetingId: inp.meetingId, kind: "FOUNDER_CALL" });
  const record = (e: Parameters<typeof repo.recordCost>[3]) => repo.recordCost(inp.workspaceId, inp.runId, "ANALYSIS", e);
  const cost = new CostController(FOUNDER_CALL_BUDGET.hardCapUsd, FOUNDER_CALL_BUDGET.targetUsd, record);
  const audioCost = new CostController(TRANSCRIPTION_BUDGET_USD, TRANSCRIPTION_BUDGET_USD, record);
  const spent = () => cost.spentUsd + audioCost.spentUsd;
  const step = (s: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string) => repo.updateRunStep(inp.runId, s, status, detail);
  let current = inp.recording ? "TRANSCRIBE" : "CALL";
  try {
    const company0 = repo.getCompany(inp.workspaceId, inp.companyId);
    let meeting = company0 && meetings.getMeeting(inp.companyId, inp.meetingId);
    if (!company0 || !meeting) throw new Error("Company or meeting disappeared");
    const pre = repo.getVersion(inp.companyId, meeting.preAnalysisVersionId);
    if (!pre) throw new Error("Pre-meeting analysis version disappeared");
    const label = `Meeting ${meeting.seq} (${meeting.heldAt})`;

    /* ---------------- TRANSCRIBE (recordings) ---------------- */
    if (inp.recording) {
      step("TRANSCRIBE", "RUNNING");
      const t = await transcribeRecording({ ...inp.recording, cost: audioCost, onPart: (i, n) => n > 1 && step("TRANSCRIBE", "RUNNING", `part ${i} of ${n}`) });
      if (!t.segments.length) throw new Error("The recording produced no speech");
      meetings.saveSegments(meeting.id, t.segments);
      const text = renderTranscript(t.segments);
      const docId = await storeTranscriptDocument(inp.workspaceId, inp.companyId, `${inp.recording.filename.replace(/\.[^.]+$/, "")}-transcript.txt`, text);
      meetings.updateMeeting(meeting.id, { status: "PROCESSING", transcriptDocumentId: docId, transcription: { model: t.model, diarized: t.diarized, chunks: t.chunks, durationSec: t.durationSec, costUsd: t.costUsd } });
      step("TRANSCRIBE", "DONE", `${t.segments.length} turns, ${t.durationSec ? `${Math.round(t.durationSec / 60)} min` : "duration n/a"}, ${t.diarized ? "speakers identified" : "no speaker labels"} · $${t.costUsd.toFixed(4)}`);
      meeting = meetings.getMeeting(inp.companyId, inp.meetingId)!;
    }
    const segments = meetings.getSegments(meeting.id);
    const transcriptText = renderTranscript(segments);
    current = "CALL";

    /* ---------------- CALL (founder_call_update_v3) ---------------- */
    step("CALL", "RUNNING");
    const company1 = repo.getCompany(inp.workspaceId, inp.companyId)!;
    const base0 = repo.getCurrentVersion(company1) ?? pre;
    const c0 = base0.canonical;
    const preBrief = meeting.preBriefId ? meetings.getBrief(inp.companyId, meeting.preBriefId) : undefined;
    const preBriefContent = preBrief ? PreMeetingBrief.safeParse(preBrief.content) : null;
    const dealRecord = {
      company: { name: c0.identity.name, oneLiner: c0.identity.oneLiner },
      meeting: { title: meeting.title, date: meeting.heldAt, participants: meeting.participants },
      preMeetingObjectives: preBriefContent?.success ? preBriefContent.data.objectives.map((o) => o.objective) : [],
      openQuestions: c0.questions.filter((q) => q.status !== "RESOLVED").map((q) => ({ id: q.id, tier: q.tier, question: q.question, whatWeKnew: q.knownContext })),
      openInformationGaps: c0.informationGaps.filter((g) => g.status !== "RESOLVED").map((g) => ({ id: g.id, question: g.question, status: g.status })),
      primaryMetrics: metricsTable(c0).map((m) => ({ ...m, definition: c0.metrics.find((x) => x.id === m.id)?.definitionUsed ?? null })),
      rubric: c0.rubric.map((r) => ({ criterion: r.criterion, rating: r.rating })),
      founders: c0.founders.map((f) => ({ name: f.name, role: f.role, capabilities: f.capabilities.filter((k) => k.relevant).map((k) => ({ dimension: k.dimension, rating: k.rating, observability: k.observability })) })),
      thesisConditions: (c0.thesis?.requiredConditions ?? []).map((k, i) => ({ index: i, condition: k.condition, status: k.status })),
      risks: c0.risks.map((r) => ({ id: r.id, title: r.title, category: r.category, severity: r.severity, likelihood: r.likelihood, weaknessClass: r.weaknessClass })),
      currentRecommendation: c0.aiRecommendation,
      claimLedger: claimsDigest(c0),
    };
    const out = await structured({
      step: "CALL",
      promptVersion: FOUNDER_CALL_UPDATE.version,
      instructions: founderCallInstructions(),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: wrapUntrusted("current deal record (contains excerpts from untrusted documents)", JSON.stringify(dealRecord)) },
            { type: "input_text", text: wrapUntrusted("founder meeting transcript", `Meeting date: ${meeting.heldAt}\n\n${transcriptForModel(segments, meeting.speakerNames)}`) },
          ],
        },
      ],
      schema: FounderCallOutput,
      schemaName: "founder_call_update",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      effort: "low",
      cost,
    });
    meetings.updateMeeting(meeting.id, { extraction: { promptVersion: FOUNDER_CALL_UPDATE.version, model: PRIMARY_MODEL, output: out.data, guards: [] } });
    step("CALL", "DONE", `${out.data.questionUpdates.length} question updates, ${out.data.claimUpdates.length} claim updates, ${out.data.newClaims.length} new claims, ${out.data.contradictions.length} contradictions`);

    /* ---------------- UPDATE: POST_MEETING_ANALYSIS_Vn on the version current *now* ---------------- */
    current = "UPDATE";
    step("UPDATE", "RUNNING");
    const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
    const base = repo.getCurrentVersion(company) ?? base0;
    const { deal, changes, guards } = applyFounderCall(base.canonical, out.data, `${meeting.title} — transcript`, new Date(), { segments, label });
    const src = [...deal.sources].reverse().find((s) => s.kind === "TRANSCRIPT");
    const docId = meeting.transcriptDocumentId;
    if (src && docId) src.documentId = docId;
    if (docId && !deal.documents.some((d) => d.id === docId)) deal.documents.push({ id: docId, filename: `${meeting.title}.txt`, kind: "TRANSCRIPT", pages: repo.getDocumentPages(docId).length });
    const flags = detectInjection(transcriptText, meeting.title);
    if (flags.length) {
      const seen = new Set(deal.analysis.securityFlags.map((f) => f.excerpt.slice(0, 60)));
      for (const f of flags) if (!seen.has(f.excerpt.slice(0, 60))) deal.analysis.securityFlags.push(f);
    }
    const seq = meetings.nextPostMeetingSeq(inp.companyId);
    const qResolved = out.data.questionUpdates.filter((q) => q.status === "RESOLVED").length;
    const summary = `POST_MEETING_ANALYSIS_V${seq} — ${label}: ${changes.confirmed} confirmed, ${changes.clarified} clarified, ${changes.changed} changed, ${changes.contradicted} contradicted, ${changes.unresolved} unresolved, ${changes.newClaims} new claims; ${qResolved} question(s) resolved`;
    const res = commitCanonicalUpdate({
      workspaceId: inp.workspaceId,
      userId: inp.userId,
      company,
      previous: base,
      canonical: deal,
      reason: "FOUNDER_CALL",
      runId: inp.runId,
      summary,
      stage: "POST_MEETING_ANALYSIS",
      stageSeq: seq,
      history: {
        type: "FOUNDER_CALL_ADDED",
        summary,
        payload: { runId: inp.runId, meetingId: meeting.id, documentId: docId, changes, questionsResolved: qResolved, modelSummary: out.data.summary, guards },
      },
      audit: { action: "FOUNDER_CALL_APPLIED", detail: `${inp.runId} ${meeting.id} → V${seq} ${changes.confirmed}/${changes.clarified}/${changes.changed}/${changes.contradicted}/${changes.unresolved}/${changes.newClaims}` },
    });
    meetings.updateMeeting(meeting.id, { postAnalysisVersionId: res.version.id, extraction: { promptVersion: FOUNDER_CALL_UPDATE.version, model: PRIMARY_MODEL, output: out.data, guards } });
    step("UPDATE", "DONE", `POST_MEETING_ANALYSIS_V${seq} (v${res.version.versionNo}) — ${res.derived.recommendation.status}${res.recommendationChanged ? " (changed)" : ""}${guards.length ? `; ${guards.length} guarded change(s)` : ""}`);

    /* ---------------- BRIEF (POST_MEETING_BRIEF) ---------------- */
    current = "BRIEF";
    step("BRIEF", "RUNNING");
    const stages = meetings.versionStages(inp.companyId);
    const post = repo.getVersion(inp.companyId, res.version.id)!;
    const brief = buildPostMeetingBrief({
      meeting: { id: meeting.id, seq: meeting.seq, title: meeting.title, heldAt: meeting.heldAt, participants: meeting.participants, source: meeting.source },
      pre: { versionId: pre.row.id, versionNo: pre.row.versionNo, stageCode: stages.get(pre.row.id)?.code ?? "PRE_MEETING_ANALYSIS", canonical: pre.canonical, derived: pre.derived },
      post: { versionId: post.row.id, versionNo: post.row.versionNo, stageCode: stages.get(post.row.id)?.code ?? `POST_MEETING_ANALYSIS_V${seq}`, canonical: post.canonical, derived: post.derived },
      preBriefId: meeting.preBriefId,
      preBrief: preBriefContent?.success ? preBriefContent.data : null,
      extraction: out.data,
      segments,
      guards,
    });
    const briefRow = meetings.insertBrief({
      workspaceId: inp.workspaceId,
      companyId: inp.companyId,
      kind: "POST_MEETING_BRIEF",
      versionId: post.row.id,
      meetingId: meeting.id,
      builderVersion: POST_MEETING_BRIEF_BUILDER,
      content: PostMeetingBrief.parse(brief),
      generation: { mode: "DETERMINISTIC_PLUS_MODEL", model: PRIMARY_MODEL, promptVersion: FOUNDER_CALL_UPDATE.version, costUsd: cost.spentUsd, cached: false, fallbackReason: null },
      createdBy: inp.userId,
    });
    meetings.updateMeeting(meeting.id, { postBriefId: briefRow.id, status: "READY", error: null });
    step("BRIEF", "DONE", `${brief.whatChanged.length} material change(s); ${brief.anchoring.anchored}/${brief.anchoring.items} items anchored to the transcript`);

    /* ---------------- INDEX (Fund Brain) ---------------- */
    current = "INDEX";
    step("INDEX", "RUNNING");
    const idx = await res.reindex(cost);
    step("INDEX", idx.ok ? "DONE" : "FAILED", idx.detail);

    repo.finishRun(inp.runId, "COMPLETED", spent(), deal.analysis.depth);
    log.info({ spentUsd: spent(), changes, seq }, "founder meeting applied");
  } catch (e) {
    const msg = e instanceof BudgetExceededError ? e.message : `Founder meeting update failed: ${(e as Error).message.slice(0, 300)}`;
    log.error({ err: (e as Error).message }, "founder meeting failed");
    step(current, "FAILED", msg.slice(0, 160));
    const order = FOUNDER_CALL_STEPS.map((s) => s.step);
    for (const s of order.slice(order.indexOf(current) + 1)) step(s, "SKIPPED", "Not reached");
    meetings.updateMeeting(inp.meetingId, { status: "FAILED", error: msg.slice(0, 500) });
    repo.finishRun(inp.runId, "FAILED", spent(), null, msg);
  }
}
