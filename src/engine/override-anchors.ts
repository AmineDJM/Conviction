/**
 * OVERRIDE ANCHORS (pure, deterministic).
 *
 * Canonical ids (MET-007, CLM-012) are assigned per analysis and change when a
 * deck is re-analysed. An override therefore stores, next to the id, a stable
 * description of what it targets:
 *   METRIC          metricKey + period end + chronology basis (+ label for OTHER)
 *   CLAIM           hash of the normalized statement (+ proposition hash)
 *   CLASSIFICATION  field path ("classification.financingStage")
 *   ENTITY          field path ("identity.hqCountry")
 * `findAnchorTarget` looks the anchor up in another analysis. Matching is
 * strict: a metric is only re-anchored on the SAME period (an override of ARR
 * as of 2025-12 never silently moves onto ARR as of 2026-06), and an ambiguous
 * match is refused rather than guessed.
 */
import type { CanonicalDeal, Claim, MetricInstance, OverrideAnchor } from "@/domain/canonical";

type Target = "METRIC" | "CLASSIFICATION" | "ENTITY" | "CLAIM";

/** Lower-case, accents and punctuation stripped, whitespace collapsed (comparison only). */
export function normStatement(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)[.,](?=\d{3}\b)/g, "$1")
    .replace(/[^\p{L}\p{N}%$€£.\s]/gu, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a (two 32-bit lanes → 16 hex chars). Stable across runtimes; no crypto dependency. */
export function stableHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

const STOP = new Set(["the", "and", "for", "with", "our", "are", "from", "that", "this", "has", "have", "its", "was", "were", "per", "into", "than", "des", "les", "est", "une", "pour", "par"]);
function tokens(s: string): Set<string> {
  return new Set(
    normStatement(s)
      .split(" ")
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Minimum token similarity for a SIMILAR claim match, and the margin it must hold over the runner-up. */
export const CLAIM_SIMILARITY = 0.6;
export const CLAIM_MARGIN = 0.15;

const labelKey = (s: string) => normStatement(s).replace(/\s+/g, "");

function metricAnchor(m: MetricInstance): OverrideAnchor {
  return { kind: "METRIC", metricKey: m.metricKey, label: m.label, periodEnd: m.periodEnd, periodType: m.periodType, basis: m.basis };
}

function claimAnchor(c: Claim): OverrideAnchor {
  const statement = normStatement(c.statement);
  return { kind: "CLAIM", category: c.category, statement, statementHash: stableHash(statement), propositionHash: c.proposition ? stableHash(normStatement(c.proposition)) : null };
}

/** The anchor of (target, ref, field) in `deal`; null when the target is not in it. */
export function anchorFor(deal: CanonicalDeal, o: { target: Target; ref: string; field: string }): OverrideAnchor | null {
  switch (o.target) {
    case "METRIC": {
      const m = deal.metrics.find((x) => x.id === o.ref);
      return m ? metricAnchor(m) : null;
    }
    case "CLAIM": {
      const c = deal.claims.find((x) => x.id === o.ref);
      return c ? claimAnchor(c) : null;
    }
    case "CLASSIFICATION":
    case "ENTITY":
      return { kind: "FIELD", path: `${o.ref}.${o.field}` };
  }
}

/** "ARR · period 2025-12 · basis CURRENT" / "claim “ARR reached $3.84M”" / "classification.financingStage". */
export function describeAnchor(a: OverrideAnchor): string {
  if (a.kind === "METRIC") return `${a.label || a.metricKey} · period ${a.periodEnd ?? "not stated"} · basis ${a.basis}`;
  if (a.kind === "CLAIM") return `claim “${a.statement.length > 90 ? `${a.statement.slice(0, 87)}…` : a.statement}”`;
  return a.path;
}

const sameMetric = (m: MetricInstance, a: Extract<OverrideAnchor, { kind: "METRIC" }>) => m.metricKey === a.metricKey && (a.metricKey !== "OTHER" || labelKey(m.label) === labelKey(a.label));

const byPrimaryThenId = (a: { id: string; isPrimary?: boolean }, b: { id: string; isPrimary?: boolean }) => Number(!!b.isPrimary) - Number(!!a.isPrimary) || a.id.localeCompare(b.id, "en", { numeric: true });

export type AnchorMatch = "EXACT" | "PERIOD" | "STATEMENT" | "SIMILAR" | "FIELD";
export type AnchorLookup = { ref: string; match: AnchorMatch } | { ref: null; reason: string };

/**
 * Finds the target an anchor designates in `deal`. Deterministic: ties break
 * on primary instance, then on id. Refuses (ref null + reason) when nothing
 * matches or the match is ambiguous.
 */
export function findAnchorTarget(deal: CanonicalDeal, a: OverrideAnchor): AnchorLookup {
  if (a.kind === "FIELD") {
    const [root] = a.path.split(".");
    return root === "classification" || root === "identity" ? { ref: root, match: "FIELD" } : { ref: null, reason: `unknown field ${a.path}` };
  }
  if (a.kind === "METRIC") {
    // Derived metrics are recomputed by code and never carry overrides.
    const pool = deal.metrics.filter((m) => m.calculationMethod !== "DERIVED" && sameMetric(m, a));
    const exact = pool.filter((m) => m.periodEnd === a.periodEnd && m.basis === a.basis).sort(byPrimaryThenId);
    if (exact.length) return { ref: exact[0]!.id, match: "EXACT" };
    const period = pool.filter((m) => m.periodEnd === a.periodEnd);
    if (period.length === 1) return { ref: period[0]!.id, match: "PERIOD" };
    if (period.length > 1) return { ref: null, reason: `${a.label || a.metricKey} for ${a.periodEnd ?? "an unstated period"} appears ${period.length} times with other bases (${[...new Set(period.map((m) => m.basis))].join(", ")}); not re-applied to avoid guessing` };
    if (pool.length) {
      const periods = [...new Set(pool.map((m) => m.periodEnd ?? "no period"))].join(", ");
      return { ref: null, reason: `the new analysis reports ${a.label || a.metricKey} for ${periods}, not for ${a.periodEnd ?? "an unstated period"}` };
    }
    return { ref: null, reason: `${a.label || a.metricKey} (${a.periodEnd ?? "no period"}) is not in the new analysis` };
  }
  // CLAIM
  const claims = [...deal.claims].sort((x, y) => x.id.localeCompare(y.id, "en", { numeric: true }));
  const byHash = claims.filter((c) => stableHash(normStatement(c.statement)) === a.statementHash);
  if (byHash.length) {
    const sameCat = byHash.find((c) => c.category === a.category);
    return { ref: (sameCat ?? byHash[0]!).id, match: "STATEMENT" };
  }
  if (a.propositionHash) {
    const byProp = claims.filter((c) => c.proposition && stableHash(normStatement(c.proposition)) === a.propositionHash);
    if (byProp.length === 1) return { ref: byProp[0]!.id, match: "STATEMENT" };
  }
  const t = tokens(a.statement);
  const scored = claims
    .map((c) => ({ c, s: jaccard(tokens(c.statement), t) + (c.category === a.category ? 0.05 : 0) }))
    .sort((x, y) => y.s - x.s || x.c.id.localeCompare(y.c.id, "en", { numeric: true }));
  const best = scored[0];
  const second = scored[1]?.s ?? 0;
  if (best && best.s >= CLAIM_SIMILARITY && best.s - second >= CLAIM_MARGIN) return { ref: best.c.id, match: "SIMILAR" };
  if (best && best.s >= CLAIM_SIMILARITY) return { ref: null, reason: `several claims of the new analysis resemble ${describeAnchor(a)}; not re-applied to avoid guessing` };
  return { ref: null, reason: `${describeAnchor(a)} is not in the new analysis` };
}

/**
 * Guard at application time: does `ref` in `deal` still designate the anchored
 * target? Protects against ids that were reused for another metric or claim.
 */
export function anchorHolds(deal: CanonicalDeal, target: Target, ref: string, a: OverrideAnchor): boolean {
  if (a.kind === "FIELD") return target === "CLASSIFICATION" || target === "ENTITY";
  if (a.kind === "METRIC") {
    const m = deal.metrics.find((x) => x.id === ref);
    return !!m && sameMetric(m, a) && m.periodEnd === a.periodEnd;
  }
  const c = deal.claims.find((x) => x.id === ref);
  if (!c) return false;
  if (stableHash(normStatement(c.statement)) === a.statementHash) return true;
  if (a.propositionHash && c.proposition && stableHash(normStatement(c.proposition)) === a.propositionHash) return true;
  return jaccard(tokens(c.statement), tokens(a.statement)) >= CLAIM_SIMILARITY;
}
