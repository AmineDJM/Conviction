import Link from "next/link";
import type { ReactNode } from "react";
import type { TranscriptRefView } from "@/domain/meetings";
import { formatTimestamp } from "@/domain/meetings";
import { Badge, cx } from "@/components/ui";
import type { Tone } from "@/lib/format";

export const STAGE_TONE: Record<string, Tone> = { PRE_MEETING_ANALYSIS: "neutral", POST_MEETING_ANALYSIS: "accent", DECK_REANALYSIS: "warn" };

export function StageBadge({ stage, label, className }: { stage: string; label: string; className?: string }) {
  return (
    <Badge tone={STAGE_TONE[stage] ?? "neutral"} className={className} title={stage === "DECK_REANALYSIS" ? "The deck was re-analysed after a founder meeting; this version does not include the founder discussion." : undefined}>
      {label}
    </Badge>
  );
}

export const LEVEL_TONE: Record<string, Tone> = { UNKNOWN: "unknown", CONCERN: "risk", ADEQUATE: "neutral", STRENGTH: "ok" };
export const LEVEL_TEXT: Record<string, string> = { UNKNOWN: "Unknown", CONCERN: "Concern", ADEQUATE: "Adequate", STRENGTH: "Strength" };

/** Links into the verbatim transcript: "T-12 · 04:31 · Maya". */
export function TranscriptRefs({ refs, href, speakerNames = {}, className }: { refs: TranscriptRefView[]; href: string; speakerNames?: Record<string, string>; className?: string }) {
  if (!refs.length) return <span className={cx("text-[0.85em] text-warn", className)} title="The model's statement could not be located verbatim in the transcript">not anchored in transcript</span>;
  return (
    <span className={cx("inline-flex flex-wrap gap-1", className)}>
      {refs.map((r) => {
        const ts = formatTimestamp(r.startSec);
        const who = r.speaker ? (speakerNames[r.speaker] ?? r.speaker) : null;
        return (
          <Link
            key={r.ref}
            href={`${href}#${r.ref}`}
            title={`“${r.excerpt}”`}
            className="num whitespace-nowrap rounded-[4px] border border-line bg-surface px-1 font-mono text-[0.78em] leading-[1.6] text-ink-2 hover:border-accent/40 hover:text-accent-text print:border-0 print:px-0"
          >
            {r.ref}
            {ts && ` · ${ts}`}
            {who && <span className="font-sans text-ink-3"> · {who.replace(/\s*\(.*\)$/, "")}</span>}
          </Link>
        );
      })}
    </span>
  );
}

export function SheetSection({ n, title, children, note, className }: { n?: number; title: string; children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <section className={cx("brief-sec border-t border-line pt-3.5 print:pt-[0.7em]", className)}>
      <h2 className="mb-2 flex items-baseline gap-2 print:mb-[0.4em]">
        {n !== undefined && <span className="num text-[0.8em] font-semibold text-ink-3">{String(n).padStart(2, "0")}</span>}
        <span className="text-[0.8em] font-semibold uppercase tracking-[0.08em] text-ink-2">{title}</span>
        {note && <span className="ml-auto text-[0.78em] font-normal normal-case tracking-normal text-ink-3">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[0.95em] text-ink-3">{children}</p>;
}

export const BRIEF_PRINT_CSS = `
@media print {
  .brief-doc { font-size: 8.8pt; line-height: 1.38; }
  .brief-doc a { color: inherit; text-decoration: none; }
  .brief-item, .brief-q, tr { break-inside: avoid; }
  .brief-sec h2 { break-after: avoid; }
  @page { margin: 11mm 12mm; }
}
`;
