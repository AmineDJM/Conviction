/**
 * 2. CAP TABLE HEALTH & INCENTIVE ALIGNMENT.
 *
 * Founder already over-diluted for the stage, a departed co-founder holding a
 * large stake, an insufficient pool, stacked SAFEs (conversion overhang),
 * heavy preferences, incompatible investors. The founder ownership path
 * through the next rounds is computed with the economics engine's pro-forma
 * cap table (buildProFormaPath) on the stated pre-round cap table; stage
 * benchmarks are a versioned MODEL_ASSUMPTION table.
 */
import { RETURN_SCENARIOS } from "@/domain/enums";
import type { FinancingStage } from "@/domain/enums";
import { entryTermsFromDeal } from "../returns";
import type { CapTable, Convertible, Holding, ShareClass } from "../calc/captable";
import { totalFdShares } from "../calc/captable";
import { asConvertedOwnership, buildProFormaPath, capConversionShares, POOL_HOLDER } from "../economics/captable-returns";
import { DEFAULT_ECONOMICS_ASSUMPTIONS } from "../economics/assumptions";
import type { EconomicsInputs, ExitSpec, Scenario } from "../economics/inputs";
import { DIVERGENCE_ASSUMPTIONS as A, FOUNDER_OWNERSHIP_BENCHMARKS, STAGE_ROUND_LABEL, founderBenchmarkFor } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, hasText, isFact, moneyUsd, num, pagesOfEvidence, pct1, round } from "./util";

export const ACTIVE_FOUNDERS = "Active founders";
export const DEPARTED_FOUNDERS = "Departed founders";
const PRIOR_INVESTORS = "Prior investors & others";
const S = 10_000_000;

export interface FounderPathRow {
  label: string;
  month: number;
  activeFounderPct: number;
  departedFounderPct: number;
  poolPct: number;
  benchmark: { round: string; typicalPct: number; floorPct: number } | null;
  belowFloor: boolean;
}

export interface CapTableFactor extends FactorBase {
  id: "CAP_TABLE_ALIGNMENT";
  points: number;
  activeFounderPct: number | null;
  departedFounderPct: number | null;
  poolAvailablePct: number | null;
  convertibleOverhangPct: number | null;
  outstandingConvertibles: number;
  distinctCaps: number;
  path: FounderPathRow[];
  pathNotes: string[];
  issues: { issue: string; points: number; basis: "COMPUTED" | "MODEL_OBSERVED" }[];
}

function convertibleFrom(i: number, c: { instrument: string; amount: { amount: number | null; currency: string; rawText: string } | null; valuationCap: { amount: number | null; currency: string; rawText: string } | null; discountPct: number | null }): Convertible | null {
  const amount = moneyUsd(c.amount);
  if (!amount || !(amount > 0)) return null;
  const cap = moneyUsd(c.valuationCap);
  const kind: Convertible["kind"] = c.instrument === "SAFE_PRE_MONEY" ? "SAFE_PRE_MONEY" : c.instrument === "CONVERTIBLE_NOTE" ? "CONVERTIBLE_NOTE" : "SAFE_POST_MONEY";
  return {
    holder: `Prior convertible ${i + 1}`,
    kind,
    principal: amount,
    valuationCap: cap && cap > 0 ? cap : null,
    discountPct: c.discountPct ?? null,
    ...(kind === "CONVERTIBLE_NOTE" ? { interestRatePct: DEFAULT_ECONOMICS_ASSUMPTIONS.noteInterestPct, yearsOutstanding: 1 } : {}),
  };
}

