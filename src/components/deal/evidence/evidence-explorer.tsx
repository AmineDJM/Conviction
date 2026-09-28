"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricInstance, Source } from "@/domain/canonical";
import { Section } from "@/components/ui";
import { Drawer } from "./drawer";
import { ClaimLedger } from "./claim-ledger";
import { MetricsTable } from "./metrics-table";
import { DocumentPages, SourcesTable } from "./sources-table";
import { ClaimDetail, DocDetail, MetricDetail, SourceDetail, type EvidenceIndex } from "./details";
import { titleCase } from "@/lib/format";
import type { LineageContextData } from "@/components/deal/lineage/lineage-view";
import { SOURCE_KIND_TEXT, type DocLite, type EvidenceClaim, type MetricDefLite, type Selection } from "./labels";

export interface EvidenceExplorerProps {
  companyId: string;
  versionId: string;
  canWrite: boolean;
  claims: EvidenceClaim[];
  sources: Source[];
  metrics: MetricInstance[];
  defs: Record<string, MetricDefLite>;
  documents: DocLite[];
  securityFlags: { location: string; excerpt: string }[];
  initial: Selection | null;
  /** Lineage + override data for the metric drawer. */
  lineage?: LineageContextData;
  /** Source age and flags from the integrity engine (freshness column). */
  reliability?: Record<string, { ageMonths: number | null; flags: string[] }>;
}

const PARAMS = ["claim", "source", "metric", "doc", "page"];

function selKey(s: Selection | null) {
  return s ? `${s.kind}:${s.id}${s.kind === "doc" ? `:${s.page}` : ""}` : "";
}

function selLabel(s: Selection) {
  return s.kind === "doc" ? `page ${s.page}` : s.id;
}

export function EvidenceExplorer(p: EvidenceExplorerProps) {
  const [stack, setStack] = useState<Selection[]>(p.initial ? [p.initial] : []);
  const [lastShown, setLastShown] = useState<Selection | null>(p.initial);
  const sel = stack[stack.length - 1] ?? null;
  const shown = sel ?? lastShown; // keep content while the drawer slides out

  const idx: EvidenceIndex = { claims: p.claims, sources: p.sources, metrics: p.metrics, defs: p.defs, documents: p.documents, securityFlags: p.securityFlags, lineage: p.lineage };

  const openFromTable = useCallback((s: Selection) => {
    setStack([s]);
    setLastShown(s);
  }, []);
  const openFromDrawer = useCallback((s: Selection) => {
    setStack((st) => {
      const top = st[st.length - 1];
      // Paging within one document replaces the top entry instead of growing the stack.
      if (top && top.kind === "doc" && s.kind === "doc" && top.id === s.id) return [...st.slice(0, -1), s];
      if (top && selKey(top) === selKey(s)) return st;
      return [...st, s];
    });
    setLastShown(s);
  }, []);
  const back = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  const close = useCallback(() => setStack([]), []);

  // Keep the URL shareable: ?claim=CLM-004, ?source=SRC-007, ?metric=MET-003, ?doc=<id>&page=<n>.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of PARAMS) url.searchParams.delete(k);
    if (sel) {
      if (sel.kind === "doc") {
        url.searchParams.set("doc", sel.id);
        url.searchParams.set("page", String(sel.page));
      } else url.searchParams.set(sel.kind, sel.id);
    }
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, [sel]);

  // Deep link: bring the selected row into view once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !p.initial) return;
    scrolled.current = true;
    const i = p.initial;
    const el = document.getElementById(i.kind === "doc" ? `row-${i.id}-${i.page}` : `row-${i.id}`);
    el?.scrollIntoView({ block: "center" });
  }, [p.initial]);

  const selectedClaim = sel?.kind === "claim" ? sel.id : null;
  const selectedMetric = sel?.kind === "metric" ? sel.id : null;
  const selectedSource = sel?.kind === "source" ? sel.id : null;
  const selectedDoc = sel?.kind === "doc" ? { id: sel.id, page: sel.page } : null;

  const prev = stack.length > 1 ? stack[stack.length - 2]! : null;
  const header = drawerHeader(shown, idx);

  return (
    <>
      <Section id="claims" eyebrow="Claim ledger" title="Every claim, its source and how far it has been verified" className="mb-12">
        <ClaimLedger claims={p.claims} sources={p.sources} selectedId={selectedClaim} onOpen={openFromTable} />
      </Section>

      <Section id="metrics" eyebrow="Metrics" title="All metric instances, including non-primary and derived" className="mb-12">
        <MetricsTable metrics={p.metrics} defs={p.defs} selectedId={selectedMetric} onOpen={openFromTable} />
      </Section>

      <Section id="sources" eyebrow="Sources" title="Documents, transcripts and web pages behind the ledger" className="mb-12">
        <SourcesTable sources={p.sources} claims={p.claims} selectedId={selectedSource} onOpen={openFromTable} reliability={p.reliability} />
      </Section>

      <Section id="documents" eyebrow="Raw sources" title="Extracted document pages" className="mb-12">
        <DocumentPages documents={p.documents} selected={selectedDoc} onOpen={openFromTable} />
      </Section>

      <Drawer open={!!sel} onClose={close} label={header.label} eyebrow={header.eyebrow} title={header.title} onBack={prev ? back : undefined} backLabel={prev ? `Back to ${selLabel(prev)}` : undefined}>
        {shown?.kind === "claim" && <ClaimDetail id={shown.id} idx={idx} open={openFromDrawer} />}
        {shown?.kind === "source" && <SourceDetail id={shown.id} idx={idx} open={openFromDrawer} />}
        {shown?.kind === "metric" && <MetricDetail id={shown.id} idx={idx} open={openFromDrawer} canWrite={p.canWrite} />}
        {shown?.kind === "doc" && <DocDetail id={shown.id} page={shown.page} idx={idx} open={openFromDrawer} />}
      </Drawer>
    </>
  );
}

