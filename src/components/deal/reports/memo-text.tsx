import Link from "next/link";
import { Fragment } from "react";
import { RefChip } from "./evidence-drawer";

const LINK = "rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text print:bg-transparent print:px-0 print:text-ink-3";

/**
 * Report prose with evidence references. Claim and source references open
 * the evidence drawer (when rendered inside EvidenceDrawerProvider).
 */
export function MemoText({ text, slug }: { text: string | null | undefined; slug: string }) {
  if (!text) return null;
  const parts = text.split(/(\b(?:CLM|SRC|MET)-\d{3}\b|\bRSK-\d{2}\b|\bQ-\d{2}\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^(CLM|SRC)-\d{3}$/.test(p)) return <RefChip key={i} id={p} slug={slug} />;
        if (/^MET-\d{3}$/.test(p))
          return (
            <Link key={i} href={`/deals/${slug}/evidence?metric=${p}`} className={LINK}>
              {p}
            </Link>
          );
        if (/^RSK-\d{2}$/.test(p))
          return (
            <Link key={i} href={`/deals/${slug}/risks#${p}`} className={LINK}>
              {p}
            </Link>
          );
        if (/^Q-\d{2}$/.test(p))
          return (
            <Link key={i} href={`/deals/${slug}/questions#${p}`} className={LINK}>
              {p}
            </Link>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
