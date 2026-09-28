/** Client-safe labels and tones for the evidence dimensions (§60, §86). Color is never the only signal. */
import type { Claim, MetricInstance, Source } from "@/domain/canonical";
import type { EvidenceLabel } from "@/domain/enums";
import type { Tone } from "@/lib/format";

export type EvidenceClaim = Claim & { label: EvidenceLabel };

export interface MetricDefLite {
  key: string;
  name: string;
  shortName: string;
  definition: string;
  formula: string | null;
  unit: string;
  period: string;
  direction: string;
  disambiguation: string[];
  requiredFields: string[];
  exclusions: string[];
  maxAgeMonths: number;
  minSampleSize: number | null;
  minMeasurementMonths: number | null;
}

export interface DocLite {
  id: string;
  filename: string;
  kind: string;
  pages: { pageNo: number; text: string }[];
}

export type Selection = { kind: "claim"; id: string } | { kind: "source"; id: string } | { kind: "metric"; id: string } | { kind: "doc"; id: string; page: number };

export const VERIFICATION_TEXT: Record<Claim["verification"], string> = {
  VERIFIED: "Verified",
  PARTIALLY_VERIFIED: "Partially verified",
  UNVERIFIED: "Unverified",
  CONTRADICTED: "Contradicted",
};
export const verificationTone = (v: string): Tone => (v === "VERIFIED" ? "ok" : v === "CONTRADICTED" ? "risk" : v === "PARTIALLY_VERIFIED" ? "accent" : "unknown");

export const INDEPENDENCE_TEXT: Record<Claim["independence"], string> = {
  INDEPENDENT: "Independent",
  SHARED_ORIGIN: "Shared origin",
  COMPANY_DERIVED: "Company-derived",
};
export const independenceTone = (v: string): Tone => (v === "INDEPENDENT" ? "ok" : v === "SHARED_ORIGIN" ? "warn" : "neutral");

export const FRESHNESS_TEXT: Record<Claim["freshness"], string> = { CURRENT: "Current", AGING: "Aging", STALE: "Stale" };
export const freshnessTone = (v: string): Tone => (v === "STALE" ? "risk" : v === "AGING" ? "warn" : "neutral");

export const ORIGIN_TEXT: Record<Source["origin"], string> = {
  COMPANY: "Company",
  PRIMARY_EXTERNAL: "Primary external",
  INDEPENDENT_SECONDARY: "Independent secondary",
  ANECDOTAL: "Anecdotal",
};

export const EFFECT_TEXT: Record<Claim["evidence"][number]["effect"], string> = {
  ORIGIN: "Origin",
  CONFIRMS: "Confirms",
  PARTIALLY_CONFIRMS: "Partially confirms",
  CONTRADICTS: "Contradicts",
  NEW_INFORMATION: "New information",
};
export const effectTone = (e: string): Tone => (e === "CONFIRMS" ? "ok" : e === "PARTIALLY_CONFIRMS" ? "accent" : e === "CONTRADICTS" ? "risk" : "neutral");

export const HISTORY_TEXT: Record<Claim["history"][number]["change"], string> = {
  CREATED: "Created",
  CONFIRMED: "Confirmed",
  CLARIFIED: "Clarified",
  CHANGED: "Changed",
  CONTRADICTED: "Contradicted",
  UNRESOLVED: "Unresolved",
  CORRECTED: "Corrected",
};

export const METHOD_TEXT: Record<MetricInstance["calculationMethod"], string> = { REPORTED: "Reported", DERIVED: "Derived", USER_CORRECTED: "User-corrected" };

export const STATE_TEXT: Record<MetricInstance["state"], string> = {
  OBSERVED: "Observed",
  UNKNOWN: "Unknown",
  NOT_APPLICABLE: "Not applicable",
  NOT_YET_MEANINGFUL: "Not yet meaningful",
  WITHHELD: "Withheld",
  CONTRADICTED: "Contradicted",
  STALE: "Stale",
  INFERRED: "Inferred",
};
export const stateTone = (s: string): Tone => (s === "CONTRADICTED" ? "risk" : s === "STALE" || s === "INFERRED" ? "warn" : s === "OBSERVED" ? "neutral" : "unknown");

export const SOURCE_KIND_TEXT: Record<Source["kind"], string> = { DOCUMENT: "Document", WEB: "Web", TRANSCRIPT: "Transcript", USER_INPUT: "User input" };

/** "p. 7", "page 7", "p.7" → 7 */
export function pageFromLocation(loc: string | null | undefined): number | null {
  if (!loc) return null;
  const m = /\bp(?:age|\.)?\s*(\d{1,4})\b/i.exec(loc);
  return m ? Number(m[1]) : null;
}

export function isUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//i.test(s);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Unit hint for the correction form. */
export function unitHint(unit: string): string {
  switch (unit) {
    case "USD":
      return "USD — e.g. 3200000 or 3.2M";
    case "PERCENT":
      return "percent — e.g. 112 for 112%";
    case "MONTHS":
      return "months";
    case "DAYS":
      return "days";
    case "MULTIPLE":
    case "RATIO":
      return "multiple — e.g. 1.4";
    default:
      return "count";
  }
}

/** Parses "3.2M", "$1,200,000", "450k", "112%" into a number. */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(/[$,\s]/g, "").replace(/%$/, "");
  const m = /^(-?\d+(?:\.\d+)?)([kmb])?$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  const v = n * mult;
  return Number.isFinite(v) ? v : null;
}
