/**
 * DEEP DD REPORT — the fourth report (with Quick Memo, the founder-call /
 * pre-meeting brief and the Investment Memo): the full due-diligence dossier a
 * partner hands to IC for a deep-DD decision, and the diligence work plan.
 *
 *   (stored canonical, stored derived, version meta) → structured sections → web reader · print · markdown
 *
 * Deterministic, no model calls. Every number is read from the stored
 * canonical object or the stored derived analysis of ONE version and only
 * formatted — never re-derived (zero divergence with the other views). Every
 * structured number carries refs: record refs (MET-/CLM-/SRC-/RSK-/Q-/GAP-)
 * and, for numbers computed by the engine, an engine ref (calc:economics …)
 * that links to the view where the computation is shown. Every section states
 * its evidence status and what is unknown. Versions stored before a derived
 * block existed render "not computed for this version" — nothing is computed
 * on view.
 */
import { dedupeSecurityFlags } from "@/engine/security-flags";
import type { CanonicalDeal, Claim, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { metricEvidence } from "@/components/deal/metric";
import { DECISION_LABEL, EVIDENCE_LABEL_TEXT, STAGE_LABEL, date, metricValue, multiple, pct, usd } from "@/lib/format";
import { NOT_DISCLOSED, clip, enumLabel as label, gateRationale, humanList, stripRefs } from "./text";
import { ANSWERER_LABEL, DRIVER_LABEL, buildWorkPlan, breakpointStatus, refsIn, sensValue, type WorkPlan } from "./deep-dd-workplan";

/* ---------------------------------------------------------------- */
/* Types                                                              */
/* ---------------------------------------------------------------- */

/** Record ref (MET-001, CLM-004, SRC-002, RSK-01, Q-03, GAP-05) or engine ref (calc:economics). */
export type DdRef = string;
/** RECORD / COMPUTED numbers must carry refs; MODEL = analysed prose (refs when the analysis cited them); META = version metadata. */
export type DdOrigin = "RECORD" | "COMPUTED" | "MODEL" | "META";

export interface DdFact {
  k: string;
  v: string;
  refs: DdRef[];
  origin: DdOrigin;
}
export interface DdRow {
  cells: string[];
  refs: DdRef[];
}

export type DdBlock =
  | { kind: "lead"; text: string }
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullets"; items: { text: string; refs: DdRef[]; origin: DdOrigin }[]; tone?: "ok" | "warn" | "risk" }
  | { kind: "facts"; rows: DdFact[] }
  | { kind: "table"; head: string[]; rows: DdRow[]; origin: DdOrigin; align?: ("left" | "right")[]; widths?: (string | null)[]; caption?: string }
  | { kind: "note"; tone: "neutral" | "warn" | "risk" | "ok"; title?: string; text: string; refs?: DdRef[] }
  | { kind: "decision"; status: string; label: string; detail: string }
  | { kind: "links"; items: { label: string; path: string }[] }
  | { kind: "workplan"; plan: WorkPlan };

export type EvidenceStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "COMPANY_REPORTED" | "CONTRADICTED" | "COMPUTED" | "INTERPRETATION" | "NOT_ANALYSED" | "NOT_COMPUTED" | "METADATA";

export interface SectionEvidence {
  status: EvidenceStatus;
  label: string;
  detail: string;
  /** Always present; ["No open unknown recorded for this section."] is never assumed — an empty array renders as such explicitly. */
  unknowns: string[];
}

export interface DdSection {
  id: string;
  title: string;
  evidence: SectionEvidence;
  blocks: DdBlock[];
  /** Underlying canonical/derived block absent on this version. */
  missing?: boolean;
}

export interface DeepDdMeeting {
  id: string;
  seq: number;
  title: string;
  heldAt: string;
  status: string;
  pre: { versionNo: number | null; stageCode: string | null };
  preBriefId: string | null;
  post: { versionNo: number | null; stageCode: string | null } | null;
  postBriefId: string | null;
  summary: string | null;
  recommendation: { before: string; after: string } | null;
  changes: { area: string; dimension: string; before: string | null; after: string | null; key: string }[];
  unanswered: number | null;
}

export interface DeepDdMeta {
  versionId: string;
  versionNo: number;
  createdAt: string;
  registryId: string;
  stageCode: string | null;
  stageLabel: string | null;
  historical: boolean;
  meetings?: DeepDdMeeting[];
}

export interface DepthFlag {
  level: "OK" | "WARN" | "INSUFFICIENT";
  text: string;
}

export interface DeepDdReport {
  company: string;
  subtitle: string;
  depth: DepthFlag;
  sections: DdSection[];
  plan: WorkPlan;
  meta: DeepDdMeta;
}

/* ---------------------------------------------------------------- */
/* Engine refs                                                        */
/* ---------------------------------------------------------------- */

/** Engine refs → deal view where the computation is shown. */
export const CALC_VIEWS: Record<string, { label: string; seg: string }> = {
  "calc:returns": { label: "Returns engine", seg: "returns" },
  "calc:economics": { label: "Economics engine", seg: "economics" },
  "calc:integrity": { label: "Integrity engine", seg: "integrity" },
  "calc:signals": { label: "Latent-signal engine", seg: "signals" },
  "calc:divergence": { label: "Divergence engine", seg: "divergence" },
  "calc:market": { label: "Market reconstruction", seg: "market" },
  "calc:evidence": { label: "Evidence scoring", seg: "evidence" },
  "calc:scores": { label: "Scores & gates", seg: "" },
  "calc:focus": { label: "Decision focus", seg: "" },
  "calc:risks": { label: "Risk map", seg: "risks" },
  "calc:questions": { label: "Questions & gaps", seg: "questions" },
};

const NOT_COMPUTED = "Not computed for this version (stored before this engine existed). Nothing is computed on view; re-run the analysis to add it.";

/* ---------------------------------------------------------------- */
/* Helpers                                                            */
/* ---------------------------------------------------------------- */

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const irr = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`);
const SCEN: Record<string, string> = { FAILURE: "Failure", LOW: "Low", BASE: "Base", BULL: "Bull", OUTLIER: "Outlier" };
const TRACTION_KEYS = ["arr", "mrr", "revenue_ttm", "gmv", "tpv", "arr_growth_yoy", "revenue_growth_yoy", "mom_growth", "paying_customers", "active_accounts", "mau", "dau", "units_shipped", "backlog", "pilots"];
const PMF_KEYS = ["nrr", "grr", "logo_retention", "d1_retention", "d7_retention", "d30_retention", "dau_mau", "repeat_rate", "pilot_to_production_rate", "time_to_value_days", "customer_concentration_top1", "customer_concentration_top5", "organic_acquisition_share"];
const GTM_KEYS = ["sales_cycle_days", "win_rate", "pipeline_value", "founder_led_revenue_share", "organic_acquisition_share", "magic_number", "cac", "cac_payback_months"];
const ECON_KEYS = ["acv", "arpu_monthly", "asp", "take_rate", "gross_margin", "contribution_margin", "cac", "cac_payback_months", "ltv", "ltv_to_cac", "magic_number", "burn_multiple", "monthly_net_burn", "cash_balance", "runway_months", "capital_to_next_milestone", "revenue_per_employee", "headcount", "default_rate", "loss_rate"];

function implValue(unit: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "USD":
      return usd(v, 2);
    case "PERCENT":
      return pct(v, 1);
    case "MONTHS":
      return `${v.toFixed(1)} mo`;
    case "MULTIPLE":
    case "RATIO":
      return multiple(v, 2);
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

function chronoValue(unit: string, v: number | null, currency: string | null): string {
  if (v === null) return "—";
  if (unit === "USD_OR_CURRENCY") return currency && currency !== "USD" ? `${currency} ${v.toLocaleString("en-US")}` : usd(v, 2);
  if (unit === "PERCENT") return pct(v, 1);
  if (unit === "MONTHS") return `${v} mo`;
  if (unit === "DAYS") return `${v} d`;
  if (unit === "MULTIPLE" || unit === "RATIO") return multiple(v, 2);
  return v.toLocaleString("en-US");
}

/* ---------------------------------------------------------------- */
/* Builder                                                            */
/* ---------------------------------------------------------------- */

export function buildDeepDdReport(c: CanonicalDeal, d: DerivedAnalysis, meta: DeepDdMeta): DeepDdReport {
  // Older derived snapshots may lack blocks added later: read them as optional, never recompute.
  const integ = d.integrity ?? null;
  const econ = d.economics ?? null;
  const latent = d.latent ?? null;
  const div = d.divergence ?? null;
  const focus = d.focus ?? null;

  const ids = new Set<string>([...c.claims.map((x) => x.id), ...c.sources.map((x) => x.id), ...c.metrics.map((x) => x.id), ...c.risks.map((x) => x.id), ...c.questions.map((x) => x.id), ...c.informationGaps.map((x) => x.id)]);
  /** Keep refs that resolve in this version (or engine refs). */
  const known = (refs: (string | null | undefined)[]) => uniq(refs.filter((r): r is string => !!r && (r.startsWith("calc:") || ids.has(r))));
  const metricById = new Map(c.metrics.map((m) => [m.id, m]));
  const claimById = new Map(c.claims.map((x) => [x.id, x]));
  const primary = c.metrics.filter((m) => m.isPrimary && m.normalizedValue !== null);
  const pm = (key: string) => primary.find((m) => m.metricKey === key);
  const metricRefs = (m: MetricInstance) => known([m.id, m.claimId, m.sourceId]);
  const mref = (key: string) => (pm(key) ? [pm(key)!.id] : []);

  const metricTable = (ms: MetricInstance[], caption?: string): DdBlock => ({
    kind: "table",
    origin: "RECORD",
    head: ["Metric", "Value", "As of", "Basis", "Sample", "Evidence"],
    rows: ms.map((m) => ({
      cells: [`${metricDef(m.metricKey)?.shortName ?? m.label}`, metricValue(m.unit, m.normalizedValue), m.periodEnd ?? "—", label(m.basis), m.sampleSize !== null ? `n=${m.sampleSize}` : "—", metricEvidence(m).text],
      refs: metricRefs(m),
    })),
    align: ["left", "right", "right", "left", "right", "left"],
    widths: [null, "92px", "80px", "90px", "64px", "130px"],
    caption,
  });
  const pick = (keys: string[]) => keys.map((k) => pm(k)).filter((m): m is MetricInstance => !!m);

  const gapsFor = (...targets: string[]) => c.informationGaps.filter((g) => (g.status === "OPEN" || g.status === "NEEDS_FOUNDER") && targets.includes(g.target)).map((g) => `${g.id} ${g.question}`);
  const missingExpected = (re: RegExp) => (integ?.expectedEvidence?.items ?? []).filter((i) => i.level === "EXPECTED" && i.presence !== "PRESENT" && re.test(`${i.itemId} ${i.label}`)).map((i) => `${i.label} — ${label(i.presence).toLowerCase()} (expected at this stage)`);
  const unknownMetrics = (keys: string[]) => c.metrics.filter((m) => m.isPrimary && keys.includes(m.metricKey) && (m.state === "UNKNOWN" || m.state === "WITHHELD" || m.normalizedValue === null)).map((m) => `${metricDef(m.metricKey)?.shortName ?? m.label} (${m.id}) — ${label(m.state).toLowerCase()}`);

  /** Evidence status from every ref the section's blocks carry (plus refs cited inside prose). */
  function evidenceOf(blocks: DdBlock[], opts: { missing?: boolean; notComputed?: boolean; computed?: boolean; unknowns: string[] }): SectionEvidence {
    const unknowns = uniq(opts.unknowns.filter(Boolean));
    if (opts.notComputed) return { status: "NOT_COMPUTED", label: "Not computed for this version", detail: NOT_COMPUTED, unknowns };
    const refs: string[] = [];
    for (const b of blocks) {
      if (b.kind === "facts") b.rows.forEach((r) => refs.push(...r.refs, ...refsIn(r.v)));
      else if (b.kind === "table") b.rows.forEach((r) => refs.push(...r.refs, ...r.cells.flatMap(refsIn)));
      else if (b.kind === "bullets") b.items.forEach((i) => refs.push(...i.refs, ...refsIn(i.text)));
      else if (b.kind === "note") refs.push(...(b.refs ?? []), ...refsIn(b.text));
      else if (b.kind === "lead" || b.kind === "p") refs.push(...refsIn(b.text));
    }
    const recs = uniq(refs).filter((r) => ids.has(r));
    let verified = 0,
      partial = 0,
      contradicted = 0,
      company = 0,
      unknown = 0;
    for (const r of recs) {
      const m = metricById.get(r);
      const cl = claimById.get(r);
      if (m) {
        if (m.state === "CONTRADICTED" || m.verification === "CONTRADICTED") contradicted++;
        else if (m.verification === "VERIFIED") verified++;
        else if (m.verification === "PARTIALLY_VERIFIED") partial++;
        else if (m.state === "UNKNOWN" || m.state === "WITHHELD") unknown++;
        else company++;
      } else if (cl) {
        if (cl.verification === "CONTRADICTED") contradicted++;
        else if (cl.verification === "VERIFIED") verified++;
        else if (cl.verification === "PARTIALLY_VERIFIED") partial++;
        else company++;
      }
    }
    const total = verified + partial + contradicted + company + unknown;
    const detail = total
      ? `${total} evidence item${total > 1 ? "s" : ""} referenced: ${verified} verified, ${partial} partly verified, ${company} company-reported or inferred, ${contradicted} contradicted${unknown ? `, ${unknown} unknown` : ""}.${opts.computed ? " Numbers are computed by the engine from them." : ""}`
      : opts.computed
        ? "Computed by the engine from the record; no claim or metric is referenced directly."
        : "Analytical interpretation; the analysis attached no claim or metric to it.";
    if (opts.missing && total === 0) return { status: "NOT_ANALYSED", label: "Not analysed in this version", detail: "The underlying analysis section is absent (fast screen or partial analysis).", unknowns };
    if (contradicted) return { status: "CONTRADICTED", label: "Contains contradicted evidence", detail, unknowns };
    if (!total) return { status: opts.computed ? "COMPUTED" : "INTERPRETATION", label: opts.computed ? "Computed" : "Interpretation only", detail, unknowns };
    if (verified === total) return { status: "VERIFIED", label: "Verified", detail, unknowns };
    if (verified + partial > 0) return { status: "PARTIALLY_VERIFIED", label: "Partly verified", detail, unknowns };
    return { status: "COMPANY_REPORTED", label: "Company-reported", detail, unknowns };
  }

  const S: DdSection[] = [];
  const push = (id: string, title: string, blocks: DdBlock[], opts: { missing?: boolean; notComputed?: boolean; computed?: boolean; unknowns: string[]; status?: Pick<SectionEvidence, "status" | "label" | "detail"> }) => {
    const b = blocks.length ? blocks : [{ kind: "p", text: opts.notComputed ? NOT_COMPUTED : "Not analysed in this version." } as DdBlock];
    S.push({ id, title, blocks: b, evidence: opts.status ? { ...opts.status, unknowns: uniq(opts.unknowns) } : evidenceOf(b, opts), ...(opts.missing || opts.notComputed ? { missing: true } : {}) });
  };

  const rec = d.recommendation;
  const entry = d.returns.inputs.entry;
  const isSafe = entry.instrument === "SAFE" || entry.instrument === "CONVERTIBLE_NOTE";
  const cl = c.classification;
  const a = c.analysis;
  const plan = buildWorkPlan(c, d);

  /* ------------------------------------------------------------ */
  /* Depth flag                                                     */
  /* ------------------------------------------------------------ */
  const depth: DepthFlag =
    a.depth === "PARTIAL" || a.cancelled
      ? {
          level: "INSUFFICIENT",
          text: `Underlying analysis depth is insufficient for a Deep DD decision: this version is a PARTIAL ${label(a.mode).toLowerCase()} analysis${a.cancelled ? " (run cancelled)" : ""}${a.partialReasons.length ? ` — ${a.partialReasons.join("; ")}` : ""}${a.skippedSteps.length ? `; skipped: ${a.skippedSteps.map((s) => s.step).join(", ")}` : ""}. Sections below say which parts are missing; the work plan is what diligence must add.`,
        }
      : a.mode === "FAST_SCREEN"
        ? { level: "INSUFFICIENT", text: "Underlying analysis depth is insufficient for a Deep DD decision: this version is a FAST SCREEN — research, thesis, red team and most analysis sections were not run. Re-run the analysis in Deep DD mode before IC." }
        : a.mode !== "DEEP_DD"
          ? { level: "WARN", text: `The underlying analysis ran in ${label(a.mode)} mode (full depth), not Deep DD: research depth is that of a ${label(a.mode).toLowerCase()} analysis. This dossier organises what the record holds; the work plan is what Deep DD must add.` }
          : { level: "OK", text: "Deep DD mode, full depth." };

  /* ------------------------------------------------------------ */
  /* 1. Cover                                                       */
  /* ------------------------------------------------------------ */
  {
    const p = a.provenance;
    const rows: DdFact[] = [
      { k: "Company", v: `${c.identity.name}${c.identity.legalName && c.identity.legalName !== c.identity.name ? ` (${c.identity.legalName})` : ""}`, refs: [], origin: "META" },
      { k: "Stage · sector", v: `${STAGE_LABEL[cl.financingStage] ?? label(cl.financingStage)} · ${cl.industry.map(label).join(", ") || "—"}${c.identity.hqCountry ? ` · ${c.identity.hqCountry}` : ""}`, refs: [], origin: "META" },
      {
        k: "Round",
        v: `${label(entry.instrument)}${entry.raiseUsd ? ` · raising ${usd(entry.raiseUsd)}` : ""}${entry.postMoneyUsd ? ` · ${usd(entry.postMoneyUsd)} ${isSafe ? "cap" : "post-money"} (${entry.source.toLowerCase()})` : " · entry valuation not disclosed"}`,
        refs: ["calc:returns"],
        origin: "COMPUTED",
      },
      { k: "Version · stage", v: `v${meta.versionNo} · ${meta.stageCode ?? "stage not recorded"}${meta.historical ? " · historical (superseded)" : ""}`, refs: [], origin: "META" },
      { k: "Analysis mode · depth", v: `${label(a.mode)} · ${a.depth === "FULL" ? "Full" : "Partial"}${a.mode !== "DEEP_DD" || a.depth !== "FULL" ? " — flagged" : ""}`, refs: [], origin: "META" },
      { k: "Analysis date", v: date(meta.createdAt), refs: [], origin: "META" },
      { k: "Registry · fund profile", v: `${meta.registryId} · ${d.fundProfileId}`, refs: [], origin: "META" },
    ];
    const prov: DdFact[] = p
      ? [
          { k: "Model", v: p.model, refs: [], origin: "META" },
          { k: "Engine · dictionary · schema", v: `${p.engineVersion} · ${p.dictionaryVersion} · ${p.schemaVersion}`, refs: [], origin: "META" },
          { k: "Prompt versions", v: Object.entries(p.promptVersions).map(([k, v]) => `${k} ${v}`).join(", ") || "—", refs: [], origin: "META" },
          { k: "Input hash", v: p.inputHash ?? "not recorded", refs: [], origin: "META" },
          { k: "Run started · duration", v: `${date(p.startedAt)}${p.durationMs !== null ? ` · ${(p.durationMs / 1000).toFixed(0)} s` : ""}`, refs: [], origin: "META" },
        ]
      : [{ k: "Provenance", v: "Not recorded for this version.", refs: [], origin: "META" }];
    const blocks: DdBlock[] = [
      { kind: "lead", text: c.identity.oneLiner || "No one-line description in the record." },
      { kind: "note", tone: depth.level === "OK" ? "ok" : depth.level === "WARN" ? "warn" : "risk", title: depth.level === "OK" ? "Analysis depth" : "Analysis depth flag", text: depth.text },
      { kind: "facts", rows },
      { kind: "h3", text: "Provenance" },
      { kind: "facts", rows: prov },
    ];
    if (c.overrides.length) blocks.push({ kind: "note", tone: "neutral", text: `${c.overrides.length} analyst override(s) are applied to this version; raw extractions are kept (Evidence tab).` });
    push("cover", "Cover", blocks, {
      unknowns: p ? [] : ["Provenance of this version"],
      status: { status: "METADATA", label: "Version metadata", detail: "Identity of the stored version this report is rendered from; the round line is read from the returns engine's entry terms." },
    });
  }

  /* ------------------------------------------------------------ */
  /* 2. Decision summary                                            */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [{ kind: "decision", status: rec.status, label: DECISION_LABEL[rec.status] ?? label(rec.status), detail: gateRationale(rec) }];
    b.push({
      kind: "table",
      origin: "COMPUTED",
      head: ["Gate", "Outcome", "Detail"],
      rows: rec.trace.map((t) => ({ cells: [t.gate, t.outcome, t.detail], refs: ["calc:scores"] })),
      widths: ["150px", "90px", null],
      caption: `Admissible statuses: ${humanList(rec.admissible.map((s) => DECISION_LABEL[s] ?? s))}.${rec.aiSuggested && !rec.aiAccepted ? ` The analysis suggested “${DECISION_LABEL[rec.aiSuggested] ?? rec.aiSuggested}”, which the gates did not admit.` : ""}`,
    });
    const oqi = d.operatingQuality;
    const base = d.returns.scenarios.find((s) => s.scenario === "BASE");
    b.push({
      kind: "facts",
      rows: [
        { k: "Operating quality", v: oqi.value !== null ? `${Math.round(oqi.value)} / 100 (bounds ${Math.round(oqi.lower)}–${Math.round(oqi.upper)}, ${d.peerGroup.name})` : `Not scorable (bounds ${Math.round(oqi.lower)}–${Math.round(oqi.upper)})`, refs: ["calc:scores"], origin: "COMPUTED" },
        { k: "Evidence quality", v: `${label(d.evidence.category)} — ${d.evidence.verifiedMaterial} of ${d.evidence.materialClaims} material claims verified, ${d.evidence.contradictedMaterial} contradicted`, refs: ["calc:evidence"], origin: "COMPUTED" },
        { k: "Power-law potential", v: d.powerLaw.value !== null ? `${Math.round(d.powerLaw.value)} (anchored index, bounds ${Math.round(d.powerLaw.lower)}–${Math.round(d.powerLaw.upper)})` : "Not scorable", refs: ["calc:scores"], origin: "COMPUTED" },
        { k: "Fund fit", v: `Mandate ${label(d.fundFit.mandate)}${d.fundFit.index !== null ? ` · index ${Math.round(d.fundFit.index)}` : ""}`, refs: ["calc:scores"], origin: "COMPUTED" },
        { k: "Base case", v: base ? `${multiple(base.grossMoic)} gross MOIC, ${irr(base.grossIrr)} gross IRR` : "Not modelable (entry valuation unknown)", refs: ["calc:returns"], origin: "COMPUTED" },
        { k: "Financing risk", v: label(d.financing.risk), refs: ["calc:returns"], origin: "COMPUTED" },
      ],
    });
    b.push({ kind: "note", tone: "neutral", text: "Indices are conventional 0–100 scales for comparison, not probabilities. Scenarios are not probability-weighted. Analytical recommendation only; the IC decision is recorded separately." });

    const dc = c.decisionCore;
    b.push({ kind: "h3", text: "Decision core (analysis)" });
    if (dc)
      b.push({
        kind: "facts",
        rows: [
          { k: "The bet", v: dc.compression.bet, refs: known(refsIn(dc.compression.bet)), origin: "MODEL" },
          { k: "Exceptional strength", v: dc.compression.exceptionalStrength, refs: known(refsIn(dc.compression.exceptionalStrength)), origin: "MODEL" },
          { k: "Breaking point", v: dc.compression.breakingPoint, refs: known(refsIn(dc.compression.breakingPoint)), origin: "MODEL" },
          { k: "Return path", v: dc.compression.returnPath, refs: known(refsIn(dc.compression.returnPath)), origin: "MODEL" },
        ],
      });
    else if (c.thesis)
      b.push({
        kind: "facts",
        rows: [
          { k: "The bet", v: c.thesis.bet, refs: known(refsIn(c.thesis.bet)), origin: "MODEL" },
          { k: "Fatal weakness", v: c.thesis.fatalWeakness, refs: known(refsIn(c.thesis.fatalWeakness)), origin: "MODEL" },
          { k: "Return path", v: c.thesis.returnPath, refs: known(refsIn(c.thesis.returnPath)), origin: "MODEL" },
        ],
      });
    else b.push({ kind: "p", text: "No decision core or thesis in this version." });

    b.push({ kind: "h3", text: "What decides it — ranked by code" });
    if (focus) {
      b.push({ kind: "p", text: focus.headline });
      if (focus.determinants.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["#", "Kind", "Determinant", "Status", "Leverage"],
          rows: focus.determinants.map((x, i) => ({ cells: [String(i + 1), label(x.kind), x.label, label(x.status), x.leverage.toFixed(0)], refs: known([...x.refs, "calc:focus"]) })),
          align: ["right", "left", "left", "left", "right"],
          widths: ["28px", "90px", null, "120px", "70px"],
          caption: `${focus.rule} ${focus.considered} items considered.`,
        });
      const ma = focus.modelAgreement;
      if (ma)
        b.push({
          kind: "bullets",
          items: [
            { text: `Code and analysis agree on: ${ma.agreed.length ? ma.agreed.map((x) => clip(x, 90)).join("; ") : "none"}.`, refs: ["calc:focus"], origin: "COMPUTED" },
            { text: `Ranked by code only: ${ma.codeOnly.length ? ma.codeOnly.map((x) => clip(x, 90)).join("; ") : "none"}.`, refs: ["calc:focus"], origin: "COMPUTED" },
            { text: `Named by the analysis only: ${ma.modelOnly.length ? ma.modelOnly.map((x) => clip(stripRefs(x), 90)).join("; ") : "none"}.`, refs: ["calc:focus"], origin: "COMPUTED" },
          ],
        });
      else b.push({ kind: "p", text: "The analysis recorded no decision core to compare with the code ranking." });
      if (focus.outlierCandidates.length) b.push({ kind: "bullets", items: focus.outlierCandidates.map((o) => ({ text: `Outlier candidate: ${o.label} — ${o.basis}`, refs: known([...o.refs, "calc:focus"]), origin: "COMPUTED" as DdOrigin })), tone: "ok" });
    } else b.push({ kind: "note", tone: "neutral", text: `Decision focus: ${NOT_COMPUTED}` });

    b.push({ kind: "h3", text: "Question that could reverse the decision" });
    const rq = focus?.reversingQuestion ?? null;
    const drq = dc?.reversingQuestion ?? null;
    if (rq || drq) {
      const rows: DdFact[] = [];
      if (rq) rows.push({ k: rq.source === "QUESTIONS" ? "Most tied open question (code)" : "Reversing question (analysis)", v: `${rq.id ? `${rq.id} ` : ""}${rq.question}${rq.linkedTo ? ` — linked to “${clip(rq.linkedTo, 100)}”` : ""}`, refs: known([rq.id, "calc:focus"]), origin: "COMPUTED" });
      if (drq) {
        if (!rq || rq.source !== "MODEL") rows.push({ k: "Reversing question (analysis)", v: drq.question, refs: known(refsIn(drq.question)), origin: "MODEL" });
        rows.push({ k: "If favourable", v: drq.ifFavorable, refs: known(refsIn(drq.ifFavorable)), origin: "MODEL" });
        rows.push({ k: "If unfavourable", v: drq.ifUnfavorable, refs: known(refsIn(drq.ifUnfavorable)), origin: "MODEL" });
      }
      b.push({ kind: "facts", rows });
    } else b.push({ kind: "p", text: "No reversing question recorded." });

    const unknowns = [...(dc ? [] : ["Decision core (analysis) — not produced for this version"]), ...(focus ? [] : ["Code-ranked decision focus — not computed for this version"]), ...(dc?.determinants ?? []).filter((x) => x.status === "UNKNOWN").map((x) => `${clip(stripRefs(x.fact), 140)} (determinant, unknown)`)];
    push("decision", "Decision summary", b, { computed: true, unknowns });
  }

  /* ------------------------------------------------------------ */
  /* 3. Evidence ledger summary                                     */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const ev = d.evidence;
    b.push({
      kind: "facts",
      rows: [
        { k: "Evidence quality", v: `${label(ev.category)} (index ${Math.round(ev.index)} / 100, not a probability)`, refs: ["calc:evidence"], origin: "COMPUTED" },
        { k: "Material claims", v: `${ev.materialClaims}: ${ev.verifiedMaterial} verified, ${ev.contradictedMaterial} contradicted, ${ev.companyOnlyMaterial} company-only; ${ev.independentConfirmations} independent confirmations`, refs: ["calc:evidence"], origin: "COMPUTED" },
      ],
    });
    if (integ) {
      const debt = integ.evidenceDebt;
      b.push({ kind: "h3", text: "Evidence debt" });
      b.push({
        kind: "table",
        origin: "COMPUTED",
        head: ["Area", "Items", "Verified", "Indep. supported", "Company-only", "Contradicted", "Debt"],
        rows: debt.areas.map((ar) => ({
          cells: [label(ar.area), String(ar.items), String(ar.verified), String(ar.independentlySupported), String(ar.companyOnly), String(ar.contradicted), ar.level ? label(ar.level) : "—"],
          refs: known([...debt.topDebt.filter((t) => t.area === ar.area).map((t) => t.ref).slice(0, 4), "calc:integrity"]),
        })),
        align: ["left", "right", "right", "right", "right", "right", "left"],
        caption: `Overall ${debt.overall ? label(debt.overall).toLowerCase() : "not assessable"}${debt.overallCompanyOnlyWeightedShare !== null ? ` (weighted company-only share ${pct(debt.overallCompanyOnlyWeightedShare * 100, 0)})` : ""}. Rule: ${debt.rule}`,
      });
      const vp = integ.verificationPriority.items.slice(0, 10);
      b.push({ kind: "h3", text: "Verification priority" });
      if (vp.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["#", "Claim", "Statement", "Index", "Pages"],
          rows: vp.map((x, i) => ({ cells: [String(i + 1), x.claimId, clip(x.statement, 170), String(x.index), x.pages.join(", ") || "—"], refs: known([x.claimId, "calc:integrity"]) })),
          align: ["right", "left", "left", "right", "right"],
          widths: ["28px", "76px", null, "56px", "56px"],
          caption: `${integ.verificationPriority.formula} Ranks what to verify first; not a probability.`,
        });
      else b.push({ kind: "p", text: "No unverified material claim to prioritise." });
      b.push({ kind: "h3", text: "Contradictions, ranked" });
      if (integ.contradictions.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["Severity", "Class", "Contradiction"],
          rows: integ.contradictions.slice(0, 12).map((x) => ({ cells: [label(x.severity), label(x.class), clip(x.title, 200)], refs: known([...x.claimIds, ...x.metricIds, ...x.sourceIds, "calc:integrity"]) })),
          widths: ["90px", "140px", null],
        });
      else b.push({ kind: "p", text: "No contradiction detected by the integrity engine." });

      b.push({ kind: "h3", text: "Source reliability and freshness" });
      const rel = integ.sourceReliability;
      const tiers = uniq(rel.map((r) => r.tier));
      const flagged = rel.filter((r) => r.flags.length || r.tier === "LOW_QUALITY" || r.tier === "UNKNOWN");
      b.push({
        kind: "facts",
        rows: [
          { k: "Sources by tier", v: rel.length ? tiers.map((t) => `${label(t)} ${rel.filter((r) => r.tier === t).length}`).join(" · ") : "No source assessed", refs: known([...rel.map((r) => r.sourceId).slice(0, 6), "calc:integrity"]), origin: "COMPUTED" },
          {
            k: "Claim freshness",
            v: `${c.claims.filter((x) => x.freshness === "CURRENT").length} current, ${c.claims.filter((x) => x.freshness === "AGING").length} aging, ${c.claims.filter((x) => x.freshness === "STALE").length} stale`,
            refs: known([...c.claims.filter((x) => x.freshness !== "CURRENT").map((x) => x.id).slice(0, 6), "calc:evidence"]),
            origin: "RECORD",
          },
          { k: "Unverified web citations", v: `${c.sources.filter((s) => s.kind === "WEB" && !s.citationVerified).length} of ${c.sources.filter((s) => s.kind === "WEB").length} web sources`, refs: known([...c.sources.filter((s) => s.kind === "WEB" && !s.citationVerified).map((s) => s.id).slice(0, 6), "calc:evidence"]), origin: "RECORD" },
        ],
      });
      if (flagged.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["Source", "Domain", "Tier", "Flags", "Age"],
          rows: flagged.slice(0, 12).map((r) => ({ cells: [r.sourceId, r.domain ?? "—", label(r.tier), r.flags.map(label).join(", ") || "—", r.ageMonths !== null ? `${r.ageMonths.toFixed(0)} mo` : "—"], refs: known([r.sourceId, "calc:integrity"]) })),
          align: ["left", "left", "left", "left", "right"],
          widths: ["70px", "150px", "130px", null, "56px"],
        });
    } else b.push({ kind: "note", tone: "neutral", text: `Evidence debt, verification priority, contradictions and source reliability: ${NOT_COMPUTED}` });

    b.push({ kind: "h3", text: "Security flags" });
    const flags = dedupeSecurityFlags(a.securityFlags);
    if (flags.length)
      b.push({
        kind: "note",
        tone: "warn",
        title: `${flags.length} instruction-like passage${flags.length === 1 ? "" : "s"} found in the materials — treated as data, never followed`,
        text: flags.slice(0, 6).map((f) => `${f.location}: “${clip(f.excerpt.replace(/\s+/g, " "), 140)}”`).join(" · "),
      });
    else b.push({ kind: "p", text: "No instruction-like text was found in the materials." });
    push("evidence", "Evidence ledger summary", b, {
      computed: true,
      notComputed: false,
      unknowns: [
        ...(integ ? [] : ["Evidence debt and verification priority — not computed for this version"]),
        ...c.claims.filter((x) => x.material && x.verification === "UNVERIFIED").slice(0, 6).map((x) => `${x.id} ${clip(x.statement, 120)} — unverified`),
      ],
    });
  }

  /* ------------------------------------------------------------ */
  /* 4a. Company & product                                          */
  /* ------------------------------------------------------------ */
  {
    const p = c.product;
    const b: DdBlock[] = [];
    if (c.identity.oneLiner) b.push({ kind: "lead", text: c.identity.oneLiner });
    const known4: DdFact[] = [];
    const missing: string[] = [];
    const add = (k: string, v: string | null) => (v ? known4.push({ k, v, refs: [], origin: "META" }) : missing.push(k.toLowerCase()));
    add("Legal name", c.identity.legalName);
    add("Headquarters", c.identity.hqCountry);
    add("Founded", c.identity.foundedYear ? String(c.identity.foundedYear) : null);
    add("Website", c.identity.website);
    known4.push({ k: "Classification", v: [cl.industry.map(label).join(", "), cl.productType.map(label).join(", "), cl.revenueModel.map(label).join(", ")].filter(Boolean).join(" · ") || "—", refs: [], origin: "META" });
    known4.push({ k: "Maturity", v: `${label(cl.operationalMaturity)}${cl.declaredStage ? ` (declared “${cl.declaredStage}”)` : ""}`, refs: [], origin: "META" });
    b.push({ kind: "facts", rows: known4 });
    if (p) {
      b.push({ kind: "h3", text: "Product" });
      b.push({ kind: "p", text: p.plainExplanation || `${p.whatItIs} ${p.whatItDoes}` });
      b.push({
        kind: "facts",
        rows: [
          { k: "What it is", v: p.whatItIs, refs: known(refsIn(p.whatItIs)), origin: "MODEL" },
          { k: "What it does", v: p.whatItDoes, refs: known(refsIn(p.whatItDoes)), origin: "MODEL" },
          { k: "User · buyer", v: `${p.user} · ${p.buyer}`, refs: [], origin: "MODEL" },
          { k: "Workflow change", v: p.workflowChange, refs: known(refsIn(p.workflowChange)), origin: "MODEL" },
          ...(p.before.length || p.after.length ? [{ k: "Before → with the product", v: `${p.before.join(" → ") || "—"} ⟶ ${p.after.join(" → ") || "—"}`, refs: [], origin: "MODEL" as DdOrigin }] : []),
        ],
      });
      if (p.valueQuantification.length)
        b.push({
          kind: "table",
          origin: "MODEL",
          head: ["Value", "Statement", "Evidence status"],
          rows: p.valueQuantification.map((v) => ({ cells: [label(v.kind), `${v.statement}${v.baseline ? ` (baseline: ${v.baseline})` : ""}`, label(v.evidenceStatus)], refs: known(refsIn(`${v.statement} ${v.source ?? ""}`)) })),
          widths: ["130px", null, "140px"],
          caption: "Value claims as analysed; only MEASURED values rest on data.",
        });
    }
    const fz = c.forensics;
    if (fz) b.push({ kind: "facts", rows: [{ k: "Product proof (deck forensics)", v: `${label(fz.productProof.level)} — ${fz.productProof.evidence}`, refs: known(refsIn(fz.productProof.evidence)), origin: "MODEL" }] });
    push("company", "Company & product", b, {
      missing: !p,
      unknowns: [
        ...(missing.length ? [`Not disclosed: ${missing.join(", ")}`] : []),
        ...(p?.valueQuantification ?? []).filter((v) => v.evidenceStatus === "UNSUPPORTED" || v.evidenceStatus === "COMPANY_CLAIMED").map((v) => `${label(v.kind)} value — ${label(v.evidenceStatus).toLowerCase()}`),
        ...gapsFor("PRODUCT", "COMPANY"),
        ...(p ? [] : ["Product section — not analysed in this version"]),
      ],
    });
  }

  /* ------------------------------------------------------------ */
  /* 4b. Customers & pain                                           */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    if (c.pain) {
      b.push({ kind: "p", text: c.pain.assessment });
      b.push({
        kind: "facts",
        rows: [
          { k: "Demand type", v: label(c.pain.demandType), refs: [], origin: "MODEL" },
          { k: "Frequency · severity", v: `${c.pain.frequency} · ${c.pain.severity}`, refs: known(refsIn(`${c.pain.frequency} ${c.pain.severity}`)), origin: "MODEL" },
          { k: "Economic cost", v: c.pain.economicCost, refs: known(refsIn(c.pain.economicCost)), origin: "MODEL" },
          { k: "Urgency · budget", v: `${c.pain.urgency} · ${c.pain.existingBudget}`, refs: known(refsIn(`${c.pain.urgency} ${c.pain.existingBudget}`)), origin: "MODEL" },
          { k: "Alternative today", v: c.pain.alternativeBehavior, refs: known(refsIn(c.pain.alternativeBehavior)), origin: "MODEL" },
        ],
      });
    }
    const cu = c.customers;
    if (cu) {
      b.push({ kind: "h3", text: "Customers" });
      b.push({ kind: "facts", rows: [{ k: "ICP", v: cu.icp, refs: [], origin: "MODEL" }, { k: "Segments", v: cu.segments.join("; ") || "—", refs: [], origin: "MODEL" }, { k: "References", v: cu.referencesNote, refs: known(refsIn(cu.referencesNote)), origin: "MODEL" }] });
      if (cu.namedCustomers.length)
        b.push({
          kind: "table",
          origin: "RECORD",
          head: ["Named customer", "Relationship", "Highest evidence level", "Note"],
          rows: cu.namedCustomers.map((n) => ({ cells: [n.name, label(n.relationship), label(n.evidenceLevel), n.note ?? "—"], refs: known(refsIn(n.note)) })),
          widths: ["150px", "120px", "150px", null],
          caption: "A logo on a slide is LOGO_ONLY. Reference calls are in the work plan.",
        });
    }
    const conc = pick(["customer_concentration_top1", "customer_concentration_top5", "paying_customers"]);
    if (conc.length) b.push(metricTable(conc, cu?.concentrationNote ? `Concentration: ${cu.concentrationNote}` : "Concentration not described beyond these metrics."));
    push("customers", "Customers & pain", b, {
      missing: !c.pain && !cu,
      unknowns: [
        ...(cu?.namedCustomers ?? []).filter((n) => n.evidenceLevel === "LOGO_ONLY" || n.evidenceLevel === "UNKNOWN").map((n) => `${n.name} — ${label(n.evidenceLevel).toLowerCase()}`),
        ...(cu?.concentrationNote ? [] : ["Customer concentration"]),
        ...gapsFor("CUSTOMER"),
        ...missingExpected(/customer|reference/i),
      ],
    });
  }

  /* ------------------------------------------------------------ */
  /* 4c. PMF — measured vs claimed                                  */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const measured = pick(PMF_KEYS);
    b.push({ kind: "h3", text: "Measured signals (metrics with lineage)" });
    b.push(measured.length ? metricTable(measured, "Measured = a metric in the record; its evidence label says whether anyone other than the company has confirmed it.") : { kind: "p", text: "No retention, conversion or usage metric is in the record: product–market fit is not measured." });
    b.push({ kind: "h3", text: "Claimed and interpreted signals" });
    if (c.pmf) {
      b.push({ kind: "p", text: c.pmf.assessment });
      const sig = c.pmf.signals.filter((s) => s.direction !== "UNKNOWN");
      if (sig.length)
        b.push({
          kind: "table",
          origin: "MODEL",
          head: ["Signal", "Direction", "Evidence"],
          rows: sig.map((s) => ({ cells: [label(s.signal), label(s.direction), s.evidence], refs: known([...s.claimRefs, ...refsIn(s.evidence)]) })),
          widths: ["150px", "100px", null],
        });
      b.push({ kind: "facts", rows: [{ k: "Cohorts older than 12 months", v: c.pmf.olderCohortEvidence ?? "No evidence from customers older than 12 months.", refs: known(refsIn(c.pmf.olderCohortEvidence)), origin: "MODEL" }] });
    } else b.push({ kind: "p", text: "Not analysed in this version." });
    push("pmf", "Product–market fit — measured vs claimed", b, {
      missing: !c.pmf && !measured.length,
      unknowns: [...(c.pmf?.signals ?? []).filter((s) => s.direction === "UNKNOWN").map((s) => `${label(s.signal)} — no evidence`), ...unknownMetrics(PMF_KEYS), ...missingExpected(/cohort|retention|churn/i)],
    });
  }

  /* ------------------------------------------------------------ */
  /* 4d. Traction & chronology                                      */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const ms = pick(TRACTION_KEYS);
    b.push(ms.length ? metricTable(ms) : { kind: "p", text: "No traction metrics were disclosed." });
    if ((d.smallSampleWarnings ?? []).length) b.push({ kind: "note", tone: "warn", title: "Small-sample caution", text: d.smallSampleWarnings.map((w) => `${w.label} (${w.metricId}): ${w.detail.replace(/_/g, " ").toLowerCase()}`).join("; "), refs: known(d.smallSampleWarnings.map((w) => w.metricId)) });
    const ch = integ?.chronology;
    if (ch) {
      const docSources = c.sources.filter((s) => s.kind === "DOCUMENT");
      const rowOf = (r: (typeof ch.current)[number]) => {
        const m = c.metrics.find((x) => x.metricKey === r.metricKey && x.periodEnd === r.periodEnd && x.basis === r.basis) ?? c.metrics.find((x) => x.metricKey === r.metricKey && x.periodEnd === r.periodEnd);
        return {
          cells: [r.label, label(r.basis), r.periodEnd ?? r.periodStart ?? "—", chronoValue(r.unit, r.value, r.currency), r.page !== null ? `p. ${r.page}` : "—"],
          refs: known([m?.id, ...(docSources.length === 1 ? [docSources[0]!.id] : []), "calc:integrity"]),
        };
      };
      b.push({ kind: "h3", text: "Chronology — actual vs signed vs forecast" });
      const groups: [string, typeof ch.current][] = [
        ["Actual / current", ch.current],
        ["Contracted / signed", ch.contracted],
        ["Forward (forecast, target, pipeline)", ch.forward],
      ];
      for (const [title, rows] of groups) {
        if (!rows.length) {
          b.push({ kind: "p", text: `${title}: none in the materials.` });
          continue;
        }
        b.push({ kind: "table", origin: "RECORD", head: [title, "Basis", "Period", "Value", "Page"], rows: rows.slice(0, 14).map(rowOf), align: ["left", "left", "right", "right", "right"], widths: [null, "90px", "90px", "96px", "56px"] });
      }
      if (ch.hockeySticks.length)
        b.push({
          kind: "note",
          tone: "warn",
          title: "Forecast vs trailing growth",
          text: ch.hockeySticks.map((h) => `${metricDef(h.metricKey)?.shortName ?? h.metricKey}: forecast CAGR ${pct(h.forecastCagrPct, 0)} vs trailing ${h.trailingGrowthPct !== null ? pct(h.trailingGrowthPct, 0) : "unknown"}${h.ratio !== null ? ` (${h.ratio.toFixed(1)}×)` : ""}${h.pages.length ? `, p. ${h.pages.join(", ")}` : ""}`).join("; "),
          refs: known([...ch.hockeySticks.map((h) => pm(h.metricKey)?.id), "calc:integrity"]),
        });
    } else b.push({ kind: "note", tone: "neutral", text: `Chronology: ${NOT_COMPUTED}` });
    push("traction", "Traction & chronology", b, { unknowns: [...unknownMetrics(TRACTION_KEYS), ...missingExpected(/arr|revenue|growth|traction|bridge/i)] });
  }

  /* ------------------------------------------------------------ */
  /* 4e. GTM                                                        */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const g = c.gtm;
    if (g) {
      b.push({ kind: "p", text: g.assessment || g.salesMotion });
      b.push({
        kind: "facts",
        rows: [
          { k: "User · buyer · economic buyer", v: `${g.user} · ${g.buyer} · ${g.economicBuyer}`, refs: [], origin: "MODEL" },
          { k: "Sales motion", v: g.salesMotion, refs: known(refsIn(g.salesMotion)), origin: "MODEL" },
          { k: "Channels", v: g.channels.join("; ") || "—", refs: known(g.channels.flatMap(refsIn)), origin: "MODEL" },
          { k: "Sales cycle", v: g.salesCycle ?? NOT_DISCLOSED, refs: known([...refsIn(g.salesCycle), ...mref("sales_cycle_days")]), origin: "MODEL" },
          { k: "Founder-led sales", v: g.founderLedAssessment || "—", refs: known(refsIn(g.founderLedAssessment)), origin: "MODEL" },
        ],
      });
    }
    const ms = pick(GTM_KEYS);
    if (ms.length) b.push(metricTable(ms));
    if (c.causalModel) b.push({ kind: "note", tone: "neutral", title: `Bottleneck (causal model): ${label(c.causalModel.bottleneck.stage)}`, text: `${c.causalModel.bottleneck.statement} ${c.causalModel.bottleneck.evidence}`, refs: known(refsIn(c.causalModel.bottleneck.evidence)) });
    push("gtm", "Go-to-market", b, { missing: !g && !ms.length, unknowns: [...unknownMetrics(GTM_KEYS), ...missingExpected(/pipeline|funnel|gtm|sales/i), ...(g?.salesCycle ? [] : ["Sales cycle"])] });
  }

  /* ------------------------------------------------------------ */
  /* 4f. Unit economics                                             */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    if (c.businessModel) b.push({ kind: "facts", rows: [{ k: "How it makes money", v: c.businessModel.howItMakesMoney, refs: known(refsIn(c.businessModel.howItMakesMoney)), origin: "MODEL" }, { k: "Pricing", v: c.businessModel.pricing ?? NOT_DISCLOSED, refs: known(refsIn(c.businessModel.pricing)), origin: "MODEL" }] });
    if (c.economicsNotes) b.push({ kind: "p", text: c.economicsNotes });
    const ms = pick(ECON_KEYS);
    b.push(ms.length ? metricTable(ms) : { kind: "p", text: "No unit-economics metric is in the record." });
    if (integ) {
      const im = integ.impliedMetrics.filter((x) => x.verdict !== "UNVERIFIABLE" || x.statedValue !== null);
      b.push({ kind: "h3", text: "Implied metrics (recomputed by the integrity engine from the deck's own numbers)" });
      if (im.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["Implied", "Formula", "Implied value", "Stated", "Δ", "Verdict"],
          rows: im.map((x) => ({
            cells: [label(x.name), x.formula, implValue(x.unit, x.impliedValue), implValue(x.unit, x.statedValue), x.deltaPct !== null ? pct(x.deltaPct, 1) : "—", `${label(x.verdict)}${x.severity ? ` · ${label(x.severity).toLowerCase()}` : ""}`],
            refs: known([...x.inputs, "calc:integrity"]),
          })),
          align: ["left", "left", "right", "right", "right", "left"],
          widths: ["120px", null, "96px", "96px", "60px", "130px"],
          caption: `Unverifiable (missing inputs): ${integ.impliedMetrics.filter((x) => x.verdict === "UNVERIFIABLE" && x.statedValue === null).map((x) => label(x.name)).join(", ") || "none"}.`,
        });
      else b.push({ kind: "p", text: "No implied metric could be computed from the materials." });
    } else b.push({ kind: "note", tone: "neutral", text: `Implied metrics: ${NOT_COMPUTED}` });
    push("unit-economics", "Unit economics", b, { missing: !c.businessModel && !ms.length, unknowns: [...unknownMetrics(ECON_KEYS), ...["cac", "gross_margin", "cac_payback_months", "burn_multiple"].filter((k) => !pm(k)).map((k) => `${metricDef(k)?.shortName ?? k} — not disclosed`)] });
  }

  /* ------------------------------------------------------------ */
  /* 4g. Market                                                     */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const mk = d.market;
    if (c.market) b.push({ kind: "p", text: c.market.currentMarket }, { kind: "facts", rows: [{ k: "Wedge", v: c.market.wedge, refs: known(refsIn(c.market.wedge)), origin: "MODEL" }] });
    if (mk.ranges.length)
      b.push({
        kind: "table",
        origin: "COMPUTED",
        head: ["Method", "Low", "High", "Formula"],
        rows: mk.ranges.map((r) => ({ cells: [`${label(r.method)}${mk.primary?.method === r.method ? " (primary)" : ""}`, usd(r.lowUsd), usd(r.highUsd), r.formula], refs: known([...refsIn(r.formula), "calc:market"]) })),
        align: ["left", "right", "right", "left"],
        widths: ["150px", "80px", "80px", null],
        caption: "Reconstructed by code from analysed assumptions; the deck TAM is never accepted as the market size.",
      });
    else b.push({ kind: "p", text: "The market could not be reconstructed from the analysed assumptions." });
    const rows: DdFact[] = [];
    if (mk.deckTamUsd) rows.push({ k: "Deck TAM vs reconstruction", v: `${usd(mk.deckTamUsd)}${mk.deckInflation ? ` = ${mk.deckInflation.toFixed(1)}× the reconstructed upper bound` : ""}`, refs: ["calc:market"], origin: "COMPUTED" });
    if (mk.methodDivergence && mk.methodDivergence > 10) rows.push({ k: "Method divergence", v: `${mk.methodDivergence > 1000 ? "over 1,000" : mk.methodDivergence.toFixed(0)}× spread between the lowest and highest bound`, refs: ["calc:market"], origin: "COMPUTED" });
    const ms = div?.factors.find((f) => f.id === "MARKET_STRUCTURE");
    if (ms) rows.push({ k: "Structure (not size)", v: `${label(ms.level)} · ${label(ms.reading)} — ${ms.why}`, refs: known([...ms.evidence.flatMap((e) => e.refs), "calc:divergence"]), origin: "COMPUTED" });
    if (c.market) {
      rows.push({ k: "Deck TAM assessment", v: c.market.deckTamAssessment || "—", refs: known(refsIn(c.market.deckTamAssessment)), origin: "MODEL" });
      rows.push({ k: "Value capture", v: c.market.valueCaptureAnalysis.conclusion || "—", refs: known(refsIn(c.market.valueCaptureAnalysis.conclusion)), origin: "MODEL" });
      rows.push({ k: "Commoditisation", v: c.market.valueCaptureAnalysis.commoditizationRisk || "—", refs: known(refsIn(c.market.valueCaptureAnalysis.commoditizationRisk)), origin: "MODEL" });
      rows.push({ k: "Why now", v: c.market.whyNow || "—", refs: known(refsIn(c.market.whyNow)), origin: "MODEL" });
    }
    if (rows.length) b.push({ kind: "facts", rows });
    push("market", "Market", b, { computed: true, missing: !c.market && !mk.ranges.length, unknowns: [...(mk.primary ? [] : ["Reconstructed market size"]), ...(ms && ms.level !== "INSUFFICIENT_EVIDENCE" ? [] : ["Market structure — insufficient evidence"]), ...gapsFor("MARKET")] });
  }

  /* ------------------------------------------------------------ */
  /* 4h. Competition & moat                                         */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const cp = c.competition;
    if (cp) {
      b.push({
        kind: "table",
        origin: "MODEL",
        head: ["Competitor", "Type", "Description", "Scale"],
        rows: cp.competitors.map((x) => ({ cells: [x.name, label(x.type), clip(x.description, 150), x.scale ? clip(x.scale, 100) : "—"], refs: known([...x.sourceRefs, ...refsIn(x.scale)]) })),
        widths: ["120px", "96px", null, "24%"],
      });
      if (cp.adversarialTests.length) b.push({ kind: "table", origin: "MODEL", head: ["Adversarial test", "Outcome", "Verdict"], rows: cp.adversarialTests.map((t) => ({ cells: [label(t.test), clip(t.outcome, 220), label(t.verdict)], refs: known(refsIn(t.outcome)) })), widths: ["150px", null, "100px"] });
    }
    if (c.forensics?.competitiveSlide) b.push({ kind: "facts", rows: [{ k: "Honest comparison (deck forensics)", v: c.forensics.competitiveSlide.honestComparison, refs: known(refsIn(c.forensics.competitiveSlide.honestComparison)), origin: "MODEL" }] });
    if (c.moat.length)
      b.push(
        { kind: "h3", text: "Moat" },
        {
          kind: "table",
          origin: "MODEL",
          head: ["Dimension", "Today", "In 3 years", "What must happen"],
          rows: c.moat.filter((m) => m.current !== "NONE" || m.in3Years !== "NONE").map((m) => ({ cells: [label(m.dimension), label(m.current), label(m.in3Years), m.whatMustHappen], refs: known(refsIn(`${m.whatMustHappen} ${m.evidence}`)) })),
          widths: ["140px", "84px", "84px", null],
        },
      );
    push("competition", "Competition & moat", b, { missing: !cp && !c.moat.length, unknowns: [...gapsFor("COMPETITOR"), ...(cp?.competitors.filter((x) => !x.scale).map((x) => `${x.name} — scale unknown`).slice(0, 4) ?? [])] });
  }

  /* ------------------------------------------------------------ */
  /* 4i. Founders — capabilities, never pedigree                    */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [{ kind: "note", tone: "neutral", text: "Capabilities are read from observable evidence. Employer names, schools and titles are not evidence of capability and are not scored here." }];
    for (const f of c.founders) {
      b.push({ kind: "h3", text: `${f.name} — ${f.role}` });
      b.push({ kind: "facts", rows: [{ k: "Founder–market fit", v: f.founderMarketFit || "—", refs: known(refsIn(f.founderMarketFit)), origin: "MODEL" }] });
      const caps = f.capabilities.filter((x) => x.relevant);
      if (caps.length)
        b.push({
          kind: "table",
          origin: "MODEL",
          head: ["Capability", "Rating", "Observability", "Evidence"],
          rows: caps.map((x) => ({ cells: [label(x.dimension), label(x.rating), label(x.observability), clip(x.evidence, 220)], refs: known([...x.claimRefs, ...refsIn(x.evidence)]) })),
          widths: ["150px", "100px", "110px", null],
        });
      if (f.notObservableWithoutInterview.length) b.push({ kind: "bullets", items: f.notObservableWithoutInterview.map((t) => ({ text: `Not observable without interview: ${t}`, refs: [], origin: "MODEL" as DdOrigin })), tone: "warn" });
    }
    if (!c.founders.length && c.foundersFromDeck.length) b.push({ kind: "p", text: `Founders named in the deck: ${c.foundersFromDeck.map((f) => `${f.name} (${f.role})`).join(", ")}. Capabilities were not assessed in this version.` });
    const sk = c.forensics?.founderSlideSkepticism ?? [];
    if (sk.length) b.push({ kind: "table", origin: "MODEL", head: ["Founder", "Deck says", "What it actually shows", "Gap"], rows: sk.map((x) => ({ cells: [x.founder, clip(x.statement, 120), clip(x.whatItActuallyShows, 140), clip(x.gap, 140)], refs: [] })), widths: ["110px", null, null, null] });
    push("founders", "Founders — capabilities", b, {
      missing: !c.founders.length && !c.foundersFromDeck.length,
      unknowns: [
        ...c.founders.flatMap((f) => f.capabilities.filter((x) => x.relevant && (x.rating === "INSUFFICIENT_EVIDENCE" || x.observability === "NOT_OBSERVABLE")).map((x) => `${f.name}: ${label(x.dimension).toLowerCase()} — ${x.rating === "INSUFFICIENT_EVIDENCE" ? "insufficient evidence" : "not observable"}`)),
        ...(!c.founders.length ? ["Founder capabilities — not assessed"] : []),
        ...gapsFor("FOUNDER"),
      ],
    });
  }

  /* ------------------------------------------------------------ */
  /* 5a. Latent signals                                             */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [{ kind: "note", tone: "neutral", text: "Secondary, observable signals — never an honesty judgement and never part of the Operating Quality Index." }];
    if (c.realityCheck) b.push({ kind: "facts", rows: [{ k: "Ignoring the narrative", v: c.realityCheck, refs: known(refsIn(c.realityCheck)), origin: "MODEL" }] });
    if (latent) {
      if (latent.signalsForSynthesis.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["Signal", "Direction", "Basis", "Pages"],
          rows: latent.signalsForSynthesis.map((s) => ({ cells: [clip(s.signal, 220), label(s.direction), s.basis.map(label).join(" + "), s.pages.join(", ") || "—"], refs: known([...refsIn(s.evidence), "calc:signals"]) })),
          widths: [null, "90px", "150px", "70px"],
        });
      b.push({ kind: "facts", rows: [{ k: "Coverage", v: `${latent.coverage.modulesAssessed} of ${latent.coverage.modulesTotal} modules assessed`, refs: ["calc:signals"], origin: "COMPUTED" }] });
    } else b.push({ kind: "note", tone: "neutral", text: `Latent signals: ${NOT_COMPUTED}` });
    b.push({ kind: "h3", text: "What the deck reveals beyond the pitch" });
    if (c.revealedBeyondPitch.length) b.push({ kind: "bullets", items: c.revealedBeyondPitch.map((r) => ({ text: `${r.insight} — ${r.evidence} (${label(r.basis).toLowerCase()})`, refs: known(refsIn(r.evidence)), origin: "MODEL" as DdOrigin })) });
    else b.push({ kind: "p", text: "Nothing recorded for this version." });
    const na = c.forensics?.narrativeArchitecture;
    if (na) {
      b.push({ kind: "facts", rows: [{ k: "Belief the deck wants", v: na.beliefTheDeckWantsMeToHold, refs: [], origin: "MODEL" }] });
      if (na.absentDecisiveInformation.length) b.push({ kind: "bullets", items: na.absentDecisiveInformation.map((x) => ({ text: `Absent: ${x.what} — ${x.whyItMatters}`, refs: known(refsIn(x.whyItMatters)), origin: "MODEL" as DdOrigin })), tone: "warn" });
    }
    push("latent", "Latent signals & what the deck reveals", b, { notComputed: false, computed: true, missing: !latent && !c.revealedBeyondPitch.length, unknowns: [...(latent?.coverage.notes ?? []), ...(latent ? [] : ["Latent-signal report — not computed for this version"])] });
  }

  /* ------------------------------------------------------------ */
  /* 5b. Divergence factors                                         */
  /* ------------------------------------------------------------ */
  if (div) {
    const b: DdBlock[] = [
      { kind: "p", text: div.headline.sentence },
      {
        kind: "table",
        origin: "COMPUTED",
        head: ["#", "Factor", "Level", "Reading", "Why"],
        rows: div.factors.map((f) => ({ cells: [String(f.n), f.name, label(f.level), label(f.reading), clip(f.why, 200)], refs: known([...f.evidence.flatMap((e) => e.refs), "calc:divergence"]) })),
        widths: ["28px", "150px", "100px", "130px", null],
        caption: `Ordinal levels, no blended score, never an input to the Operating Quality Index. ${div.coverage.assessed} of ${div.coverage.total} factors assessed.`,
      },
    ];
    push("divergence", "Divergence factors", b, { computed: true, unknowns: [...div.factors.filter((f) => f.level === "INSUFFICIENT_EVIDENCE").map((f) => `${f.name} — insufficient evidence`), ...div.coverage.notes] });
  } else push("divergence", "Divergence factors", [{ kind: "note", tone: "neutral", text: `Divergence factors: ${NOT_COMPUTED}` }], { notComputed: true, unknowns: ["All ten divergence factors — not computed for this version"] });

  /* ------------------------------------------------------------ */
  /* 6. Financing & returns                                         */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const r = d.returns;
    b.push({
      kind: "facts",
      rows: [
        { k: "Instrument · raise", v: `${label(entry.instrument)}${entry.raiseUsd ? ` · ${usd(entry.raiseUsd, 2)}` : " · raise not disclosed"}`, refs: ["calc:returns"], origin: "COMPUTED" },
        { k: isSafe ? "Valuation cap used" : "Entry post-money used", v: entry.postMoneyUsd ? `${usd(entry.postMoneyUsd)} (${entry.source.toLowerCase()})` : NOT_DISCLOSED, refs: ["calc:returns"], origin: "COMPUTED" },
        { k: "Our check · reserves", v: `${usd(r.inputs.checkUsd, 2)} initial${r.inputs.followOn ? ` · pro-rata follow-on from ${usd(r.inputs.reserveUsd, 2)} reserves` : " · no follow-on"}`, refs: ["calc:returns"], origin: "COMPUTED" },
      ],
    });
    b.push({ kind: "h3", text: "Cap-table returns" });
    if (r.modelable)
      b.push({
        kind: "table",
        origin: "COMPUTED",
        head: ["Scenario", "Exit equity", "Invested", "Exit own.", "Proceeds", "MOIC", "IRR", "% of fund"],
        rows: r.scenarios.map((s) => ({
          cells: [`${SCEN[s.scenario] ?? s.scenario} (${s.years}y)`, usd(s.exitEquityUsd), usd(s.investedUsd, 2), pct(s.exitOwnershipPct, 2), `${usd(s.proceedsUsd, 2)}${s.preferenceBinding ? " †" : ""}`, multiple(s.grossMoic), irr(s.grossIrr), s.fundContributionPctOfFund !== null ? pct(s.fundContributionPctOfFund, 1) : "—"],
          refs: ["calc:returns"],
        })),
        align: ["left", "right", "right", "right", "right", "right", "right", "right"],
        caption: `Gross, before fees and carry; not probability-weighted. ${r.engine === "SIMPLIFIED" ? "Simplified model (cap-table model unavailable for this version)." : "Pro-forma cap-table model."} † liquidation preference binding.`,
      });
    else b.push({ kind: "note", tone: "warn", text: r.warnings.join(" ") || "Returns could not be modelled." });

    const ct = econ?.capTableReturns;
    b.push({ kind: "h3", text: "Ownership path and preference stack" });
    if (ct?.modelable && ct.scenarios.length) {
      b.push({
        kind: "table",
        origin: "COMPUTED",
        head: ["Scenario", "Entry own.", "Rounds", "Exit own.", "Preference stack at exit", "Preference binding"],
        rows: ct.scenarios.map((s) => ({ cells: [SCEN[s.scenario] ?? s.scenario, pct(s.entryOwnershipPct, 2), String(s.roundsRaised), pct(s.exitOwnershipPct, 2), usd(s.preferenceStackUsd, 1), s.preferenceBinding ? "Yes" : "No"], refs: ["calc:economics"] })),
        align: ["left", "right", "right", "right", "right", "left"],
      });
      const base = ct.scenarios.find((s) => s.scenario === "BASE");
      if (base?.ownershipPath.length) b.push({ kind: "table", origin: "COMPUTED", head: ["Base path step", "Month", "Our ownership"], rows: base.ownershipPath.map((p) => ({ cells: [p.label, String(p.month), pct(p.pct, 2)], refs: ["calc:economics"] })), align: ["left", "right", "right"] });
    } else b.push({ kind: "p", text: econ ? `Cap-table model not runnable: ${(ct?.reasons ?? econ.reasons).join(" ") || "financing terms incomplete"}.` : `Ownership path: ${NOT_COMPUTED}` });

    b.push({ kind: "h3", text: "Required trajectory" });
    if (econ) {
      for (const [name, t] of [
        ["Fund target", econ.trajectory.fundTarget],
        [`${econ.trajectory.capitalMultiple.target.multiple ?? 20}× our capital`, econ.trajectory.capitalMultiple],
      ] as const) {
        if (!t) continue;
        if (!t.modelable) {
          b.push({ kind: "p", text: `${name}: not modelable — ${t.reasons.join(" ")}` });
          continue;
        }
        const arr = t.current.revenueUsd !== null ? known([...mref("arr"), ...mref("revenue_ttm"), ...mref("mrr")]) : [];
        b.push({
          kind: "facts",
          rows: [
            { k: `${name} — question`, v: t.question, refs: ["calc:economics"], origin: "COMPUTED" },
            { k: "Required exit equity", v: `${usd(t.requiredExitEquityUsd)} at ${t.exitOwnershipPct !== null ? pct(t.exitOwnershipPct, 2) : "—"} exit ownership${t.preferenceStackAtExitUsd ? ` (preference stack ${usd(t.preferenceStackAtExitUsd)})` : ""}`, refs: ["calc:economics"], origin: "COMPUTED" },
            { k: "From today", v: `${t.current.revenueUsd !== null ? usd(t.current.revenueUsd, 2) : "revenue unknown"} (${t.current.revenueSource})${t.current.customers !== null ? ` · ${t.current.customers} customers` : ""}`, refs: known([...arr, ...mref("paying_customers"), "calc:economics"]), origin: "COMPUTED" },
            { k: "Plausibility", v: `${label(t.plausibility)} (conventional label, not a probability)`, refs: ["calc:economics"], origin: "COMPUTED" },
          ],
        });
        if (t.byMultiple.length)
          b.push({
            kind: "table",
            origin: "COMPUTED",
            head: ["Revenue multiple", "Required revenue", "CAGR", "Customers", "SAM share", "Plausibility"],
            rows: t.byMultiple.map((m) => ({ cells: [`${m.revenueMultiple}×`, usd(m.requiredRevenueUsd), m.requiredCagrPct !== null ? pct(m.requiredCagrPct, 0) : "—", m.requiredCustomers !== null ? m.requiredCustomers.toLocaleString("en-US") : "—", m.samSharePct !== null ? pct(m.samSharePct, 1) : "—", label(m.samPlausibility)], refs: known([...arr, "calc:economics"]) })),
            align: ["left", "right", "right", "right", "right", "left"],
          });
      }
      b.push({ kind: "bullets", items: econ.trajectory.fundTarget.summary.map((s) => ({ text: s, refs: ["calc:economics"], origin: "COMPUTED" as DdOrigin })) });

      b.push({ kind: "h3", text: "Sensitivity breakpoints — verify first" });
      const rows = econ.sensitivity.rows;
      const vf = econ.sensitivity.verifyFirst;
      if (rows.length)
        b.push({
          kind: "table",
          origin: "COMPUTED",
          head: ["Variable", "Now", "Breaks at", "Status", "Verify first"],
          rows: rows.map((x) => ({
            cells: [x.variable, sensValue(x.current, x.unit), sensValue(x.breaksAt, x.unit), breakpointStatus(x), vf.some((v) => v.startsWith(x.variable)) ? "Yes" : "—"],
            refs: known([...(x.metricKey ? mref(x.metricKey) : []), "calc:economics"]),
          })),
          align: ["left", "right", "right", "left", "left"],
          widths: [null, "96px", "96px", "150px", "74px"],
          caption: "Sorted by margin, most fragile first. Margin = distance to the breakpoint in the breaking direction, % of the current value.",
        });
      else b.push({ kind: "p", text: "No breakpoint computable from the record." });
      if (econ.counterfactuals.length) {
        b.push({ kind: "h3", text: "Counterfactuals" });
        b.push({ kind: "bullets", items: econ.counterfactuals.map((x) => ({ text: x.headline, refs: ["calc:economics"], origin: "COMPUTED" as DdOrigin })) });
      }
    } else b.push({ kind: "note", tone: "neutral", text: `Required trajectory, sensitivity breakpoints and counterfactuals: ${NOT_COMPUTED}` });

    b.push({ kind: "h3", text: "Financing risk" });
    const f = d.financing;
    const cashRefs = known([...mref("cash_balance"), ...mref("monthly_net_burn"), "calc:returns"]);
    b.push({
      kind: "facts",
      rows: [
        { k: "Cash · round · burn", v: `${usd(f.cashUsd, 2)} cash + ${usd(f.raiseUsd, 2)} round at ${usd(f.monthlyBurnUsd)}/month (${f.burnSource.toLowerCase()} burn)`, refs: cashRefs, origin: "COMPUTED" },
        { k: "Runway after round", v: f.runwayAfterRoundMonths !== null ? `${f.runwayAfterRoundMonths.toFixed(1)} months` : "Not computable", refs: cashRefs, origin: "COMPUTED" },
        { k: "Months required", v: f.requiredMonths !== null ? `${f.requiredMonths} (milestone ${f.milestoneMonths} + fundraising lead)` : "Not computable", refs: ["calc:returns"], origin: "COMPUTED" },
        { k: "Financing risk", v: `${label(f.risk)} — ${f.explanation}`, refs: ["calc:returns"], origin: "COMPUTED" },
      ],
    });
    if (c.financingPath) b.push({ kind: "facts", rows: [{ k: "Proof purchased", v: c.financingPath.proofPurchased, refs: known(refsIn(c.financingPath.proofPurchased)), origin: "MODEL" }, { k: "Could it die while right?", v: c.financingPath.financingRiskAssessment || "—", refs: known(refsIn(c.financingPath.financingRiskAssessment)), origin: "MODEL" }] });
    const t = c.financing?.terms;
    const undisclosed = t ? (["liquidationPreferenceMultiple", "participating", "antiDilution", "proRata", "boardRights"] as const).filter((k) => t[k] === null).map((k) => label(k.replace(/([A-Z])/g, "_$1").toUpperCase()).toLowerCase()) : ["all terms"];
    push("financing", "Financing & returns", b, { computed: true, unknowns: [...(undisclosed.length ? [`Undisclosed terms (modelled as 1× non-participating): ${undisclosed.join(", ")}`] : []), ...(entry.postMoneyUsd ? [] : ["Entry valuation"]), ...(f.burnSource === "UNKNOWN" ? ["Burn"] : []), ...gapsFor("FINANCING")] });
  }

  /* ------------------------------------------------------------ */
  /* 7. Risks                                                       */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const rk = d.risk;
    if (rk.thesisKillers.length) b.push({ kind: "note", tone: "risk", title: `Thesis-killing risk${rk.thesisKillers.length > 1 ? "s" : ""}`, text: rk.thesisKillers.map((r) => `${r.id} ${r.title} — ${r.description}`).join(" "), refs: known(rk.thesisKillers.flatMap((r) => [r.id, ...r.claimRefs])) });
    else b.push({ kind: "p", text: "No risk is classed as thesis-killing in this version." });
    if (c.risks.length)
      b.push({
        kind: "table",
        origin: "MODEL",
        head: ["ID", "Risk", "Category", "Severity · likelihood", "Class", "Timing"],
        rows: c.risks.map((r) => ({ cells: [r.id, r.title, label(r.category), `${label(r.severity)} · ${label(r.likelihood)}`, label(r.weaknessClass), label(r.timing)], refs: known([r.id, ...r.claimRefs]) })),
        widths: ["54px", null, "100px", "130px", "110px", "100px"],
        caption: `Risk filter index ${rk.filterIndex} / 100 (higher = riskier; not a probability).`,
      });
    if (rk.structural.length) b.push({ kind: "h3", text: "Structural" }, { kind: "bullets", items: rk.structural.map((r) => ({ text: `${r.id} ${r.title} — ${clip(r.description, 200)}`, refs: known([r.id, ...r.claimRefs]), origin: "MODEL" as DdOrigin })), tone: "warn" });
    const rep = c.risks.filter((r) => r.weaknessClass === "REPAIRABLE");
    if (rep.length)
      b.push(
        { kind: "h3", text: "Repairable — with repair plan (as stated by the analysis)" },
        {
          kind: "table",
          origin: "MODEL",
          head: ["Risk", "Repair: resources", "Time (stated)", "Difficulty"],
          rows: rep.map((r) => ({ cells: [`${r.id} ${r.title}`, r.repair?.resources ?? r.mitigation, r.repair?.time ?? "Not stated", r.repair ? label(r.repair.difficulty) : "—"], refs: known([r.id, ...r.claimRefs]) })),
          widths: [null, "34%", "100px", "90px"],
        },
      );
    if (c.redTeam) {
      b.push({ kind: "h3", text: "Red team — case against investing" }, { kind: "bullets", items: c.redTeam.caseAgainstInvesting.map((t) => ({ text: t, refs: known(refsIn(t)), origin: "MODEL" as DdOrigin })), tone: "risk" });
      b.push({ kind: "h3", text: "Red team — case against passing" }, { kind: "bullets", items: c.redTeam.caseAgainstPassing.map((t) => ({ text: t, refs: known(refsIn(t)), origin: "MODEL" as DdOrigin })), tone: "ok" });
      if (c.redTeam.passRegretScenario) b.push({ kind: "note", tone: "neutral", title: "Pass-regret scenario", text: c.redTeam.passRegretScenario });
    }
    if (c.alternativeExplanations.length)
      b.push(
        { kind: "h3", text: "Alternative explanations" },
        {
          kind: "table",
          origin: "MODEL",
          head: ["Signal", "Bullish reading", "Alternative reading", "Discriminating test"],
          rows: c.alternativeExplanations.map((x) => ({ cells: [x.signal, clip(x.bullishReading, 160), clip(x.alternativeReading, 160), clip(x.discriminatingTest, 180)], refs: known(refsIn(`${x.signal} ${x.bullishReading} ${x.alternativeReading} ${x.discriminatingTest}`)) })),
          widths: ["18%", null, null, null],
        },
      );
    const fals = c.falsification.flatMap((x) => x.falsifiers);
    if (fals.length) {
      const n = (s: string) => fals.filter((x) => x.status === s).length;
      b.push({ kind: "p", text: `Falsification: ${fals.length} falsifiers across ${c.falsification.length} thesis points — ${n("FOUND")} found, ${n("PARTIAL_SIGNAL")} partial signal, ${n("SEARCHED_NOT_FOUND")} searched and not found, ${n("NOT_TESTED")} not yet tested.` });
    }
    push("risks", "Risks", b, { unknowns: [...(c.redTeam ? [] : ["Red team — not produced for this version"]), ...(fals.some((x) => x.status === "NOT_TESTED") ? [`${fals.filter((x) => x.status === "NOT_TESTED").length} falsifier(s) not yet tested`] : []), ...gapsFor("REGULATORY")] });
  }

  /* ------------------------------------------------------------ */
  /* 8. Diligence work plan                                         */
  /* ------------------------------------------------------------ */
  {
    const p1 = plan.items.filter((x) => x.priority === "P1").length;
    const b: DdBlock[] = [
      {
        kind: "note",
        tone: plan.killCriteria.some((k) => k.basis === "THESIS_KILLER" || k.basis === "MANDATE_GATE") ? "risk" : "neutral",
        title: `${plan.items.length} requests in ${plan.workstreams.length} workstreams · ${p1} P1`,
        text: `Built by code from ${plan.considered} candidates in the stored record (${plan.merged} duplicates merged). Each request names who can answer it, the driver it resolves and the decision it unlocks. No cost or time estimate is shown: none is computable from the record.${["SCREEN_OUT", "ANALYTICAL_RECOMMEND_PASS"].includes(rec.status) ? ` The analytical recommendation is “${DECISION_LABEL[rec.status]}”: this plan lists what would have to be established to reopen the case.` : ""}`,
      },
      { kind: "workplan", plan },
      { kind: "h3", text: "How the plan is built" },
      { kind: "bullets", items: plan.rules.map((t) => ({ text: t, refs: [], origin: "META" as DdOrigin })) },
    ];
    if (plan.missingInputs.length) b.push({ kind: "note", tone: "warn", title: "Inputs absent on this version", text: plan.missingInputs.join("; ") });
    const refs = uniq(plan.items.flatMap((x) => x.refs));
    const base = evidenceOf([{ kind: "bullets", items: [{ text: "", refs, origin: "COMPUTED" }] }], { computed: true, unknowns: [] });
    S.push({
      id: "workplan",
      title: "Diligence work plan",
      blocks: b,
      evidence: { status: "COMPUTED", label: "Built by code from the record", detail: base.detail, unknowns: plan.items.length ? [] : ["Nothing in the record calls for diligence — itself worth checking against the depth flag."] },
    });
  }

  /* ------------------------------------------------------------ */
  /* 9. Meeting history                                             */
  /* ------------------------------------------------------------ */
  {
    const ms = meta.meetings ?? [];
    const b: DdBlock[] = [{ kind: "facts", rows: [{ k: "This version", v: `v${meta.versionNo} · ${meta.stageLabel ?? meta.stageCode ?? "stage not recorded"}`, refs: [], origin: "META" }] }];
    if (!ms.length) b.push({ kind: "p", text: "No founder meeting is recorded for this company. Pre- and post-meeting briefs appear here once a meeting is added (Meetings tab)." });
    else {
      b.push({
        kind: "table",
        origin: "META",
        head: ["#", "Meeting", "Held", "Pre-meeting analysis", "Post-meeting analysis", "Recommendation"],
        rows: ms.map((m) => ({
          cells: [String(m.seq), m.title, date(m.heldAt), m.pre.versionNo !== null ? `v${m.pre.versionNo} · ${m.pre.stageCode ?? "—"}` : "—", m.post?.versionNo ? `v${m.post.versionNo} · ${m.post.stageCode ?? "—"}` : label(m.status), m.recommendation ? `${DECISION_LABEL[m.recommendation.before] ?? m.recommendation.before} → ${DECISION_LABEL[m.recommendation.after] ?? m.recommendation.after}` : "—"],
          refs: [],
        })),
        widths: ["28px", null, "96px", null, null, null],
      });
      for (const m of ms) {
        b.push({ kind: "h3", text: `Meeting ${m.seq} — ${m.title}` });
        if (m.summary) b.push({ kind: "p", text: m.summary });
        if (m.changes.length) b.push({ kind: "bullets", items: m.changes.map((x) => ({ text: `${x.area} · ${x.dimension}: ${x.before ?? "—"} → ${x.after ?? "—"}`, refs: known([x.key]), origin: "MODEL" as DdOrigin })) });
        else if (m.post) b.push({ kind: "p", text: "No material change recorded." });
        if (m.unanswered !== null) b.push({ kind: "p", text: `${m.unanswered} question(s) left unanswered in the meeting.` });
        const links = [
          ...(m.preBriefId ? [{ label: "Pre-meeting brief", path: `meetings/pre-brief/${m.preBriefId}` }] : []),
          ...(m.postBriefId ? [{ label: "Post-meeting brief", path: `meetings/${m.id}/post-brief` }] : []),
          ...(m.post ? [{ label: "What changed", path: `meetings/${m.id}/changes` }] : []),
          { label: "Transcript", path: `meetings/${m.id}/transcript` },
        ];
        b.push({ kind: "links", items: links });
      }
    }
    S.push({ id: "meetings", title: "Meeting history", blocks: b, evidence: { status: "INTERPRETATION", label: ms.length ? "Founder statements (company-reported)" : "No meeting", detail: ms.length ? "Founder statements stay company-reported; post-meeting changes are guarded by code." : "No founder meeting recorded.", unknowns: ms.filter((m) => !m.post).map((m) => `Meeting ${m.seq} — post-meeting analysis not produced (${label(m.status).toLowerCase()})`) } });
  }

  /* ------------------------------------------------------------ */
  /* 10. Appendix                                                   */
  /* ------------------------------------------------------------ */
  {
    const b: DdBlock[] = [];
    const ms = [...c.metrics].sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.id.localeCompare(y.id, "en", { numeric: true }));
    b.push({ kind: "h3", text: `Metrics with lineage (${ms.length})` });
    if (ms.length)
      b.push({
        kind: "table",
        origin: "RECORD",
        head: ["ID", "Metric", "Value", "Period", "Basis", "Method", "Evidence", "Lineage"],
        rows: ms.map((m) => ({
          cells: [m.id, `${metricDef(m.metricKey)?.shortName ?? m.label}${m.isPrimary ? "" : " (secondary)"}`, metricValue(m.unit, m.normalizedValue), m.periodEnd ?? "—", label(m.basis), label(m.calculationMethod), metricEvidence(m).text, m.lineage.length ? m.lineage.map((l) => label(l.step)).join(" → ") : m.derivation ? clip(m.derivation, 80) : "Raw extraction"],
          refs: known([m.id, m.claimId, m.sourceId, ...m.inputs]),
        })),
        align: ["left", "left", "right", "right", "left", "left", "left", "left"],
        widths: ["64px", null, "86px", "72px", "72px", "84px", "110px", "22%"],
      });
    else b.push({ kind: "p", text: "No metric in the record." });
    b.push({ kind: "h3", text: `Claims with verification (${c.claims.length})` });
    if (c.claims.length)
      b.push({
        kind: "table",
        origin: "RECORD",
        head: ["ID", "Claim", "Label", "Origin", "Freshness", "Independence"],
        rows: c.claims.map((x: Claim) => ({ cells: [x.id, `${x.material ? "" : "(non-material) "}${clip(x.statement, 170)}`, EVIDENCE_LABEL_TEXT[evidenceLabel(x)] ?? x.verification, label(x.origin), label(x.freshness), label(x.independence)], refs: known([x.id, ...x.evidence.map((e) => e.sourceId)]) })),
        widths: ["64px", null, "110px", "110px", "76px", "110px"],
      });
    else b.push({ kind: "p", text: "No claim in the record." });
    b.push({ kind: "h3", text: `Sources (${c.sources.length})` });
    const tier = new Map((integ?.sourceReliability ?? []).map((r) => [r.sourceId, r]));
    if (c.sources.length)
      b.push({
        kind: "table",
        origin: "RECORD",
        head: ["ID", "Source", "Kind · origin", "Published", "Tier", "Citation"],
        rows: c.sources.map((s) => ({ cells: [s.id, clip(`${s.title}${s.publisher && s.publisher !== s.title ? ` — ${s.publisher}` : ""}`, 120), `${label(s.kind)} · ${label(s.origin)}`, s.publishedDate ?? "—", tier.get(s.id) ? label(tier.get(s.id)!.tier) : "—", s.citationVerified ? "Retrieved" : "Not verified"], refs: [s.id] })),
        widths: ["64px", null, "160px", "86px", "120px", "86px"],
      });
    else b.push({ kind: "p", text: "No source in the record." });
    push("appendix", "Appendix — metrics, claims, sources", b, { unknowns: c.metrics.filter((m) => m.state === "UNKNOWN" || m.state === "WITHHELD").map((m) => `${m.id} ${metricDef(m.metricKey)?.shortName ?? m.label} — ${label(m.state).toLowerCase()}`).slice(0, 8) });
  }

  return {
    company: c.identity.name,
    subtitle: [STAGE_LABEL[cl.financingStage], cl.industry.map(label).join(", "), c.identity.hqCountry, entry.raiseUsd ? `raising ${usd(entry.raiseUsd)}` : null, entry.postMoneyUsd ? `${usd(entry.postMoneyUsd)} ${isSafe ? "cap" : "post"}` : null].filter(Boolean).join(" · "),
    depth,
    sections: S,
    plan,
    meta,
  };
}

/* ---------------------------------------------------------------- */
/* Markdown export                                                    */
/* ---------------------------------------------------------------- */

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const refTag = (refs: string[]) => (refs.length ? ` [${refs.join(", ")}]` : "");

/** Markdown rendering of the same structured report (same strings, same refs). `base` prefixes deal-relative links. */
export function deepDdMarkdown(r: DeepDdReport, opts: { base?: string } = {}): string {
  const base = opts.base ?? "";
  const out: string[] = [];
  out.push(`# ${r.company} — Deep DD report`, "");
  if (r.subtitle) out.push(r.subtitle, "");
  out.push(`> ${r.depth.level === "OK" ? "Analysis depth" : "ANALYSIS DEPTH FLAG"}: ${r.depth.text}`, "");
  out.push(`Version v${r.meta.versionNo} · ${r.meta.stageCode ?? "stage not recorded"} · ${date(r.meta.createdAt)} · registry ${r.meta.registryId}${r.meta.historical ? " · historical version" : ""}`, "");
  out.push("Refs: MET-/CLM-/SRC-/RSK-/Q-/GAP- are record ids; calc:… names the engine view that computed the number. Indices are conventional scales, never probabilities.", "");
  r.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, "");
    out.push(`*Evidence: ${s.evidence.label} — ${s.evidence.detail}*`, "");
    out.push(s.evidence.unknowns.length ? `*Unknown: ${s.evidence.unknowns.join("; ")}*` : "*Unknown: nothing recorded for this section.*", "");
    for (const b of s.blocks) out.push(...blockMd(b, base), "");
  });
  out.push("---", "Generated deterministically from the stored canonical object and derived analysis of this version; no text was generated for this document. Analytical recommendation only; the IC decision is recorded separately.");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function blockMd(b: DdBlock, base: string): string[] {
  switch (b.kind) {
    case "lead":
    case "p":
      return [b.text];
    case "h3":
      return [`### ${b.text}`];
    case "bullets":
      return b.items.map((i) => `- ${i.text}${refTag(i.refs)}`);
    case "facts":
      return ["| | | Refs |", "|---|---|---|", ...b.rows.map((r) => `| ${cell(r.k)} | ${cell(r.v)} | ${r.refs.join(", ")} |`)];
    case "table":
      return [`| ${[...b.head, "Refs"].map(cell).join(" | ")} |`, `|${[...b.head, "Refs"].map(() => "---").join("|")}|`, ...b.rows.map((r) => `| ${[...r.cells, r.refs.join(", ")].map(cell).join(" | ")} |`), ...(b.caption ? ["", `*${b.caption}*`] : [])];
    case "note":
      return [`> ${b.title ? `**${b.title}.** ` : ""}${b.text}${refTag(b.refs ?? [])}`];
    case "decision":
      return [`**Analytical recommendation: ${b.label}** — ${b.detail}`];
    case "links":
      return [b.items.map((l) => `[${l.label}](${base ? `${base}/${l.path}` : l.path})`).join(" · ")];
    case "workplan": {
      const p = b.plan;
      const lines: string[] = ["### Kill criteria — what would make us stop"];
      if (p.killCriteria.length) p.killCriteria.forEach((k, i) => lines.push(`${i + 1}. ${k.text}${refTag(k.refs)} — ${k.origin === "MODEL" ? "analysis" : "computed"}${k.testedBy ? `; tested by ${k.testedBy}` : "; no request tests it yet"}`));
      else lines.push("No kill criterion is recorded: no thesis killer, failed gate, near breakpoint or breaking point in this version.");
      for (const w of p.workstreams) {
        lines.push("", `### ${w.label} — ${w.items.length} request${w.items.length > 1 ? "s" : ""}${w.p1 ? `, ${w.p1} P1` : ""}`);
        for (const it of w.items) {
          lines.push(`- **${it.id} · ${it.priority}** ${it.requests[0]}${refTag(it.refs)}`);
          for (const extra of it.requests.slice(1)) lines.push(`  - Also: ${extra}`);
          for (const sl of it.perfectSlides) lines.push(`  - Perfect slide: ${sl}`);
          lines.push(`  - Who can answer: ${it.answerers.map((a) => ANSWERER_LABEL[a]).join(", ")}`);
          lines.push(`  - Why it matters: ${it.why}`);
          lines.push(`  - Driver: ${driverText(it.driver)}${it.mergedFrom.length ? `; also ${it.mergedFrom.map(driverText).join("; ")}` : ""}`);
          if (it.breakpoints.length) lines.push(`  - Breakpoints: ${it.breakpoints.map((x) => `${x.variable} (${x.status})`).join("; ")}`);
          lines.push(`  - Unlocks: ${it.unlocks.join("; ")}`);
          lines.push(`  - Priority basis: ${it.leverageBasis}${it.binding ? " (binding)" : ""}`);
        }
      }
      return lines;
    }
  }
}

function driverText(dv: { kind: keyof typeof DRIVER_LABEL; label: string; refs: string[] }): string {
  return `${DRIVER_LABEL[dv.kind]} — ${clip(dv.label, 140)}${refTag(dv.refs)}`;
}
