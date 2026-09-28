"use client";

/**
 * Deal-wide METRIC LINEAGE DRAWER. Every metric number on the deal pages links
 * to `/deals/:slug/evidence?metric=MET-…`; this provider intercepts those
 * clicks (plain left-clicks only — modified clicks and the evidence tab keep
 * normal navigation) and opens the lineage in a drawer instead, so the number
 * explains itself in place.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "@/components/deal/evidence/drawer";
import { LineageHeadline, LineageSections, type LineageContextData } from "./lineage-view";

export function LineageProvider({ data, children }: { data: LineageContextData; children: ReactNode }) {
  const [stack, setStack] = useState<string[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const path = usePathname();
  const onEvidence = path.startsWith(`/deals/${data.slug}/evidence`);
  const byId = useMemo(() => new Map(data.metrics.map((m) => [m.id, m])), [data.metrics]);

  const open = useCallback((id: string) => {
    setStack((s) => (s[s.length - 1] === id ? s : [...s, id]));
    setShown(id);
  }, []);
  const close = useCallback(() => setStack([]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  useEffect(() => {
    if (onEvidence) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname !== `/deals/${data.slug}/evidence`) return;
      const id = url.searchParams.get("metric");
      if (!id || !byId.has(id)) return;
      e.preventDefault();
      open(id);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [onEvidence, data.slug, byId, open]);

  // Close when navigating to another tab (state adjusted during render, not in an effect).
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setStack([]);
  }

  const current = stack[stack.length - 1] ?? null;
  const m = shown ? byId.get(shown) : undefined;
  const prev = stack.length > 1 ? stack[stack.length - 2]! : null;
  const def = m ? data.defs[m.metricKey] : undefined;

  return (
    <>
      {children}
      <Drawer
        open={!!current}
        onClose={close}
        label={m ? `Metric ${m.id} lineage` : "Metric lineage"}
        onBack={prev ? back : undefined}
        backLabel={prev ? `Back to ${prev}` : undefined}
        eyebrow={
          m ? (
            <>
              <span className="font-mono">{m.id}</span>
              <span className="font-mono">· {m.metricKey}</span>
              {m.periodEnd && <span>· {m.periodEnd}</span>}
            </>
          ) : undefined
        }
        title={def?.name ?? m?.label ?? "Metric"}
        footer={
          m ? (
            <Link href={`/deals/${data.slug}/evidence?metric=${m.id}`} className="text-[12.5px] text-ink-3 hover:text-ink">
              Open in the evidence explorer (claims, sources, raw pages) →
            </Link>
          ) : undefined
        }
      >
        {m && (
          <div>
            <LineageHeadline m={m} overrides={data.overrides} />
            {def && (
              <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
                {def.definition}
                {def.formula && <span className="mt-1 block rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-2">{def.formula}</span>}
              </p>
            )}
            <LineageSections m={m} data={data} onOpenMetric={open} />
          </div>
        )}
      </Drawer>
    </>
  );
}
