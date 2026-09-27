/**
 * 10. CONTRADICTION SEVERITY — one ranked list.
 *
 * Classes, in increasing order of gravity:
 *   TYPO < DEFINITION < MATERIAL_VALUE < SELF_CONTRADICTION < INDEPENDENT_SOURCE
 * SELF_CONTRADICTION = the company contradicts itself (e.g. founder-call
 * transcript vs deck). INDEPENDENT_SOURCE = an independent, citation-verified
 * source contradicts the claim. Ranked by severity, then class, then id.
 */
import type { IntegrityContext } from "./context";
import type { ContradictionClass, CrossSlideInconsistency, ImpliedMetric, IntegrityFinding, IntegritySeverity, RankedContradiction } from "./types";
import { finding, hash, pageOf, sevRank, uniqSorted } from "./util";

export const CLASS_RANK: Record<ContradictionClass, number> = { ROUNDING: 0, TYPO: 1, DEFINITION: 2, MATERIAL_VALUE: 3, SELF_CONTRADICTION: 4, INDEPENDENT_SOURCE: 5 };

export function rankContradictions(list: RankedContradiction[]): RankedContradiction[] {
  return [...list].sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || CLASS_RANK[b.class] - CLASS_RANK[a.class] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function contradictions(ctx: IntegrityContext, implied: ImpliedMetric[], cross: CrossSlideInconsistency[]): { list: RankedContradiction[]; findings: IntegrityFinding[] } {
  const list: RankedContradiction[] = [];
  const findings: IntegrityFinding[] = [];

  for (const c of ctx.claims) {
    const contraLinks = c.evidence.filter((e) => e.effect === "CONTRADICTS");
    if (!(c.verification === "CONTRADICTED" || c.contradictions.length || contraLinks.length)) continue;
    const srcs = contraLinks.map((e) => ctx.sourceById.get(e.sourceId));
    const independent = srcs.some((s) => s && s.origin !== "COMPANY" && s.independenceGroup !== "COMPANY" && s.citationVerified);
    const transcript = srcs.some((s) => s && (s.kind === "TRANSCRIPT" || s.origin === "COMPANY")) || c.contradictions.some((x) => /founder call|transcript|call/i.test(x));
    const cls: ContradictionClass = independent ? "INDEPENDENT_SOURCE" : transcript ? "SELF_CONTRADICTION" : c.verification === "CONTRADICTED" ? "INDEPENDENT_SOURCE" : "MATERIAL_VALUE";
    const severity: IntegritySeverity =
      cls === "INDEPENDENT_SOURCE" ? (c.material ? "CRITICAL" : "MODERATE") : cls === "SELF_CONTRADICTION" ? (c.material ? "HIGH" : "MODERATE") : c.material ? "HIGH" : "LOW";
    const pages = [...ctx.claimPages(c), ...contraLinks.map((e) => pageOf(e.location))];
    const detailBits = [...contraLinks.map((e) => `${e.sourceId}: ${e.excerpt}`), ...c.contradictions].slice(0, 4);
    const item: RankedContradiction = {
      id: `CTR-${hash(`claim|${c.id}`)}`,
      class: cls,
      origin: "COMPUTED",
      severity,
      title: `${cls === "INDEPENDENT_SOURCE" ? "Contradicted by an independent source" : cls === "SELF_CONTRADICTION" ? "Contradicted by the company's own later statements" : "Contradicted"}: ${c.statement.slice(0, 120)}`,
      detail: detailBits.join(" | ") || "Claim marked contradicted.",
      claimIds: [c.id],
      metricIds: ctx.metrics.filter((m) => m.claimId === c.id).map((m) => m.id),
      sourceIds: uniqSorted(contraLinks.map((e) => e.sourceId)),
      pages: uniqSorted(pages),
    };
    list.push(item);
    findings.push(
      finding({
        kind: cls === "SELF_CONTRADICTION" ? "CLAIM_SELF_CONTRADICTED" : "CLAIM_CONTRADICTED",
        module: "CONTRADICTIONS",
        severity,
        title: item.title,
        detail: item.detail,
        claimIds: item.claimIds,
        metricIds: item.metricIds,
        sourceIds: item.sourceIds,
        pages: item.pages,
      }),
    );
  }

  for (const m of ctx.metrics) {
    if (m.state !== "CONTRADICTED" || (m.claimId && list.some((x) => x.claimIds.includes(m.claimId!)))) continue;
    list.push({
      id: `CTR-${hash(`metric|${m.id}`)}`,
      class: "MATERIAL_VALUE",
      origin: "COMPUTED",
      severity: m.isPrimary ? "HIGH" : "MODERATE",
      title: `Metric ${m.metricKey} marked contradicted`,
      detail: m.notes ?? m.qualityFlags.join("; "),
      claimIds: m.claimId ? [m.claimId] : [],
      metricIds: [m.id],
      sourceIds: m.sourceId ? [m.sourceId] : [],
      pages: uniqSorted([pageOf(m.location)]),
    });
  }

  for (const r of implied) {
    if (r.verdict !== "INCONSISTENT" || !r.severity) continue;
    const ms = ctx.metrics.filter((m) => r.inputs.includes(m.id));
    list.push({
      id: `CTR-${hash(`implied|${r.id}`)}`,
      class: "MATERIAL_VALUE",
      origin: "COMPUTED",
      severity: r.severity,
      title: `Implied ${r.name.toLowerCase().replace(/_/g, " ")} inconsistent`,
      detail: r.note,
      claimIds: uniqSorted(ms.map((m) => m.claimId)),
      metricIds: ms.map((m) => m.id),
      sourceIds: [],
      pages: uniqSorted(ms.map((m) => pageOf(m.location))),
    });
  }

  for (const x of cross) {
    if (!x.severity) continue;
    list.push({
      id: `CTR-${hash(`cross|${x.id}`)}`,
      class: x.class,
      origin: x.origin,
      severity: x.severity,
      title: `Cross-slide: ${x.topic}`,
      detail: x.detail,
      claimIds: x.claimIds,
      metricIds: [],
      sourceIds: [],
      pages: x.pages,
    });
  }

  return { list: rankContradictions(list), findings };
}
