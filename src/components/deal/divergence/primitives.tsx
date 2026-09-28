/**
 * Server-safe building blocks of the Divergence tab. Every value states its
 * basis; unknowns are rendered explicitly, never hidden.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { ComputedValue, DivergenceBasis, DivergenceLevel } from "@/engine/divergence";
import { Badge, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { compactUsd } from "@/components/deal/tabs/shared";

export const LEVEL_TEXT: Record<DivergenceLevel, string> = {
  STRONG: "Strong",
  ADEQUATE: "Adequate",
  WEAK: "Weak",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export function levelTone(l: DivergenceLevel): Tone {
  return l === "STRONG" ? "ok" : l === "ADEQUATE" ? "neutral" : l === "WEAK" ? "risk" : "unknown";
}

/** Ordinal level — never a probability, never a score. */
export function LevelChip({ level }: { level: DivergenceLevel }) {
  return (
    <Badge tone={levelTone(level)} dot={level !== "INSUFFICIENT_EVIDENCE"} title={level === "INSUFFICIENT_EVIDENCE" ? "The materials do not allow a reading. Nothing is inferred in its place." : "Ordinal level for a venture outcome — not a probability"}>
      {LEVEL_TEXT[level]}
    </Badge>
  );
}

const BASIS: Record<DivergenceBasis, { text: string; tone: Tone; title: string }> = {
  COMPUTED: { text: "Computed", tone: "neutral", title: "Derived by code from structured data" },
  MODEL_OBSERVED: { text: "Deck", tone: "unknown", title: "Read by the model from the deck — an observation, not a judgement" },
  MODEL_ASSUMPTION: { text: "Assumption", tone: "warn", title: "A versioned engine convention (MODEL_ASSUMPTION), not a fact about the company" },
  RESEARCH: { text: "Research", tone: "accent", title: "External research findings" },
};

export function BasisChip({ b }: { b: DivergenceBasis }) {
  const x = BASIS[b];
  return (
    <Badge tone={x.tone} title={x.title} className="!text-[10.5px]">
      {x.text}
    </Badge>
  );
}

/** Deck page links into the evidence explorer. */
export function PageLinks({ pages, slug, docId }: { pages: number[]; slug: string; docId: string | null }) {
  const ps = [...new Set(pages.filter((p) => p > 0))].sort((a, b) => a - b);
  if (!ps.length) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 whitespace-nowrap text-[11.5px] text-ink-3">
      <span>p.</span>
      {ps.map((p, i) => (
        <span key={p} className="num">
          {docId ? (
            <Link href={`/deals/${slug}/evidence?doc=${docId}&page=${p}`} className="hover:text-accent-text hover:underline">
              {p}
            </Link>
          ) : (
            p
          )}
          {i < ps.length - 1 ? "," : ""}
        </span>
      ))}
    </span>
  );
}

/** Claim / metric / source ref chips. */
export function RefChips({ refs, slug }: { refs: string[]; slug: string }) {
  if (!refs.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => {
        const kind = /^CLM-/.test(r) ? "claim" : /^MET-/.test(r) ? "metric" : /^SRC-/.test(r) ? "source" : null;
        return kind ? (
          <Link key={r} href={`/deals/${slug}/evidence?${kind}=${r}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
            {r}
          </Link>
        ) : (
          <span key={r} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-3">
            {r}
          </span>
        );
      })}
    </span>
  );
}

export function fmtComputed(v: ComputedValue): string | null {
  if (v.value === null || v.value === "") return null;
  if (typeof v.value === "string") return /^[A-Z0-9_]+$/.test(v.value) ? titleCase(v.value) : v.value;
  const n = v.value;
  switch (v.unit) {
    case "USD":
      return compactUsd(n);
    case "PCT":
      return `${+n.toFixed(1)}%`;
    case "MONTHS":
      return `${+n.toFixed(1)} mo`;
    case "MULTIPLE":
      return `${+n.toFixed(1)}×`;
    case "COUNT":
      return Number.isInteger(n) ? n.toLocaleString("en-US") : String(+n.toFixed(1));
    default:
      return String(+n.toFixed(2));
  }
}

/** Computed numbers of a factor; unknown values are shown as unknown, not dropped. */
export function Numbers({ values }: { values: ComputedValue[] }) {
  if (!values.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {values.map((v) => {
        const s = fmtComputed(v);
        return (
          <div key={v.key} className="min-w-0">
            <dt className="text-[11.5px] leading-snug text-ink-3">{v.label}</dt>
            <dd className={cx("num mt-0.5 text-[15px] font-semibold tracking-tight", s === null ? "font-normal italic text-unknown" : "text-ink")}>
              {s ?? "Unknown"}
              {s !== null && v.basis !== "COMPUTED" && <span className="ml-1.5 align-middle text-[10.5px] font-normal not-italic text-ink-3">{v.basis === "MODEL_OBSERVED" ? "deck" : v.basis === "MODEL_ASSUMPTION" ? "assumption" : "research"}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function SubLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="t-eyebrow">{children}</div>
      {aside && <div className="text-[11.5px] text-ink-3">{aside}</div>}
    </div>
  );
}

/** Horizontal scroll on phones instead of overflowing the page. */
export function ScrollTable({ children, minWidth = 560 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full border-collapse text-[12.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function label(s: string): string {
  return titleCase(s).replace(/\bAi\b/g, "AI").replace(/\bApi\b/g, "API").replace(/\bGtm\b/g, "GTM").replace(/\bIp\b/g, "IP");
}
