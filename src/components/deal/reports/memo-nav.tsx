"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/** Sticky section navigation with scroll-spy for long reports. */
export function MemoNav({ sections }: { sections: { id: string; title: string; missing?: boolean }[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((x): x is HTMLElement => !!x);
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-130px 0px -65% 0px", threshold: 0 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Memo sections" className="no-print sticky top-[132px] hidden max-h-[calc(100dvh-150px)] overflow-y-auto pb-6 lg:block">
      <div className="t-eyebrow mb-2 px-2">Contents</div>
      <ol className="space-y-px text-[12.5px]">
        {sections.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={() => setActive(s.id)}
              className={cx(
                "flex gap-2 rounded-md px-2 py-[3px] transition-colors",
                active === s.id ? "bg-surface-2 font-medium text-ink" : "text-ink-3 hover:text-ink",
                s.missing && active !== s.id && "text-ink-3/60",
              )}
            >
              <span className="num w-4 shrink-0 text-right text-[11px] text-ink-3">{i + 1}</span>
              <span className="truncate">{s.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
