"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useShell } from "./shell-context";
import { cx, Kbd } from "@/components/ui";

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface SearchResult {
  companies: { slug: string; name: string; oneLiner: string | null; status: string | null }[];
  evidence: { title: string; href: string | null; snippet: string }[];
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, ask } = useShell();
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<SearchResult>({ companies: [], evidence: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const slug = /^\/deals\/([^/?#]+)/.exec(path)?.[1] ?? null;

  useEffect(() => {
    if (paletteOpen) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { companies: [], evidence: [] }))
        .then(setResults)
        .catch(() => {});
    }, 90);
    return () => clearTimeout(t);
  }, [q, paletteOpen]);

  const go = (href: string) => () => {
    setPaletteOpen(false);
    router.push(href);
  };

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: "a-analyze", label: "Analyze company", hint: "Upload a deck", group: "Actions", run: go("/analyze") },
      { id: "a-compare", label: "Compare deals", group: "Actions", run: go("/compare") },
      { id: "a-recalc", label: "Recalculate benchmarks", group: "Actions", run: go("/benchmarks") },
      ...(slug
        ? [
            { id: "a-qm", label: "Open Quick Memo", group: "This deal", run: go(`/deals/${slug}/quick`) },
            { id: "a-memo", label: "Open Investment Memo", group: "This deal", run: go(`/deals/${slug}/memo`) },
            { id: "a-call", label: "Add founder call", group: "This deal", run: go(`/deals/${slug}/questions#call`) },
            { id: "a-returns", label: "Open return model", group: "This deal", run: go(`/deals/${slug}/returns`) },
            { id: "a-evidence", label: "Search evidence", group: "This deal", run: go(`/deals/${slug}/evidence`) },
          ]
        : []),
      { id: "a-fund", label: "Fund profile & IC memory", group: "Actions", run: go("/fund") },
    ];
    const ql = q.toLowerCase();
    const filteredActions = ql ? actions.filter((a) => a.label.toLowerCase().includes(ql)) : actions;
    const companies = results.companies.map((c) => ({ id: `c-${c.slug}`, label: c.name, hint: c.oneLiner ?? undefined, group: "Companies", run: go(`/deals/${c.slug}`) }));
    const evidence = results.evidence.map((e, i) => ({ id: `e-${i}`, label: e.title, hint: e.snippet, group: "Evidence", run: e.href ? (e.href.startsWith("/") ? go(e.href) : () => window.open(e.href!, "_blank")) : () => {} }));
    const askItem: Item[] = q.trim().length > 3 ? [{ id: "ask", label: `Ask the Fund Brain: “${q.trim()}”`, group: "Fund Brain", run: () => (setPaletteOpen(false), ask(q.trim())) }] : [];
    return [...companies, ...askItem, ...filteredActions, ...evidence];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, results, slug]);

  useEffect(() => setSel(0), [q]);

  if (!paletteOpen) return null;
  let lastGroup = "";
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[14vh]" onMouseDown={() => setPaletteOpen(false)}>
      <div className="anim-in w-[600px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPaletteOpen(false);
            else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            else if (e.key === "Enter") items[sel]?.run();
          }}
          placeholder="Search companies, evidence, or type a question…"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-ink-3"
        />
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 && <div className="px-4 py-6 text-ink-3">No results.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="t-eyebrow px-4 pb-1 pt-2.5">{header}</div>}
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={it.run}
                  className={cx("flex w-full items-baseline gap-3 px-4 py-1.5 text-left", i === sel ? "bg-surface-2" : "")}
                >
                  <span className="shrink-0 text-ink">{it.label}</span>
                  {it.hint && <span className="truncate text-[12px] text-ink-3">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
