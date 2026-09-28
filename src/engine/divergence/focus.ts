/**
 * 8. ORGANIZATIONAL FOCUS — simultaneous priorities (products, ICPs,
 * countries, channels) relative to resources (headcount, capital, runway).
 * Twelve people with five products and four markets are not a team on one
 * wedge.
 */
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, downgrade, ev, fmtUsd, metricRef, months1, normName, num, pagesOfEvidence, round } from "./util";

export interface FocusAxis {
  axis: "PRODUCTS" | "SEGMENTS" | "MARKETS" | "CHANNELS";
  counted: string[];
  excluded: string[];
}

export interface FocusFactor extends FactorBase {
  id: "ORGANIZATIONAL_FOCUS";
  axes: FocusAxis[];
  priorities: number;
  excessPriorities: number;
  fte: number | null;
  fteSource: string;
  excessPer10Fte: number | null;
  runwayMonths: number | null;
  capitalPerPriorityUsd: number | null;
}

function distinct<T extends { name: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = normName(x.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function organizationalFocus(inp: DivergenceInputs): FocusFactor {
  const f = inp.draft?.focus ?? null;
  const products = distinct(f?.products ?? []);
  const segments = distinct(f?.customerSegments ?? []);
  const markets = distinct(f?.markets ?? []);
  const channels = distinct(f?.channels ?? []);
  const axes: FocusAxis[] = [
    { axis: "PRODUCTS", counted: products.filter((p) => p.status !== "ROADMAP").map((p) => p.name), excluded: products.filter((p) => p.status === "ROADMAP").map((p) => `${p.name} (roadmap)`) },
    { axis: "SEGMENTS", counted: segments.map((s) => s.name), excluded: [] },
    { axis: "MARKETS", counted: markets.filter((m) => m.status !== "PLANNED").map((m) => m.name), excluded: markets.filter((m) => m.status === "PLANNED").map((m) => `${m.name} (planned)`) },
    { axis: "CHANNELS", counted: channels.map((c) => c.name), excluded: [] },
  ];
  const known = axes.filter((a) => a.counted.length > 0);
  const priorities = axes.reduce((s, a) => s + a.counted.length, 0);
  const excess = Math.max(0, priorities - known.length);

  const hc = metricRef(inp.deal, "headcount");
  const byFn = (inp.draft?.scalability.headcountByFunction ?? []).reduce((s, h) => s + (Number.isFinite(h.count) && h.count > 0 ? h.count : 0), 0);
  const fte = hc?.value ?? (byFn > 0 ? byFn : null);
  const fteSource = hc ? `headcount metric (${hc.raw})` : byFn > 0 ? "sum of headcount by function (deck)" : "unknown";
  const per10 = fte && fte > 0 ? round(excess / (fte / 10), 2) : null;
  const runway = inp.financing?.runwayAfterRoundMonths ?? null;
  const capital = (inp.financing?.cashUsd ?? 0) + (inp.financing?.raiseUsd ?? 0);
  const capitalPerPriority = priorities > 0 && capital > 0 ? round(capital / priorities, 0) : null;

  const pages = [...products, ...segments, ...markets, ...channels].map((x) => x.page);
  const evidence: DivergenceEvidence[] = axes
    .filter((a) => a.counted.length || a.excluded.length)
    .map((a) => ev("MODEL_OBSERVED", `${a.axis.toLowerCase()}: ${a.counted.length} counted (${a.counted.join(", ") || "—"})${a.excluded.length ? `; not counted: ${a.excluded.join(", ")}` : ""}`));
  if (evidence.length) evidence[0] = { ...evidence[0]!, pages: [...new Set(pages.filter((p): p is number => p !== null))].sort((x, y) => x - y) };
  evidence.push(ev("COMPUTED", `${priorities} simultaneous priorities across ${known.length} axes → ${excess} beyond one per axis${fte ? `; ${fte} FTE (${fteSource}) → ${per10} excess priorities per 10 FTE` : ""}${runway !== null ? `; runway after round ${months1(runway)}` : ""}`, [hc?.page], [hc?.ref]));

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "UNREAD";
  if (f && known.length > 0) {
    if (per10 !== null) {
      level = per10 <= A.focusStrongMax ? "STRONG" : per10 <= A.focusAdequateMax ? "ADEQUATE" : "WEAK";
      if (runway !== null && runway < A.focusRunwayStressMonths && excess >= 3) level = downgrade(level);
    } else if (excess >= 6) level = "WEAK";
    else if (excess <= 1) level = "ADEQUATE";
    reading = level === "STRONG" ? "FOCUSED" : level === "ADEQUATE" ? (per10 === null ? "FOCUSED_RESOURCES_UNKNOWN" : "STRETCHED") : level === "WEAK" ? "FRAGMENTED" : "RESOURCES_UNKNOWN";
  }
  const counts = axes.map((a) => `${a.counted.length} ${a.axis.toLowerCase()}`).join(", ");
  const why =
    !f || !known.length
      ? "Products, segments, markets and channels are not read from the materials."
      : per10 !== null
        ? `${fte} people run ${counts} — ${per10} excess priorities per 10 FTE.`
        : `${counts}; headcount unknown, so priorities cannot be set against resources.`;

  const implications: string[] = [];
  if (level === "WEAK") implications.push(`Fragmented: ${excess} priorities beyond a single wedge for ${fte ?? "an unknown number of"} people — each product, market and channel gets a fraction of the team; lookalikes on one wedge will out-execute it.`);
  if (level === "STRONG") implications.push("Focused: the team's attention is concentrated on one wedge — the advantage of a small team.");
  if (capitalPerPriority !== null) implications.push(`Capital per priority: ${fmtUsd(capitalPerPriority)} of cash + round for each simultaneous priority.`);

  return {
    id: "ORGANIZATIONAL_FOCUS",
    n: 8,
    name: "Organizational focus",
    question: "How many things is the team trying to win at once, relative to its people and money?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: `Counting: products LIVE or BETA (roadmap excluded), every customer segment sold to today, countries/regions ACTIVE or LAUNCHING (planned excluded), every acquisition channel actively run; names deduplicated. Excess priorities = total − one per axis present. Excess per 10 FTE ≤ ${A.focusStrongMax} → STRONG, ≤ ${A.focusAdequateMax} → ADEQUATE, above → WEAK; runway < ${A.focusRunwayStressMonths} months with ≥ 3 excess downgrades one level. Without headcount: ≥ 6 excess → WEAK, ≤ 1 → ADEQUATE, otherwise INSUFFICIENT_EVIDENCE.`,
    evidence,
    coverage: coverage(
      [!!f && known.length > 0 && `${known.length}/4 priority axes`, fte !== null && "headcount", runway !== null && "runway", capital > 0 && "capital"],
      [(!f || known.length < 4) && `${4 - known.length}/4 priority axes unread`, fte === null && "headcount", runway === null && "runway", capital <= 0 && "capital"],
    ),
    computed: [
      num("priorities", "Simultaneous priorities", priorities, "COUNT"),
      num("excess", "Priorities beyond one per axis", excess, "COUNT"),
      num("fte", "FTE", fte, "COUNT"),
      num("excessPer10Fte", "Excess priorities per 10 FTE", per10, "RATIO"),
      num("runway", "Runway after round", runway !== null ? round(runway, 1) : null, "MONTHS"),
      num("capitalPerPriority", "Capital per priority", capitalPerPriority, "USD"),
    ],
    implications,
    axes,
    priorities,
    excessPriorities: excess,
    fte,
    fteSource,
    excessPer10Fte: per10,
    runwayMonths: runway,
    capitalPerPriorityUsd: capitalPerPriority,
  };
}
