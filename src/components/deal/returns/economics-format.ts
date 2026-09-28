/** Client- and server-safe formatting for the economics views. */
import { multiple, pct, titleCase, usd } from "@/lib/format";
import type { Tone } from "@/lib/format";

export function irrText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
}

/** Formats a counterfactual output by its label (units are implied by the engine's output names). */
export function outputValue(output: string, v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return titleCase(v);
  if (/MOIC|Burn multiple/.test(output)) return multiple(v, 2);
  if (/IRR/.test(output)) return irrText(v);
  if (/equity value/.test(output)) return usd(v, 1);
  if (/%/.test(output)) return pct(v, Math.abs(v) < 10 ? 1 : 0);
  if (/months/.test(output)) return `${v.toFixed(1)} mo`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const PLAUS_TONE: Record<string, Tone> = { PLAUSIBLE: "ok", DEMANDING: "warn", HEROIC: "risk", IMPLAUSIBLE: "risk", UNKNOWN: "unknown" };
export const RISK_TONE: Record<string, Tone> = { LOW: "ok", MODERATE: "warn", HIGH: "risk", CRITICAL: "risk", UNKNOWN: "unknown" };

export function sensValue(unit: string, v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  switch (unit) {
    case "USD":
      return usd(v, 1);
    case "USD_PER_MONTH":
      return `${usd(v, 1)}/mo`;
    case "PCT":
      return pct(v, Math.abs(v) < 10 ? 1 : 0);
    case "MONTHS":
      return `${v.toFixed(1)} mo`;
    case "MULTIPLE":
      return multiple(v, 2);
    default:
      return String(v);
  }
}
