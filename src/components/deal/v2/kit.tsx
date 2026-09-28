/**
 * Small, server-safe building blocks shared by the v2 engine views
 * (Decision core, Integrity, Signals, Returns economics, Portfolio intelligence).
 * Everything states its basis; unknowns are rendered explicitly, never hidden.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";

export function sevTone(s: string | null | undefined): Tone {
  switch (s) {
    case "CRITICAL":
    case "HIGH":
      return "risk";
    case "MODERATE":
      return "warn";
    case "LOW":
      return "neutral";
    default:
      return "unknown";
  }
}

/** Severity of a finding (CRITICAL / HIGH / MODERATE / LOW). */
export function Sev({ s }: { s: string | null | undefined }) {
  if (!s) return <Badge tone="unknown">n/a</Badge>;
  return (
    <Badge tone={sevTone(s)} dot={s === "CRITICAL"}>
      {titleCase(s)}
    </Badge>
  );
}

/** COMPUTED = deterministic rule in code; MODEL = reported by the model and kept for comparison. */
export function Origin({ o }: { o: "COMPUTED" | "MODEL" | string }) {
  return o === "COMPUTED" ? (
    <Badge tone="neutral" title="Deterministic rule computed by code from the canonical object">
      Computed
    </Badge>
  ) : (
    <Badge tone="unknown" title="Reported by the model (deck forensics). Kept for comparison; not verified by code.">
      Model
    </Badge>
  );
}

const BASIS_TEXT: Record<string, { text: string; tone: Tone; title: string }> = {
  COMPUTED: { text: "Computed", tone: "neutral", title: "Derived by code from structured data" },
  MODEL_OBSERVED: { text: "Model-observed", tone: "unknown", title: "Read by the model from the deck" },
  OBSERVED_IN_DECK: { text: "Observed in deck", tone: "neutral", title: "Directly observable in the materials" },
  INFERRED: { text: "Inferred", tone: "warn", title: "An inference from observable signals — a hypothesis, not a fact" },
};

export function BasisBadge({ b }: { b: string }) {
  const x = BASIS_TEXT[b] ?? { text: titleCase(b), tone: "neutral" as Tone, title: b };
  return (
    <Badge tone={x.tone} title={x.title}>
      {x.text}
    </Badge>
  );
}

/** Quality levels (WEAK → EXCEPTIONAL) and risk levels (LOW → HIGH). INSUFFICIENT_EVIDENCE is always explicit. */
export function LevelBadge({ level, kind = "quality" }: { level: string; kind?: "quality" | "risk" }) {
  if (level === "INSUFFICIENT_EVIDENCE" || level === "UNKNOWN" || level === "UNCLEAR" || level === "NOT_ASSESSED")
    return (
      <Badge tone="unknown" title="The materials do not allow a reading. Nothing is inferred in its place.">
        {level === "UNCLEAR" ? "Unclear" : level === "NOT_ASSESSED" ? "Not assessed" : "Insufficient evidence"}
      </Badge>
    );
  const tone: Tone =
    kind === "risk"
      ? level === "HIGH" || level === "CRITICAL" || level === "VERY_HIGH"
        ? "risk"
        : level === "MODERATE"
          ? "warn"
          : "ok"
      : level === "EXCEPTIONAL" || level === "STRONG" || level === "CONSISTENT" || level === "DEMONSTRATED" || level === "PLAUSIBLE"
        ? "ok"
        : level === "MODERATE" || level === "PARTIAL" || level === "STRETCHED" || level === "DEMANDING"
          ? "warn"
          : level === "WEAK" || level === "DISCONNECTED" || level === "CONTRADICTED" || level === "HEROIC" || level === "IMPLAUSIBLE"
            ? "risk"
            : "neutral";
  return <Badge tone={tone}>{titleCase(level)}</Badge>;
}

/** Deck page references; linked to the raw page when the deck document is known. */
export function Pages({ pages, slug, docId, className }: { pages: (number | null | undefined)[]; slug: string; docId?: string | null; className?: string }) {
  const ps = [...new Set(pages.filter((p): p is number => typeof p === "number" && p > 0))].sort((a, b) => a - b);
  if (!ps.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-1 text-[11.5px] text-ink-3", className)}>
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

/** Evidence ref chips (CLM / MET / SRC / RSK / Q / GAP). */
export function Refs({ refs, slug }: { refs: string[]; slug: string }) {
  if (!refs.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => {
        const href = /^CLM-/.test(r)
          ? `/deals/${slug}/evidence?claim=${r}`
          : /^MET-/.test(r)
            ? `/deals/${slug}/evidence?metric=${r}`
            : /^SRC-/.test(r)
              ? `/deals/${slug}/evidence?source=${r}`
              : /^RSK-/.test(r)
                ? `/deals/${slug}/risks#${r}`
                : /^(Q|GAP)-/.test(r)
                  ? `/deals/${slug}/questions#${r}`
                  : null;
        return href ? (
          <Link key={r} href={href} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
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

/** "Unknown" rendered as a fact, not as an empty cell. */
export function Unknown({ children = "Unknown" }: { children?: ReactNode }) {
  return <span className="text-unknown italic">{children}</span>;
}

/** Sub-heading inside a section. */
export function SubHead({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
      {aside && <div className="text-[11.5px] text-ink-3">{aside}</div>}
    </div>
  );
}

/** A stated rule / formula line. */
export function Rule({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[11.5px] leading-relaxed text-ink-3", className)}>{children}</p>;
}

/** Labelled count in a summary strip. */
export function Stat({ k, v, tone, sub }: { k: ReactNode; v: ReactNode; tone?: Tone; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-ink-3">{k}</div>
      <div className={cx("num text-[17px] font-semibold tracking-tight", tone === "risk" ? "text-risk" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "unknown" ? "text-unknown" : "text-ink")}>{v}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Sticky in-page navigation for long tabs (wraps on phones). */
export function InPageNav({ items }: { items: { href: string; label: string; count?: number | null }[] }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1.5 border-b border-line pb-3 text-[12.5px] text-ink-3">
      {items.map((it) => (
        <a key={it.href} href={it.href} className="whitespace-nowrap hover:text-ink">
          {it.label}
          {it.count !== undefined && it.count !== null && <span className="num ml-1 text-ink-3">{it.count}</span>}
        </a>
      ))}
    </nav>
  );
}

/** A table that scrolls horizontally on phones instead of overflowing the page. */
export function Table({ children, minWidth = 560, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cx("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <table className="w-full border-collapse text-[12.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function NotComputed({ what }: { what: string }) {
  return (
    <p className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-3">
      {what} was not computed for this version (it predates the engine). Recalculate the portfolio from Benchmarks to compute it; nothing is estimated in its place.
    </p>
  );
}
