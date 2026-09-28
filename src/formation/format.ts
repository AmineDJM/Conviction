/** Formatting helpers shared by generators (pure). */
import type { MetricInstance } from "@/domain/canonical";
import { metricDef } from "@/engine/metrics/dictionary";
import { metricValue } from "@/lib/format";

export function formatMetric(m: Pick<MetricInstance, "metricKey" | "normalizedValue">): string {
  const def = metricDef(m.metricKey);
  return metricValue(def?.unit ?? "COUNT", m.normalizedValue);
}

/** Money with sensible precision for prompts ("$3.84M", "$2.18B", "$42k"). */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `${s}$${a.toFixed(0)}`;
}

export function pctText(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** Deterministic 32-bit FNV-1a hash → base36 (stable ids, seeded choices). */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function hashInt(s: string): number {
  return parseInt(hash(s), 36);
}

/** Deterministic shuffle seeded by a string (Fisher–Yates with an LCG). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const a = [...items];
  let x = hashInt(seed) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
