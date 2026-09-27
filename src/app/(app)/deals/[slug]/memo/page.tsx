import type { ReactNode } from "react";
import Link from "next/link";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import { buildInvestmentMemo } from "@/reports/investment-memo";
import { EvidenceDrawerProvider } from "@/components/deal/reports/evidence-drawer";
import { MemoNav } from "@/components/deal/reports/memo-nav";
import { MemoSectionView } from "@/components/deal/reports/memo-blocks";
import { PrintButton } from "@/components/deal/reports/print-button";
import { Badge } from "@/components/ui";
import { date, titleCase } from "@/lib/format";

/** Print tuning scoped to the memo document (globals stay untouched). */
const PRINT_CSS = `
@media print {
  .memo-doc.prose-memo { font-size: 9pt; line-height: 1.4; }
  .memo-doc .memo-kv > div { grid-template-columns: 130px 1fr; }
  .memo-doc .memo-section > h2 { break-after: avoid; margin-top: 1.3em; }
  .memo-doc .memo-kv > div, .memo-doc .memo-table td { padding-top: 3px; padding-bottom: 3px; }
  .memo-doc h3 { break-after: avoid; }
  .memo-doc .memo-table { min-width: 0 !important; }
  .memo-doc a { color: inherit; text-decoration: none; }
  @page { margin: 12mm 13mm; }
}
`;

export default async function MemoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> }) {
  const { slug } = await params;
  const { v } = await searchParams;
  const { company, version: current } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!current) return null;
  const version = (v && repo.getVersion(company.id, v)) || current!;
  const historical = version.row.id !== company.currentVersionId;
  const c = version.canonical;
  const d = version.derived;
  const memo = buildInvestmentMemo(c, d);
  const s = company.slug;

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
          <span className="t-eyebrow">Investment memo</span>
          <span>Rendered deterministically from version {version.row.versionNo}; evidence chips open the source.</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${s}/quick`} className="text-[12.5px] text-ink-3 hover:text-ink">
            Quick memo
          </Link>
          <span className="text-line-strong">·</span>
          <Link href={`/deals/${s}/brief`} className="mr-2 text-[12.5px] text-ink-3 hover:text-ink">
            Founder call brief
          </Link>
          <PrintButton />
        </div>
      </div>

      <EvidenceDrawerProvider claims={c.claims} sources={c.sources} slug={s}>
        <div className="grid gap-10 lg:grid-cols-[196px_minmax(0,1fr)] print:block">
          <MemoNav sections={memo.sections.map((x) => ({ id: x.id, title: x.title, missing: x.missing }))} />

          <article className="memo-doc prose-memo print-page min-w-0 max-w-[760px]">
            <header className="border-b border-line-strong pb-5">
              <div className="t-eyebrow">Investment memo{historical && " · historical version"}</div>
              <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">{memo.company}</h1>
              <p className="!my-1 text-[14px] text-ink-2">{memo.subtitle}</p>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                <Meta k="Version" v={`v${version.row.versionNo}`} />
                <Meta k="Analysis date" v={date(version.row.createdAt)} />
                <Meta k="Registry" v={<span className="font-mono text-[11px]">{version.row.registryId}</span>} />
                <Meta k="Mode" v={titleCase(c.analysis.mode)} />
                <Meta k="Depth" v={c.analysis.depth === "FULL" ? "Full" : "Partial"} />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {historical && (
                  <Badge tone="warn" title="This is not the current analysis version">
                    Historical — superseded by a later version
                  </Badge>
                )}
                {c.analysis.depth === "PARTIAL" && <Badge tone="warn">Partial analysis — not full institutional diligence</Badge>}
              </div>
              {c.analysis.depth === "PARTIAL" && c.analysis.partialReasons.length > 0 && (
                <p className="!mb-0 !mt-2 text-[12.5px] text-warn">Limitations: {c.analysis.partialReasons.join("; ")}.</p>
              )}
              {historical && (
                <p className="no-print !mb-0 !mt-2 text-[12.5px] text-ink-3">
                  <Link href={`/deals/${s}/memo`} className="text-accent-text hover:underline">
                    Open the current version →
                  </Link>
                </p>
              )}
            </header>

            {memo.sections.map((sec, i) => (
              <MemoSectionView key={sec.id} section={sec} index={i} slug={s} />
            ))}

            <footer className="mt-12 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-3">
              {memo.company} · Investment memo · v{version.row.versionNo} · {date(version.row.createdAt)} · registry {version.row.registryId} · fund profile {d.fundProfileId}.
              Generated deterministically from the canonical investment object and its derived analysis; no text was generated for this document. Indices are conventional
              scales, not probabilities. Analytical recommendation only.
            </footer>
          </article>
        </div>
      </EvidenceDrawerProvider>
    </main>
  );
}

function Meta({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-ink-2">{v}</dd>
    </div>
  );
}
