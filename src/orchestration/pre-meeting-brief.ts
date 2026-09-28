/**
 * PRE_MEETING_BRIEF production.
 *
 * Built deterministically from one analysis version (reports/meeting-briefs),
 * then — optionally — one small structured call (pre_meeting_brief_v1, effort
 * "low", cached, hard cap $0.01) phrases the meeting objectives and "what we
 * already know". If that call fails or is over budget the deterministic brief
 * is persisted as is, with the reason. The brief row is immutable and linked to
 * the version it was built from; one brief per (version, builder version).
 */
import { CostController } from "@/ai/cost";
import { PRIMARY_MODEL, structured } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { PRE_MEETING_BRIEF_PROMPT, PreMeetingBriefOutput, preMeetingBriefInstructions } from "@/ai/prompts/meeting-brief";
import { PRE_MEETING_BRIEF_BUILDER, PreMeetingBrief, type BriefGeneration } from "@/domain/meetings";
import { buildPreMeetingBrief, mergePreBriefModel, preBriefModelInput } from "@/reports/meeting-briefs";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { logger } from "@/lib/log";

export const PRE_BRIEF_BUDGET = { hardCapUsd: 0.01, targetUsd: 0.005 } as const;
const MAX_OUTPUT_TOKENS = 2500;

export async function ensurePreMeetingBrief(v: {
  workspaceId: string;
  userId: string | null;
  company: repo.CompanyRow;
  version?: repo.LoadedVersion | null;
  /** false: deterministic only (e.g. created at meeting ingestion). */
  useModel?: boolean;
  note?: string;
}): Promise<meetings.BriefRow> {
  const version = v.version ?? repo.getCurrentVersion(v.company);
  if (!version) throw new Error("No analysis version yet");
  const existing = meetings.preBriefForVersion(version.row.id, PRE_MEETING_BRIEF_BUILDER);
  if (existing) return existing;

  const stage = meetings.stageOfVersion(v.company.id, version.row.id);
  let brief = buildPreMeetingBrief(version.canonical, version.derived, {
    id: version.row.id,
    versionNo: version.row.versionNo,
    createdAt: version.row.createdAt,
    stageCode: stage?.code ?? "PRE_MEETING_ANALYSIS",
    stageLabel: stage?.label ?? "Pre-meeting analysis",
  });
  const generation: BriefGeneration = { mode: "DETERMINISTIC", model: null, promptVersion: null, costUsd: 0, cached: false, fallbackReason: v.note ?? null };

  if (v.useModel !== false) {
    const cost = new CostController(PRE_BRIEF_BUDGET.hardCapUsd, PRE_BRIEF_BUDGET.targetUsd, (e) => repo.recordCost(v.workspaceId, null, "ANALYSIS", e));
    try {
      const record = preBriefModelInput(version.canonical, version.derived, brief);
      const out = await structured({
        step: "PRE_MEETING_BRIEF",
        promptVersion: PRE_MEETING_BRIEF_PROMPT.version,
        instructions: preMeetingBriefInstructions(),
        input: [{ role: "user", content: [{ type: "input_text", text: wrapUntrusted("deal record (contains excerpts from untrusted documents)", JSON.stringify(record)) }] }],
        schema: PreMeetingBriefOutput,
        schemaName: "pre_meeting_brief",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        effort: "low",
        cost,
        cache: true,
        maxAttempts: 1,
      });
      brief = mergePreBriefModel(brief, out.data);
      Object.assign(generation, { mode: "DETERMINISTIC_PLUS_MODEL", model: PRIMARY_MODEL, promptVersion: PRE_MEETING_BRIEF_PROMPT.version, costUsd: cost.spentUsd, cached: out.cached });
    } catch (e) {
      generation.costUsd = cost.spentUsd;
      generation.fallbackReason = `Model phrasing unavailable (${(e as Error).message.slice(0, 160)}); objectives and "what we know" are rendered from the analysis.`;
      logger.warn({ err: (e as Error).message, companyId: v.company.id }, "pre-meeting brief: model step failed, deterministic brief kept");
    }
  }

  const row = meetings.insertBrief({
    workspaceId: v.workspaceId,
    companyId: v.company.id,
    kind: "PRE_MEETING_BRIEF",
    versionId: version.row.id,
    meetingId: null,
    builderVersion: PRE_MEETING_BRIEF_BUILDER,
    content: PreMeetingBrief.parse(brief),
    generation,
    createdBy: v.userId,
  });
  repo.audit(v.workspaceId, v.userId, "PRE_MEETING_BRIEF_CREATED", v.company.id, `${row.id} from v${version.row.versionNo} (${generation.mode.toLowerCase()})`);
  return row;
}
