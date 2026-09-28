/**
 * Version comparison (§102, §131). Pure functions over two loaded versions:
 * what moved in the deterministic layer (recommendation, OQI, evidence,
 * power-law, dimensions), which primary metrics changed, which claims were
 * added or changed verification, and which questions were resolved.
 */
import type { CanonicalDeal, Claim, FounderQuestion, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";

export interface VersionSide {
  id: string;
  versionNo: number;
  reason: string;
  createdAt: string;
  canonical: CanonicalDeal;
  derived: DerivedAnalysis;
}

export interface VersionMeta {
  id: string;
  versionNo: number;
  reason: string;
  createdAt?: string;
  summary?: string | null;
}

export interface NumChange {
  from: number | null;
  to: number | null;
  delta: number | null;
  changed: boolean;
}

export interface ValueChange<T> {
  from: T;
  to: T;
  changed: boolean;
}

export interface MetricChange {
  metricKey: string;
  label: string;
  unit: string;
  kind: "ADDED" | "REMOVED" | "CHANGED";
  from: { id: string; value: number | null; raw: string; method: MetricInstance["calculationMethod"]; state: string; periodEnd: string | null } | null;
  to: { id: string; value: number | null; raw: string; method: MetricInstance["calculationMethod"]; state: string; periodEnd: string | null } | null;
}

export interface ClaimVerificationChange {
  id: string;
  statement: string;
  from: Claim["verification"];
  to: Claim["verification"];
}

export interface QuestionChange {
  id: string;
  question: string;
  tier: FounderQuestion["tier"];
  from: FounderQuestion["status"] | null;
  to: FounderQuestion["status"];
  answer: string | null;
}

export interface VersionDiff {
  from: Omit<VersionSide, "canonical" | "derived">;
  to: Omit<VersionSide, "canonical" | "derived">;
  recommendation: ValueChange<string>;
  oqi: { value: NumChange; lower: NumChange; upper: NumChange; coverage: NumChange; status: ValueChange<string> };
  evidence: { category: ValueChange<string>; index: NumChange };
  powerLaw: NumChange;
  riskHeadline: ValueChange<string>;
  mandate: ValueChange<string>;
  dimensions: { id: string; name: string; value: NumChange; coverage: NumChange; status: ValueChange<string> }[];
  metrics: MetricChange[];
  claims: { added: Pick<Claim, "id" | "statement" | "category" | "verification" | "material">[]; removed: Pick<Claim, "id" | "statement">[]; verificationChanged: ClaimVerificationChange[] };
  questions: { resolved: QuestionChange[]; changed: QuestionChange[]; added: QuestionChange[] };
  /** Count of individual changes across all groups. */
  changeCount: number;
}

const EPS = 1e-9;

function num(from: number | null | undefined, to: number | null | undefined, precision = 1): NumChange {
  const f = from ?? null;
  const t = to ?? null;
  const round = (x: number) => Math.round(x * 10 ** precision) / 10 ** precision;
  const changed = f === null || t === null ? f !== t : Math.abs(round(f) - round(t)) > EPS;
  return { from: f, to: t, delta: f !== null && t !== null ? t - f : null, changed };
}

function val<T>(from: T, to: T): ValueChange<T> {
  return { from, to, changed: from !== to };
}

function primaryByKey(ms: MetricInstance[]) {
  const map = new Map<string, MetricInstance>();
  for (const m of ms) if (m.isPrimary) map.set(m.metricKey, m);
  return map;
}

const metricSide = (m: MetricInstance | undefined) => (m ? { id: m.id, value: m.normalizedValue, raw: m.rawValue, method: m.calculationMethod, state: m.state, periodEnd: m.periodEnd } : null);

export function diffVersions(a: VersionSide, b: VersionSide): VersionDiff {
  const da = a.derived;
  const db = b.derived;

  // Dimensions (union by id, order of the newer version).
  const dimIds = [...new Set([...db.dimensions.map((d) => d.id), ...da.dimensions.map((d) => d.id)])];
  const dimensions = dimIds.map((id) => {
    const x = da.dimensions.find((d) => d.id === id);
    const y = db.dimensions.find((d) => d.id === id);
    return {
      id,
      name: y?.name ?? x?.name ?? id,
      value: num(x?.value, y?.value),
      coverage: num(x?.coverage, y?.coverage, 2),
      status: val<string>(x?.status ?? "—", y?.status ?? "—"),
    };
  });

  // Primary metrics.
  const pa = primaryByKey(a.canonical.metrics);
  const pb = primaryByKey(b.canonical.metrics);
  const metrics: MetricChange[] = [];
  for (const key of new Set([...pa.keys(), ...pb.keys()])) {
    const x = pa.get(key);
    const y = pb.get(key);
    const base = { metricKey: key, label: y?.label ?? x?.label ?? key, unit: y?.unit ?? x?.unit ?? "" };
    if (!x && y) metrics.push({ ...base, kind: "ADDED", from: null, to: metricSide(y) });
    else if (x && !y) metrics.push({ ...base, kind: "REMOVED", from: metricSide(x), to: null });
    else if (x && y) {
      const valueChanged = num(x.normalizedValue, y.normalizedValue, 4).changed;
      if (valueChanged || x.calculationMethod !== y.calculationMethod || x.state !== y.state) metrics.push({ ...base, kind: "CHANGED", from: metricSide(x), to: metricSide(y) });
    }
  }

  // Claims.
  const ca = new Map(a.canonical.claims.map((c) => [c.id, c]));
  const cb = new Map(b.canonical.claims.map((c) => [c.id, c]));
  const added = b.canonical.claims.filter((c) => !ca.has(c.id)).map((c) => ({ id: c.id, statement: c.statement, category: c.category, verification: c.verification, material: c.material }));
  const removed = a.canonical.claims.filter((c) => !cb.has(c.id)).map((c) => ({ id: c.id, statement: c.statement }));
  const verificationChanged = b.canonical.claims
    .filter((c) => ca.has(c.id) && ca.get(c.id)!.verification !== c.verification)
    .map((c) => ({ id: c.id, statement: c.statement, from: ca.get(c.id)!.verification, to: c.verification }));

  // Questions.
  const qa = new Map(a.canonical.questions.map((q) => [q.id, q]));
  const qResolved: QuestionChange[] = [];
  const qChanged: QuestionChange[] = [];
  const qAdded: QuestionChange[] = [];
  for (const q of b.canonical.questions) {
    const prev = qa.get(q.id);
    const row: QuestionChange = { id: q.id, question: q.question, tier: q.tier, from: prev?.status ?? null, to: q.status, answer: q.answer };
    if (!prev || prev.question !== q.question) qAdded.push(row);
    else if (prev.status !== "RESOLVED" && q.status === "RESOLVED") qResolved.push(row);
    else if (prev.status !== q.status || prev.answer !== q.answer) qChanged.push(row);
  }

  const diff: VersionDiff = {
    from: { id: a.id, versionNo: a.versionNo, reason: a.reason, createdAt: a.createdAt },
    to: { id: b.id, versionNo: b.versionNo, reason: b.reason, createdAt: b.createdAt },
    recommendation: val(da.recommendation.status, db.recommendation.status),
    oqi: {
      value: num(da.operatingQuality.value, db.operatingQuality.value),
      lower: num(da.operatingQuality.lower, db.operatingQuality.lower),
      upper: num(da.operatingQuality.upper, db.operatingQuality.upper),
      coverage: num(da.operatingQuality.coverage, db.operatingQuality.coverage, 2),
      status: val<string>(da.operatingQuality.status, db.operatingQuality.status),
    },
    evidence: { category: val<string>(da.evidence.category, db.evidence.category), index: num(da.evidence.index, db.evidence.index) },
    powerLaw: num(da.powerLaw.value, db.powerLaw.value),
    riskHeadline: val<string>(da.risk.headline ?? "—", db.risk.headline ?? "—"),
    mandate: val<string>(da.fundFit.mandate, db.fundFit.mandate),
    dimensions,
    metrics,
    claims: { added, removed, verificationChanged },
    questions: { resolved: qResolved, changed: qChanged, added: qAdded },
    changeCount: 0,
  };
  diff.changeCount =
    Number(diff.recommendation.changed) +
    Number(diff.oqi.value.changed || diff.oqi.lower.changed || diff.oqi.upper.changed || diff.oqi.coverage.changed) +
    Number(diff.evidence.category.changed || diff.evidence.index.changed) +
    Number(diff.powerLaw.changed) +
    Number(diff.riskHeadline.changed) +
    Number(diff.mandate.changed) +
    dimensions.filter((d) => d.value.changed || d.coverage.changed || d.status.changed).length +
    metrics.length +
    added.length +
    removed.length +
    verificationChanged.length +
    qResolved.length +
    qChanged.length +
    qAdded.length;
  return diff;
}

/**
 * Default comparison: before vs after the latest founder call; otherwise the
 * previous vs the current version. Preliminary deck versions are skipped as a
 * baseline when a later full deck analysis exists. `versions` may be in any order.
 */
export function defaultComparison(versions: VersionMeta[]): { fromId: string; toId: string } | null {
  if (versions.length < 2) return null;
  const sorted = [...versions].sort((x, y) => x.versionNo - y.versionNo);
  const lastCall = [...sorted].reverse().find((v) => v.reason === "FOUNDER_CALL");
  if (lastCall) {
    const idx = sorted.findIndex((v) => v.id === lastCall.id);
    if (idx > 0) return { fromId: sorted[idx - 1]!.id, toId: lastCall.id };
  }
  const cur = sorted[sorted.length - 1]!;
  const prev = sorted[sorted.length - 2]!;
  return { fromId: prev.id, toId: cur.id };
}

/* ---------------------------------------------------------------- */
/* Founder call: what changed (§65)                                   */
/* ---------------------------------------------------------------- */

export interface FounderCallChanges {
  newClaims: Pick<Claim, "id" | "statement" | "category" | "material">[];
  confirmed: { id: string; statement: string; note: string }[];
  changed: { id: string; statement: string; note: string }[];
  contradicted: { id: string; statement: string; note: string }[];
  unresolvedClaims: { id: string; statement: string; note: string }[];
  questionsResolved: QuestionChange[];
  questionsNotFullyResolved: QuestionChange[];
  /** Questions still open (OPEN / ASKED / NOT_FULLY_RESOLVED) after the call. */
  stillUnresolved: QuestionChange[];
  newMetrics: MetricChange[];
}

/** Claim history entries appended between the two versions, grouped by change type. */
export function founderCallChanges(before: CanonicalDeal, after: CanonicalDeal): FounderCallChanges {
  const prevClaims = new Map(before.claims.map((c) => [c.id, c]));
  const out: FounderCallChanges = { newClaims: [], confirmed: [], changed: [], contradicted: [], unresolvedClaims: [], questionsResolved: [], questionsNotFullyResolved: [], stillUnresolved: [], newMetrics: [] };
  for (const c of after.claims) {
    const prev = prevClaims.get(c.id);
    if (!prev) {
      out.newClaims.push({ id: c.id, statement: c.statement, category: c.category, material: c.material });
      continue;
    }
    for (const h of c.history.slice(prev.history.length)) {
      const row = { id: c.id, statement: c.statement, note: h.note };
      if (h.change === "CONFIRMED") out.confirmed.push(row);
      else if (h.change === "CHANGED" || h.change === "CLARIFIED") out.changed.push(row);
      else if (h.change === "CONTRADICTED") out.contradicted.push(row);
      else if (h.change === "UNRESOLVED") out.unresolvedClaims.push(row);
    }
  }
  const prevQ = new Map(before.questions.map((q) => [q.id, q]));
  for (const q of after.questions) {
    const p = prevQ.get(q.id);
    const row: QuestionChange = { id: q.id, question: q.question, tier: q.tier, from: p?.status ?? null, to: q.status, answer: q.answer };
    if (q.status === "RESOLVED") {
      if (p?.status !== "RESOLVED") out.questionsResolved.push(row);
    } else {
      out.stillUnresolved.push(row);
      if (q.status === "NOT_FULLY_RESOLVED" && p?.status !== "NOT_FULLY_RESOLVED") out.questionsNotFullyResolved.push(row);
    }
  }
  const prevIds = new Set(before.metrics.map((m) => m.id));
  for (const m of after.metrics)
    if (!prevIds.has(m.id) && m.calculationMethod !== "DERIVED")
      out.newMetrics.push({ metricKey: m.metricKey, label: m.label, unit: m.unit, kind: "ADDED", from: null, to: metricSide(m) });
  return out;
}
