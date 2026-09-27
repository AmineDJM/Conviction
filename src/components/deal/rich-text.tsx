import Link from "next/link";
import { Fragment } from "react";

/**
 * Renders analysis prose with claim / source / metric / risk references
 * (CLM-012, SRC-004, MET-003, RSK-02, Q-03) turned into links to the evidence.
 */
export function RichText({ text, slug, className }: { text: string | null | undefined; slug: string; className?: string }) {
  if (!text) return null;
  const parts = text.split(/(\b(?:CLM|SRC|MET)-\d{3}\b|\bRSK-\d{2}\b|\bQ-\d{2}\b)/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (/^(CLM|SRC|MET)-\d{3}$/.test(p)) {
          const kind = p.startsWith("CLM") ? "claim" : p.startsWith("SRC") ? "source" : "metric";
          return (
            <Link key={i} href={`/deals/${slug}/evidence?${kind}=${p}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
              {p}
            </Link>
          );
        }
        if (/^RSK-\d{2}$/.test(p))
          return (
            <Link key={i} href={`/deals/${slug}/risks#${p}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
              {p}
            </Link>
          );
        if (/^Q-\d{2}$/.test(p))
          return (
            <Link key={i} href={`/deals/${slug}/questions#${p}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
              {p}
            </Link>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </span>
  );
}
