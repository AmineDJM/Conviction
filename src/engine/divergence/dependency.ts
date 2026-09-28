/**
 * 6. DEPENDENCY SURFACE — how many critical elements does the company NOT
 * control (a single model provider, an app store, one cloud, one banking API,
 * one channel partner, one data source, one licence, one key customer) versus
 * what it owns (distribution, data, technology, customer relationship)?
 */
import type { DEPENDENCY_KINDS } from "@/domain/sections";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, hasText, isFact, metricRef, normName, num, pagesOfEvidence, pct1, round } from "./util";

export interface Dependency {
  kind: (typeof DEPENDENCY_KINDS)[number];
  provider: string;
  whatItProvides: string;
  criticality: "CORE" | "IMPORTANT" | "PERIPHERAL";
  substitutability: "EASY" | "MODERATE" | "HARD" | "UNKNOWN";
  switchingTimeMonths: number | null;
  mitigation: string | null;
  /** criticality × substitutability × switching-time factor × mitigation factor. */
  danger: number;
  critical: boolean;
  onSurface: boolean;
  /** The provider is not named ("unspecified hosting provider"): an information gap, not a counted dependency. */
  undisclosed: boolean;
  /** ≥ 2 named providers of the same kind: they substitute for each other, so the kind counts once and is never a single point. */
  multiHomed: boolean;
  basis: "MODEL_OBSERVED" | "COMPUTED";
  evidence: string;
  page: number | null;
  refs: string[];
}

export interface DependencyFactor extends FactorBase {
  id: "DEPENDENCY_SURFACE";
  dependencies: Dependency[];
  surfaceCount: number;
  criticalCount: number;
  mostDangerous: Dependency | null;
  owned: { asset: string; evidence: string; page: number | null }[];
}

const CRIT = { CORE: 3, IMPORTANT: 2, PERIPHERAL: 1 } as const;
const SUBST = { HARD: 3, UNKNOWN: 2, MODERATE: 2, EASY: 1 } as const;
export const CRITICAL_DANGER = 6;
export const SINGLE_POINT_DANGER = 9;
const UNDISCLOSED_RE = /\b(unspecified|unknown|unnamed|undisclosed|not (stated|disclosed|named|specified)|generic|some|various)\b/i;

export function dangerOf(d: Pick<Dependency, "criticality" | "substitutability" | "switchingTimeMonths" | "mitigation">): number {
  const t = d.switchingTimeMonths === null ? 1 : d.switchingTimeMonths >= 12 ? 1.5 : d.switchingTimeMonths >= 6 ? 1.25 : 1;
  const m = isFact(d.mitigation) ? 0.75 : 1;
  return round(CRIT[d.criticality] * SUBST[d.substitutability] * t * m, 2);
}