/** Pre-round cap table from the stated facts; the remainder is prior investors & others (1x non-participating). */
export function statedPreRoundCapTable(activePct: number, departedPct: number, poolPct: number, convertibles: Convertible[], priorRaisedUsd: number | null): { ct: CapTable; notes: string[] } {
  const notes: string[] = [];
  let a = Math.max(0, activePct);
  let d = Math.max(0, departedPct);
  let p = Math.max(0, poolPct);
  const sum = a + d + p;
  if (sum > 100) {
    notes.push(`Stated ownership sums to ${round(sum, 1)}% — rescaled to 100%.`);
    a = (a / sum) * 100;
    d = (d / sum) * 100;
    p = (p / sum) * 100;
  }
  const other = Math.max(0, 100 - a - d - p);
  const classes: ShareClass[] = [
    { name: "Common", type: "COMMON", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
    { name: "Option Pool", type: "OPTION_POOL", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
  ];
  const holdings: Holding[] = [];
  if (a > 0) holdings.push({ holder: ACTIVE_FOUNDERS, className: "Common", shares: (S * a) / 100 });
  if (d > 0) holdings.push({ holder: DEPARTED_FOUNDERS, className: "Common", shares: (S * d) / 100 });
  if (p > 0) holdings.push({ holder: POOL_HOLDER, className: "Option Pool", shares: (S * p) / 100 });
  if (other > 0) {
    const shares = (S * other) / 100;
    classes.push({ name: "Prior preferred", type: "PREFERRED", originalIssuePrice: priorRaisedUsd && priorRaisedUsd > 0 ? priorRaisedUsd / shares : 0, liquidationPrefMultiple: 1, participating: false, seniority: 0 });
    holdings.push({ holder: PRIOR_INVESTORS, className: "Prior preferred", shares });
  }
  return { ct: { classes, holdings, convertibles, debt: [] }, notes };
}

function pathInputs(inp: DivergenceInputs, ct0: CapTable): EconomicsInputs | null {
  if (!inp.registry) return null;
  const t = entryTermsFromDeal(inp.deal, inp.registry);
  if (!t.postMoneyUsd || !t.raiseUsd || !(t.raiseUsd > 0)) return null;
  const stage: FinancingStage = inp.deal.classification.financingStage;
  const exits = {} as Record<Scenario, ExitSpec>;
  for (const s of RETURN_SCENARIOS) exits[s] = { exitEquityUsd: 0, years: 1, basis: "not used", revenueMultiple: null };
  return {
    instrument: t.instrument === "UNKNOWN" ? "PRICED_EQUITY" : t.instrument,
    stage,
    postMoneyUsd: t.postMoneyUsd,
    raiseUsd: t.raiseUsd,
    checkUsd: t.raiseUsd,
    discountPct: t.discountPct,
    ourPrefMultiple: t.liquidationPrefMultiple,
    ourParticipating: t.participating,
    priorRaisedUsd: moneyUsd(inp.deal.financing?.totalRaisedToDate),
    priorStepUp: DEFAULT_ECONOMICS_ASSUMPTIONS.defaultPriorStepUp,
    entryPoolIncreasePct: inp.deal.financing?.optionPoolIncreasePct ?? null,
    futureRounds: inp.registry.returns.futureRounds[stage] ?? inp.registry.returns.futureRounds.UNKNOWN,
    roundsBeforeExit: inp.registry.returns.roundsBeforeExit,
    monthsBetweenRounds: inp.registry.returns.monthsBetweenRounds,
    nextRoundDelayMonths: 0,
    bridge: null,
    followOn: false,
    reserveUsd: 0,
    exits,
    fundSizeUsd: null,
    preRoundCapTable: ct0,
    a: DEFAULT_ECONOMICS_ASSUMPTIONS,
  };
}

function pctOf(ct: CapTable, holder: string): number {
  return round(asConvertedOwnership(ct, holder) * 100, 2);
}

export function founderOwnershipPath(inp: DivergenceInputs, ct0: CapTable): { rows: FounderPathRow[]; notes: string[] } {
  const rows: FounderPathRow[] = [];
  const notes: string[] = [];
  const stage = inp.deal.classification.financingStage;
  const row = (label: string, month: number, ct: CapTable, benchRound: string | null): FounderPathRow => {
    const b = benchRound ? founderBenchmarkFor(benchRound) : null;
    const active = pctOf(ct, ACTIVE_FOUNDERS);
    return { label, month, activeFounderPct: active, departedFounderPct: pctOf(ct, DEPARTED_FOUNDERS), poolPct: pctOf(ct, POOL_HOLDER), benchmark: b, belowFloor: !!b && active < b.floorPct };
  };
  rows.push(row("Before this round (stated)", 0, ct0, null));
  const inputs = pathInputs(inp, ct0);
  if (!inputs) {
    notes.push("Entry terms (round size and valuation) unknown — ownership path through the next rounds not computed.");
    return { rows, notes };
  }
  const path = buildProFormaPath(inputs, inputs.futureRounds.length);
  if (!path) {
    notes.push("Entry terms inconsistent — the pro-forma cap table cannot run.");
    return { rows, notes };
  }
  notes.push(...path.notes.filter((n) => !n.startsWith("Pre-round cap table provided")));
  rows.push(row(`After ${STAGE_ROUND_LABEL[stage]} (this round)`, 0, path.entry.ct, STAGE_ROUND_LABEL[stage]));
  for (const s of path.steps) if (s.row.kind === "PRICED") rows.push(row(`After ${s.row.label}`, s.row.month, s.ct, s.row.label));
  notes.push(`Future rounds from the benchmark registry path for ${STAGE_ROUND_LABEL[stage]} (step-up, dilution, ${DEFAULT_ECONOMICS_ASSUMPTIONS.futurePoolTargetPostPct}% pool refresh) — REGISTRY / MODEL_ASSUMPTION.`);
  return { rows, notes };
}

export function capTableAlignment(inp: DivergenceInputs): CapTableFactor {
  const ctd = inp.draft?.capTable ?? null;
  const fin = inp.deal.financing;
  const stage = inp.deal.classification.financingStage;
  const evidence: DivergenceEvidence[] = [];
  const issues: CapTableFactor["issues"] = [];
  const add = (issue: string, points: number, basis: "COMPUTED" | "MODEL_OBSERVED") => issues.push({ issue, points, basis });

  const founders = ctd?.founders ?? [];
  const departed = founders.filter((f) => f.status === "DEPARTED");
  const active = founders.filter((f) => f.status !== "DEPARTED");
  const activeStated = ctd?.founderOwnershipPct ?? null;
  const activeSum = active.filter((f) => f.ownershipPct !== null).reduce((s, f) => s + (f.ownershipPct ?? 0), 0);
  const activePct = activeStated !== null && activeStated > 0 ? activeStated : activeSum > 0 ? activeSum : null;
  const departedKnown = departed.filter((f) => f.ownershipPct !== null);
  // 0 only when a roster is shown and nobody left; unknown without a roster.
  const departedPct = departedKnown.length ? departedKnown.reduce((s, f) => s + (f.ownershipPct ?? 0), 0) : departed.length || !founders.length ? null : 0;
  for (const f of founders.filter((x) => hasText(x.evidence) || x.ownershipPct !== null))
    evidence.push(ev("MODEL_OBSERVED", `${f.name} (${f.role}) — ${f.status.toLowerCase().replace(/_/g, " ")}${f.ownershipPct !== null ? `, ${pct1(f.ownershipPct)}` : ""}${hasText(f.evidence) ? `: ${f.evidence}` : ""}`, [f.page]));

  const poolTotal = ctd?.optionPoolPct ?? null;
  const poolAvailable = ctd?.optionPoolAvailablePct ?? null;
  const convs = (ctd?.convertibles ?? []).map((c, i) => ({ c, conv: convertibleFrom(i, c) }));
  for (const { c } of convs) evidence.push(ev("MODEL_OBSERVED", `Outstanding ${c.instrument.toLowerCase().replace(/_/g, " ")} ${c.amount?.rawText ?? "amount n/a"}${c.valuationCap ? ` at ${c.valuationCap.rawText} cap` : " (no cap stated)"}${c.discountPct ? `, ${c.discountPct}% discount` : ""}`, [c.page]));
  const convertibles = convs.map((x) => x.conv).filter((x): x is Convertible => !!x);
  const currentSafe = fin?.instrument === "SAFE" || fin?.instrument === "CONVERTIBLE_NOTE";
  const caps = new Set(convertibles.map((c) => c.valuationCap ?? -1));
  if (currentSafe) caps.add(moneyUsd(fin?.valuationCap) ?? -2);
  const distinctCaps = caps.size;

  // Pre-round cap table and as-converted overhang (only when the founders' stake is stated).
  let path: FounderPathRow[] = [];
  let pathNotes: string[] = [];
  let overhang: number | null = null;
  if (activePct !== null) {
    const poolForTable = poolTotal ?? A.defaultPoolPct;
    if (poolTotal === null) pathNotes.push(`Option pool not stated — ${A.defaultPoolPct}% assumed for the path (MODEL_ASSUMPTION).`);
    const { ct: ct0, notes } = statedPreRoundCapTable(activePct, departedPct ?? 0, poolForTable, convertibles, moneyUsd(fin?.totalRaisedToDate));
    pathNotes.push(...notes);
    if (convertibles.some((c) => c.valuationCap)) {
      const conv = capConversionShares(ct0);
      const convTotal = conv.reduce((x, y) => x + y, 0);
      overhang = round((convTotal / (totalFdShares(ct0) + convTotal)) * 100, 1);
    }
    try {
      const p = founderOwnershipPath(inp, ct0);
      path = p.rows;
      pathNotes.push(...p.notes);
    } catch (e) {
      pathNotes.push(`Ownership path failed: ${(e as Error).message}`);
      path = [];
    }
  } else if (convertibles.some((c) => c.valuationCap)) {
    // Without the founders' stake the overhang is still computable on a unit table.
    const conv = capConversionShares({ classes: [], holdings: [{ holder: "All pre-round holders", className: "Common", shares: S }], convertibles, debt: [] });
    const convTotal = conv.reduce((x, y) => x + y, 0);
    overhang = round((convTotal / (S + convTotal)) * 100, 1);
  }

  // Rules → points.
  const entryRow = path.find((r) => r.label.startsWith("After") && r.month === 0) ?? null;
  const last = path.length > 1 ? path[path.length - 1]! : null;
  if (entryRow?.benchmark) {
    const b = entryRow.benchmark;
    if (entryRow.activeFounderPct < b.floorPct) add(`Active founders hold ${pct1(entryRow.activeFounderPct)} after this round — below the ${b.round} floor of ${b.floorPct}% (typical ${b.typicalPct}%)`, 2, "COMPUTED");
    else if (entryRow.activeFounderPct < b.typicalPct) add(`Active founders hold ${pct1(entryRow.activeFounderPct)} after this round — below the typical ${b.typicalPct}% for ${b.round}`, 1, "COMPUTED");
  } else if (activePct !== null) {
    // No modelable entry: compare the stated pre-round stake with the previous stage's benchmark.
    const prev: Record<FinancingStage, string | null> = { PRE_SEED: null, SEED: "Pre-seed", SERIES_A: "Seed", SERIES_B: "Series A", SERIES_C_PLUS: "Series B", UNKNOWN: null };
    const b = prev[stage] ? founderBenchmarkFor(prev[stage]!) : null;
    if (b && activePct < b.floorPct) add(`Active founders hold ${pct1(activePct)} before a ${STAGE_ROUND_LABEL[stage]} — below the post-${b.round} floor of ${b.floorPct}%`, 2, "COMPUTED");
    else if (b && activePct < b.typicalPct) add(`Active founders hold ${pct1(activePct)} before a ${STAGE_ROUND_LABEL[stage]} — below the typical post-${b.round} ${b.typicalPct}%`, 1, "COMPUTED");
  }
  if (last && last !== entryRow) {
    if (last.activeFounderPct < A.motivationFloorPct) add(`Projected active-founder stake ${last.label.toLowerCase()}: ${pct1(last.activeFounderPct)} (< ${A.motivationFloorPct}%)`, 2, "COMPUTED");
    else if (last.activeFounderPct < A.motivationWatchPct) add(`Projected active-founder stake ${last.label.toLowerCase()}: ${pct1(last.activeFounderPct)} (< ${A.motivationWatchPct}%)`, 1, "COMPUTED");
  }
  if (departedPct !== null && departedPct >= A.departedStakeHighPct) add(`Departed co-founder(s) hold ${pct1(departedPct)} — dead equity that is not working for the company`, 2, "MODEL_OBSERVED");
  else if (departedPct !== null && departedPct >= A.departedStakeWatchPct) add(`Departed co-founder(s) hold ${pct1(departedPct)}`, 1, "MODEL_OBSERVED");
  else if (departedPct === null && departed.length) add(`${departed.length} departed co-founder(s); stake not stated`, 0, "MODEL_OBSERVED");
  const poolMin = A.poolMinAvailablePct[stage];
  if (poolAvailable !== null && poolAvailable < poolMin) add(`Unallocated option pool ${pct1(poolAvailable)} < ${poolMin}% needed at ${STAGE_ROUND_LABEL[stage]}`, 1, "MODEL_OBSERVED");
  else if (poolAvailable === null && poolTotal !== null && poolTotal < poolMin) add(`Total option pool ${pct1(poolTotal)} < ${poolMin}% needed at ${STAGE_ROUND_LABEL[stage]}`, 1, "MODEL_OBSERVED");
  if (overhang !== null && overhang >= A.convertibleOverhangHighPct) add(`Outstanding convertibles convert into ${pct1(overhang)} at their caps — conversion overhang`, 2, "COMPUTED");
  else if (overhang !== null && overhang >= A.convertibleOverhangWatchPct) add(`Outstanding convertibles convert into ${pct1(overhang)} at their caps`, 1, "COMPUTED");
  if (distinctCaps >= A.stackedInstruments) add(`${distinctCaps} convertibles with different caps/terms stacked (including this round if it is a SAFE)`, 1, "COMPUTED");
  const heavy = (ctd?.terms ?? []).filter((t) => ["PARTICIPATING_PREFERRED", "PREFERENCE_ABOVE_1X", "FULL_RATCHET"].includes(t.term));
  const control = (ctd?.terms ?? []).filter((t) => ["REDEMPTION_RIGHT", "INVESTOR_OPERATING_VETO", "SUPER_VOTING"].includes(t.term));
  const finHeavy = (fin?.terms.liquidationPreferenceMultiple ?? 1) > 1 || fin?.terms.participating === true;
  if (heavy.length || finHeavy) add(`Heavy preferences: ${[...heavy.map((t) => t.term.toLowerCase().replace(/_/g, " ")), ...(finHeavy ? [`this round ${fin?.terms.liquidationPreferenceMultiple ?? 1}x${fin?.terms.participating ? " participating" : ""}`] : [])].join(", ")}`, Math.min(2, heavy.length + (finHeavy ? 1 : 0)), "MODEL_OBSERVED");
  if (control.length) add(`Control terms: ${control.map((t) => t.term.toLowerCase().replace(/_/g, " ")).join(", ")}`, 1, "MODEL_OBSERVED");
  const conflicts = (ctd?.investorConflicts ?? []).filter((c) => isFact(c.evidence));
  if (conflicts.length) add(`Investor conflict: ${conflicts[0]!.evidence}`, 1, "MODEL_OBSERVED");
  for (const t of [...heavy, ...control]) evidence.push(ev("MODEL_OBSERVED", `${t.term.toLowerCase().replace(/_/g, " ")}: ${t.evidence}`, [t.page]));
  for (const c of conflicts) evidence.push(ev("MODEL_OBSERVED", `Investor conflict: ${c.evidence}`, [c.page]));
  for (const i of issues.filter((x) => x.basis === "COMPUTED")) evidence.push(ev("COMPUTED", i.issue));

  const points = issues.reduce((s, i) => s + i.points, 0);
  const anyFact = activePct !== null || founders.length > 0 || poolTotal !== null || poolAvailable !== null || convertibles.length > 0 || (ctd?.terms.length ?? 0) > 0 || conflicts.length > 0 || finHeavy;
  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "CAP_TABLE_NOT_SHOWN";
  let why = "The materials do not show the cap table (founder ownership, pool, outstanding convertibles).";
  if (anyFact) {
    level = points === 0 ? "STRONG" : points <= 2 ? "ADEQUATE" : "WEAK";
    reading = points === 0 ? "ALIGNED" : points <= 2 ? "WATCH" : "MISALIGNED";
    why = issues.filter((i) => i.points > 0).length
      ? `${issues.filter((i) => i.points > 0).sort((x, y) => y.points - x.points)[0]!.issue}${issues.filter((i) => i.points > 0).length > 1 ? ` (+${issues.filter((i) => i.points > 0).length - 1} more issue${issues.filter((i) => i.points > 0).length > 2 ? "s" : ""})` : ""}.`
      : `No misalignment found in what is shown${activePct !== null ? `: active founders hold ${pct1(activePct)} before the round` : ""}.`;
    if (activePct === null && level === "STRONG") {
      level = "ADEQUATE";
      reading = "NO_ISSUE_SHOWN";
      why += " Founder ownership is not stated, so alignment cannot be confirmed.";
    }
  }

  const implications: string[] = [];
  const poolShort = issues.some((i) => i.issue.includes("option pool"));
  if (poolShort) implications.push("Hiring: the pool is too small for the next senior hires; the top-up will be carved out of the pre-money of the next round, diluting founders and existing holders.");
  if ((overhang ?? 0) >= A.convertibleOverhangWatchPct || distinctCaps >= A.stackedInstruments)
    implications.push(`Next rounds: new investors price the conversion overhang (${pct1(overhang)}) — it lowers the effective pre-money and the founders' post-round stake.`);
  if (heavy.length || finHeavy) implications.push("Next rounds: heavy preferences set a precedent later investors copy; the common stake is paid last in a moderate exit.");
  if (last && last !== entryRow) implications.push(`Founder motivation over 10 years: on the registry path the active founders end at ${pct1(last.activeFounderPct)} ${last.label.toLowerCase()}${last.activeFounderPct < A.motivationWatchPct ? " — refresh grants will likely be needed to keep them" : ""}.`);
  if (departedPct !== null && departedPct >= A.departedStakeWatchPct) implications.push(`Motivation: ${pct1(departedPct)} held by people no longer working in the company is equity that cannot reward the people who build it.`);

  return {
    id: "CAP_TABLE_ALIGNMENT",
    n: 2,
    name: "Cap table health & incentive alignment",
    question: "Will the people who build this company still own enough of it to care in ten years?",
    level,
    reading,
    why,
    basis: basesOf(evidence, [path.length > 1 && "MODEL_ASSUMPTION"]),
    pages: pagesOfEvidence(evidence),
    rule: `Points: active-founder stake after this round below the stage floor +2 (below typical +1) [${FOUNDER_OWNERSHIP_BENCHMARKS.version}, MODEL_ASSUMPTION]; projected stake after the registry round path < ${A.motivationFloorPct}% +2 (< ${A.motivationWatchPct}% +1); departed co-founders ≥ ${A.departedStakeHighPct}% +2 (≥ ${A.departedStakeWatchPct}% +1); unallocated pool below the stage minimum +1; convertible overhang at caps ≥ ${A.convertibleOverhangHighPct}% +2 (≥ ${A.convertibleOverhangWatchPct}% +1); ≥ ${A.stackedInstruments} differently-capped convertibles +1; heavy preferences (participating, > 1x, full ratchet) up to +2; control terms +1; stated investor conflict +1. 0 → STRONG, 1–2 → ADEQUATE, ≥ 3 → WEAK; STRONG requires a stated founder stake. The path uses the economics engine's pro-forma cap table on the stated pre-round table.`,
    evidence,
    coverage: coverage(
      [activePct !== null && "founder ownership", founders.length > 0 && "founder roster & status", (poolTotal !== null || poolAvailable !== null) && "option pool", convs.length > 0 && "outstanding convertibles", path.length > 1 && "entry terms (ownership path)"],
      [activePct === null && "founder ownership", !founders.length && "founder roster & status", poolTotal === null && poolAvailable === null && "option pool", path.length <= 1 && "entry terms (ownership path)"],
      convs.length === 0 ? "No outstanding convertibles reported (none, or not shown)." : null,
    ),
    computed: [
      num("activeFounderPct", "Active founders before the round", activePct, "PCT", activeStated !== null ? "MODEL_OBSERVED" : "COMPUTED"),
      num("activeAfterRoundPct", "Active founders after this round", entryRow?.activeFounderPct ?? null, "PCT"),
      num("activeEndOfPathPct", `Active founders ${last ? last.label.toLowerCase() : "at end of path"}`, last?.activeFounderPct ?? null, "PCT"),
      num("departedPct", "Held by departed co-founders", departedPct, "PCT", "MODEL_OBSERVED"),
      num("poolAvailablePct", "Unallocated option pool", poolAvailable, "PCT", "MODEL_OBSERVED"),
      num("overhangPct", "Convertible overhang at caps", overhang, "PCT"),
      num("distinctCaps", "Distinct convertible caps", distinctCaps, "COUNT"),
      num("points", "Misalignment points", points, "COUNT"),
    ],
    implications,
    points,
    activeFounderPct: activePct,
    departedFounderPct: departedPct,
    poolAvailablePct: poolAvailable,
    convertibleOverhangPct: overhang,
    outstandingConvertibles: convs.length,
    distinctCaps,
    path,
    pathNotes,
    issues,
  };
}
