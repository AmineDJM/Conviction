/** Client-safe formatting and label helpers. */

export function usd(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits + 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function multiple(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}×`;
}

export function metricValue(unit: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  switch (unit) {
    case "USD":
      return usd(v, v >= 1e6 ? 2 : 1);
    case "PERCENT":
      return pct(v, Math.abs(v) < 10 ? 1 : 0);
    case "MONTHS":
      return `${v.toFixed(v < 10 ? 1 : 0)} mo`;
    case "DAYS":
      return `${v.toFixed(0)} d`;
    case "MULTIPLE":
    case "RATIO":
      return multiple(v, 2);
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

export function date(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  // Fixed time zone: the server (UTC) and the browser must render the same text (hydration).
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Depends on the current time: in client components render it through <Ago> (ui.tsx), which tolerates the server/client clock difference. */
export function relative(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date(s);
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/\bai\b/g, "AI")
    .replace(/\bgtm\b/g, "GTM")
    .replace(/\bic\b/g, "IC")
    .replace(/\bip\b/g, "IP")
    .replace(/\bsaas\b/gi, "SaaS")
    .replace(/\bplg\b/g, "PLG")
    .replace(/\bsmb\b/g, "SMB")
    .replace(/\bapi\b/g, "API")
    .replace(/\bpmf\b/g, "PMF");
}

export const DECISION_LABEL: Record<string, string> = {
  SCREEN_OUT: "Screen out",
  NEEDS_FOUNDER_CALL: "Needs founder call",
  NEEDS_TARGETED_DILIGENCE: "Targeted diligence",
  DEEP_DD: "Deep DD",
  IC_READY: "IC ready",
  ANALYTICAL_RECOMMEND_INVEST: "Recommend invest",
  WATCH: "Watch",
  ANALYTICAL_RECOMMEND_PASS: "Recommend pass",
};

export const STAGE_LABEL: Record<string, string> = {
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A: "Series A",
  SERIES_B: "Series B",
  SERIES_C_PLUS: "Series C+",
  UNKNOWN: "Unknown",
};

export type Tone = "neutral" | "accent" | "ok" | "warn" | "risk" | "unknown";

export function decisionTone(s: string | null | undefined): Tone {
  switch (s) {
    case "ANALYTICAL_RECOMMEND_INVEST":
    case "IC_READY":
      return "ok";
    case "DEEP_DD":
    case "NEEDS_TARGETED_DILIGENCE":
    case "NEEDS_FOUNDER_CALL":
      return "accent";
    case "WATCH":
      return "warn";
    case "SCREEN_OUT":
    case "ANALYTICAL_RECOMMEND_PASS":
      return "unknown";
    default:
      return "neutral";
  }
}

export function levelTone(l: string | null | undefined): Tone {
  switch (l) {
    case "CRITICAL":
    case "HIGH":
      return "risk";
    case "MODERATE":
      return "warn";
    case "LOW":
      return "ok";
    default:
      return "unknown";
  }
}

export function evidenceTone(l: string | null | undefined): Tone {
  switch (l) {
    case "VERY_HIGH":
    case "HIGH":
      return "ok";
    case "MODERATE":
      return "warn";
    case "LOW":
      return "risk";
    default:
      return "unknown";
  }
}

export const EVIDENCE_LABEL_TEXT: Record<string, string> = {
  VERIFIED: "Verified",
  COMPANY_REPORTED: "Company-reported",
  INFERRED: "Inferred",
  ESTIMATED: "Estimated",
  UNKNOWN: "Unknown",
  CONTRADICTED: "Contradicted",
};

export function evidenceLabelTone(l: string): Tone {
  return l === "VERIFIED" ? "ok" : l === "CONTRADICTED" ? "risk" : l === "COMPANY_REPORTED" ? "neutral" : l === "UNKNOWN" ? "unknown" : "warn";
}