export function dependencySurface(inp: DivergenceInputs): DependencyFactor {
  const draft = inp.draft;
  const deps: Dependency[] = [];
  for (const d of draft?.dependencies ?? []) {
    if (!hasText(d.provider) && !hasText(d.whatItProvides)) continue;
    const undisclosed = !hasText(d.provider) || UNDISCLOSED_RE.test(d.provider);
    const base = { criticality: d.criticality, substitutability: d.substitutability, switchingTimeMonths: d.switchingTimeMonths, mitigation: d.mitigationStated };
    const danger = dangerOf(base);
    deps.push({ kind: d.kind, provider: d.provider || "Unnamed provider", whatItProvides: d.whatItProvides, ...base, danger, critical: !undisclosed && danger >= CRITICAL_DANGER, onSurface: !undisclosed && d.criticality !== "PERIPHERAL" && d.substitutability !== "EASY", undisclosed, multiHomed: false, basis: "MODEL_OBSERVED", evidence: d.evidence, page: d.page, refs: [] });
  }
  // Multi-homing: named providers of one kind substitute for each other — the kind counts once on the surface and is never a single point.
  const byKind = new Map<string, Dependency[]>();
  for (const d of deps) if (!d.undisclosed) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  for (const group of byKind.values()) {
    if (new Set(group.map((g) => normName(g.provider))).size < 2) continue;
    group.sort((a, b) => b.danger - a.danger);
    group.forEach((g, i) => {
      g.multiHomed = true;
      g.danger = Math.min(g.danger, SINGLE_POINT_DANGER - 1);
      g.critical = g.danger >= CRITICAL_DANGER;
      if (i > 0) g.onSurface = false;
    });
  }
  // Customer concentration from the metrics is a dependency code can compute.
  const top1 = metricRef(inp.deal, "customer_concentration_top1");
  if (top1 && top1.value >= A.keyCustomerImportantPct && !deps.some((d) => d.kind === "KEY_CUSTOMER")) {
    const criticality = top1.value >= A.keyCustomerCorePct ? "CORE" : "IMPORTANT";
    const base = { criticality, substitutability: "MODERATE", switchingTimeMonths: null, mitigation: null } as const;
    const danger = dangerOf(base);
    deps.push({ kind: "KEY_CUSTOMER", provider: "Largest customer", whatItProvides: `${pct1(top1.value)} of revenue`, ...base, danger, critical: danger >= CRITICAL_DANGER, onSurface: true, undisclosed: false, multiHomed: false, basis: "COMPUTED", evidence: `Top customer = ${pct1(top1.value)} of revenue (${top1.raw})`, page: top1.page, refs: [top1.ref] .filter((x): x is string => !!x) });
  }
  deps.sort((a, b) => Number(a.undisclosed) - Number(b.undisclosed) || b.danger - a.danger || a.kind.localeCompare(b.kind));
  const undisclosed = deps.filter((d) => d.undisclosed);
  const owned = (draft?.ownedAssets ?? []).filter((o) => isFact(o.evidence)).map((o) => ({ asset: o.asset, evidence: o.evidence, page: o.page }));
  const ownedKinds = new Set(owned.map((o) => o.asset)).size;
  const surfaceCount = deps.filter((d) => d.onSurface).length;
  const criticalCount = deps.filter((d) => d.critical).length;
  const mostDangerous = deps.find((d) => !d.undisclosed) ?? null;

  const evidence: DivergenceEvidence[] = [
    ...deps.map((d) => ev(d.basis, `${d.kind.toLowerCase().replace(/_/g, " ")} — ${d.provider} (${d.whatItProvides}); ${d.criticality.toLowerCase()}, substitutability ${d.substitutability.toLowerCase()}${d.switchingTimeMonths !== null ? `, ${d.switchingTimeMonths} months to switch` : ""}${isFact(d.mitigation) ? `; mitigation: ${d.mitigation}` : ""} [danger ${d.danger}]${d.multiHomed ? " (multi-homed)" : ""}${d.undisclosed ? " — provider not named: a gap, not counted" : ""}${hasText(d.evidence) ? `: ${d.evidence}` : ""}`, [d.page], d.refs)),
    ...owned.map((o) => ev("MODEL_OBSERVED", `Owns ${o.asset.toLowerCase().replace(/_/g, " ")}: ${o.evidence}`, [o.page])),
  ];
  const aiProduct = inp.deal.classification.technology.includes("AI") || inp.deal.classification.productType.includes("AI_AGENT");
  const modelDisclosed = deps.some((d) => d.kind === "MODEL_PROVIDER" && !d.undisclosed);

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "UNREAD";
  if (draft || deps.length) {
    if (mostDangerous && mostDangerous.danger >= SINGLE_POINT_DANGER) {
      level = ownedKinds >= 3 ? "ADEQUATE" : "WEAK";
      reading = "CRITICAL_SINGLE_POINT";
    } else if (surfaceCount >= 4) {
      level = "WEAK";
      reading = "WIDE_SURFACE";
    } else if (criticalCount === 0 && surfaceCount <= 1) {
      level = "STRONG";
      reading = "CONTAINED";
    } else {
      level = "ADEQUATE";
      reading = "MATERIAL";
    }
    if (aiProduct && !modelDisclosed && level === "STRONG") {
      level = "ADEQUATE";
      reading = "CONTAINED_MODEL_UNDISCLOSED";
    }
  }
  const why =
    level === "INSUFFICIENT_EVIDENCE"
      ? "The materials do not show what the company relies on or owns."
      : mostDangerous
        ? `${surfaceCount} critical dependenc${surfaceCount === 1 ? "y" : "ies"} it does not control; most dangerous: ${mostDangerous.provider} (${mostDangerous.kind.toLowerCase().replace(/_/g, " ")}, ${mostDangerous.criticality.toLowerCase()}, ${mostDangerous.substitutability.toLowerCase()} to replace). Owns ${ownedKinds} asset type${ownedKinds === 1 ? "" : "s"}.`
        : `No dependency outside its control is shown; owns ${ownedKinds} asset type${ownedKinds === 1 ? "" : "s"}.${aiProduct && !modelDisclosed ? " The model provider of this AI product is not disclosed." : ""}`;

  const implications: string[] = [];
  if (mostDangerous?.critical) implications.push(`${mostDangerous.provider} can change price, terms or access unilaterally; a change there moves gross margin, roadmap or revenue — and the company cannot switch ${mostDangerous.switchingTimeMonths !== null ? `in under ${mostDangerous.switchingTimeMonths} months` : "quickly"}.`);
  if (mostDangerous?.kind === "MODEL_PROVIDER") implications.push("If the model provider ships the feature itself (see the economics COMMODITIZATION counterfactual), the product's differentiation must come from what the company owns.");
  if (ownedKinds === 0 && deps.length) implications.push("Rented, not owned: nothing in the materials shows proprietary distribution, data or customer lock-in that would survive a dependency shock.");
  if (aiProduct && !modelDisclosed) implications.push("Ask which model providers the product depends on and what switching would cost.");
  if (undisclosed.length) implications.push(`Unnamed dependencies (${undisclosed.map((d) => d.kind.toLowerCase().replace(/_/g, " ")).join(", ")}): the deck relies on providers it does not name — ask for them before sizing the risk.`);

  return {
    id: "DEPENDENCY_SURFACE",
    n: 6,
    name: "Dependency surface",
    question: "How many critical elements does the company not control — and which one could kill it?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: `Danger = criticality (core 3, important 2, peripheral 1) × substitutability (hard 3, moderate/unknown 2, easy 1) × switching time (≥ 12 months ×1.5, ≥ 6 ×1.25) × 0.75 if a mitigation is stated. Surface = core/important dependencies that are not easy to replace; critical = danger ≥ ${CRITICAL_DANGER}. Top customer ≥ ${A.keyCustomerCorePct}% of revenue is a core dependency (≥ ${A.keyCustomerImportantPct}% important). A single point with danger ≥ ${SINGLE_POINT_DANGER} → WEAK (ADEQUATE if ≥ 3 owned asset types); surface ≥ 4 → WEAK; no critical and surface ≤ 1 → STRONG (ADEQUATE for an AI product whose model provider is undisclosed); otherwise ADEQUATE. An unnamed provider is a coverage gap, not a counted dependency; ≥ 2 named providers of the same kind are multi-homed — the kind counts once and cannot be a single point (danger capped below ${SINGLE_POINT_DANGER}).`,
    evidence,
    coverage: coverage(
      [!!draft && "dependencies read (divergence pass)", owned.length > 0 && "owned assets", !!top1 && "customer concentration"],
      [!draft && "dependencies read (divergence pass)", !owned.length && "owned assets", !top1 && "customer concentration", aiProduct && !modelDisclosed && "model provider (AI product)", ...undisclosed.map((d) => `named ${d.kind.toLowerCase().replace(/_/g, " ")} provider`)],
    ),
    computed: [
      num("surfaceCount", "Dependency surface", surfaceCount, "COUNT"),
      num("criticalCount", "Critical dependencies", criticalCount, "COUNT"),
      num("mostDangerous", "Most dangerous dependency", mostDangerous ? `${mostDangerous.provider} (${mostDangerous.danger})` : null, "TEXT"),
      num("ownedAssetTypes", "Owned asset types", ownedKinds, "COUNT"),
    ],
    implications,
    dependencies: deps,
    surfaceCount,
    criticalCount,
    mostDangerous,
    owned,
  };
}