function drawerHeader(s: Selection | null, idx: EvidenceIndex): { label: string; eyebrow?: React.ReactNode; title?: React.ReactNode } {
  if (!s) return { label: "Detail" };
  if (s.kind === "claim") {
    const c = idx.claims.find((x) => x.id === s.id);
    return {
      label: `Claim ${s.id}`,
      eyebrow: (
        <>
          <span className="font-mono">{s.id}</span>
          {c && <span>· {titleCase(c.category)} claim</span>}
          {c?.material && <span>· Material</span>}
        </>
      ),
      title: c?.statement ?? s.id,
    };
  }
  if (s.kind === "source") {
    const src = idx.sources.find((x) => x.id === s.id);
    return {
      label: `Source ${s.id}`,
      eyebrow: (
        <>
          <span className="font-mono">{s.id}</span>
          {src && <span>· {SOURCE_KIND_TEXT[src.kind]} source</span>}
        </>
      ),
      title: src?.title ?? s.id,
    };
  }
  if (s.kind === "metric") {
    const m = idx.metrics.find((x) => x.id === s.id);
    const def = m ? idx.defs[m.metricKey] : undefined;
    return {
      label: `Metric ${s.id}`,
      eyebrow: (
        <>
          <span className="font-mono">{s.id}</span>
          {m && <span className="font-mono">· {m.metricKey}</span>}
          {m?.periodEnd && <span>· {m.periodEnd}</span>}
        </>
      ),
      title: def?.name ?? m?.label ?? s.id,
    };
  }
  const d = idx.documents.find((x) => x.id === s.id);
  return {
    label: `Document page ${s.page}`,
    eyebrow: (
      <>
        <span>{d?.filename ?? "Document"}</span>
        {d && <span>· {d.kind.toLowerCase()}</span>}
      </>
    ),
    title: `Page ${s.page}`,
  };
}
