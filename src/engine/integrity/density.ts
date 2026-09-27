/**
 * 8. INFORMATION DENSITY — a communication signal, never scored into quality.
 *
 * Pages, material claims per page, quantitative current observations per
 * page, unsupported-claim ratio, redundancy (near-duplicate claims: Jaccard
 * on word 2-shingles ≥ 0.6) and the share of pages without any
 * decision-relevant fact (no material claim, no current quantitative value).
 */
import { CURRENT_BASES, type IntegrityContext } from "./context";
import { claimSupport } from "./evidence-debt";
import type { InformationDensity } from "./types";
import { isNum, jaccard, round, shingles, UnionFind } from "./util";

export const DENSITY_LABEL = "Communication signal, not company quality";
export const REDUNDANCY_JACCARD = 0.6;
const MAX_PAIRWISE_CLAIMS = 400;
const MAX_PAGES = 500;

export function informationDensity(ctx: IntegrityContext): InformationDensity {
  const docPages = ctx.deal.documents
    ? ctx.deal.documents.filter((d) => d && d.kind !== "TRANSCRIPT" && isNum(d.pages) && d.pages > 0).reduce((a, d) => a + (d.pages as number), 0)
    : 0;
  const deckClaims = ctx.claims.filter((c) => c.evidence.some((e) => e.effect === "ORIGIN" && ctx.sourceById.get(e.sourceId)?.kind !== "TRANSCRIPT" && ctx.sourceById.get(e.sourceId)?.kind !== "WEB"));
  const quantObs = ctx.observations.filter((o) => (CURRENT_BASES as readonly string[]).includes(o.basis) && isNum(o.value));
  const referenced = [...deckClaims.flatMap((c) => ctx.claimPages(c)), ...quantObs.map((o) => o.page).filter((p): p is number => isNum(p))];
  const pages = docPages > 0 ? docPages : referenced.length ? Math.max(...referenced) : null;

  const material = ctx.claims.filter((c) => c.material);
  const materialDeck = deckClaims.filter((c) => c.material);
  const unsupported = material.filter((c) => claimSupport(c, ctx).status === "COMPANY_ONLY").length;

  // Redundancy over deck claims (bounded for speed).
  const pool = (deckClaims.length ? deckClaims : ctx.claims).slice(0, MAX_PAIRWISE_CLAIMS);
  const sh = pool.map((c) => shingles(c.statement));
  const uf = new UnionFind(pool.length);
  const pairs: InformationDensity["redundantClaimPairs"] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      if (sh[i]!.size === 0 || sh[j]!.size === 0) continue;
      const s = jaccard(sh[i]!, sh[j]!);
      if (s >= REDUNDANCY_JACCARD) {
        pairs.push({ a: pool[i]!.id, b: pool[j]!.id, similarity: round(s, 3) });
        uf.union(i, j);
      }
    }
  const roots = new Map<number, number>();
  for (let i = 0; i < pool.length; i++) roots.set(uf.find(i), (roots.get(uf.find(i)) ?? 0) + 1);
  const redundant = [...roots.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);

  const metricPages = ctx.metrics.filter((m) => m.calculationMethod !== "DERIVED" && isNum(m.normalizedValue)).map((m) => ctx.metricPage(m));
  const factPages = new Set<number>([...materialDeck.flatMap((c) => ctx.claimPages(c)), ...[...quantObs.map((o) => o.page), ...metricPages].filter((p): p is number => isNum(p))]);
  const pagesWithoutDecisionFacts: number[] = [];
  if (pages !== null && pages <= MAX_PAGES) for (let p = 1; p <= pages; p++) if (!factPages.has(p)) pagesWithoutDecisionFacts.push(p);

  return {
    label: DENSITY_LABEL,
    pages,
    materialClaims: materialDeck.length,
    materialClaimsPerPage: pages ? round(materialDeck.length / pages, 3) : null,
    quantitativeObservations: quantObs.length,
    quantitativeObservationsPerPage: pages ? round(quantObs.length / pages, 3) : null,
    unsupportedClaimRatio: material.length ? round(unsupported / material.length, 3) : null,
    redundantClaimPairs: pairs,
    redundancyRatio: pool.length ? round(redundant / pool.length, 3) : null,
    pagesWithoutDecisionFacts,
    shareOfPagesWithoutDecisionFacts: pages !== null && pages <= MAX_PAGES ? round(pagesWithoutDecisionFacts.length / pages, 3) : null,
  };
}
