import type { ReactNode } from "react";
import Link from "next/link";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { PostMeetingBrief } from "@/domain/meetings";
import { applyOverrides } from "@/engine/overrides";
import { buildDeepDdReport, deepDdMarkdown, type DeepDdMeeting } from "@/reports/deep-dd";
import { EvidenceDrawerProvider } from "@/components/deal/reports/evidence-drawer";
import { MemoNav } from "@/components/deal/reports/memo-nav";
import { DdSectionView } from "@/components/deal/reports/deep-dd-view";
import { PrintButton } from "@/components/deal/reports/print-button";
import { DownloadMarkdownButton } from "@/components/deal/reports/download-markdown";
import { Badge } from "@/components/ui";
import { date, titleCase } from "@/lib/format";

export const metadata = { title: "Deep DD report" };

/** Print tuning scoped to the Deep DD document (globals stay untouched). */
const PRINT_CSS = `
@media print {
  .dd-doc.prose-memo { font-size: 8.8pt; line-height: 1.38; }
  .dd-doc .dd-kv > div { grid-template-columns: 130px 1fr; }
  .dd-doc .dd-section > h2 { break-after: avoid; margin-top: 1.3em; }
  .dd-doc .dd-kv > div, .dd-doc .dd-table td { padding-top: 2px; padding-bottom: 2px; }
  .dd-doc h3 { break-after: avoid; }
  .dd-doc .dd-table { min-width: 0 !important; }
  .dd-doc .dd-item, .dd-doc .dd-status { break-inside: avoid; }
  .dd-doc #workplan { break-before: page; }
  .dd-doc a { color: inherit; text-decoration: none; }
  @page { margin: 12mm 13mm; }
}
`;

export default async function DeepDdPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> }) {
  const { slug } = await params;
  const { v } = await searchParams;
  const { company, version: current } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!current) return null;
  const picked = v && v !== current.row.id ? repo.getVersion(company.id, v) : null;
  // The effective canonical (raw extraction + analyst overrides) is what derive() scored; the same rule for any version.
  const version = picked ? { ...picked, canonical: applyOverrides(picked.canonical) } : current;
  const historical = version.row.id !== company.currentVersionId;
  const c = version.canonical;
  const d = version.derived;
  const s = company.slug;

  const stages = meetings.versionStages(company.id);
  const stage = stages.get(version.row.id) ?? null;
  const versionNo = new Map(repo.listVersions(company.id).map((x) => [x.id, x.versionNo]));
  // Meetings held up to this version (a historical report does not show later meetings).
  const meetingRows = meetings.listMeetings(company.id).filter((m) => (versionNo.get(m.preAnalysisVersionId) ?? 0) <= version.row.versionNo);
  const meetingData: DeepDdMeeting[] = meetingRows.map((m) => {
    const brief = m.postBriefId ? meetings.getBrief(company.id, m.postBriefId) : null;
    const parsed = brief ? PostMeetingBrief.safeParse(brief.content) : null;
    const pb = parsed?.success ? parsed.data : null;
    return {
      id: m.id,
      seq: m.seq,
      title: m.title,
      heldAt: m.heldAt,
      status: m.status,
      pre: { versionNo: versionNo.get(m.preAnalysisVersionId) ?? null, stageCode: stages.get(m.preAnalysisVersionId)?.code ?? null },
      preBriefId: m.preBriefId,
      post: m.postAnalysisVersionId ? { versionNo: versionNo.get(m.postAnalysisVersionId) ?? null, stageCode: stages.get(m.postAnalysisVersionId)?.code ?? null } : null,
      postBriefId: m.postBriefId,
      summary: pb?.summary ?? null,
      recommendation: pb ? pb.recommendation : null,
      changes: (pb?.whatChanged ?? []).filter((x) => x.material).slice(0, 8).map((x) => ({ area: x.area, dimension: x.dimension, before: x.before, after: x.after, key: x.key })),
      unanswered: pb ? pb.unanswered.length : null,
    };
  });

  const report = buildDeepDdReport(c, d, {
    versionId: version.row.id,
    versionNo: version.row.versionNo,
    createdAt: version.row.createdAt,
    registryId: version.row.registryId,
    stageCode: stage?.code ?? null,
    stageLabel: stage?.label ?? null,
    historical,
    meetings: meetingData,
  });
  const markdown = deepDdMarkdown(report, { base: `/deals/${s}` });
  const flag = report.depth;

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
          <span className="t-eyebrow">Deep DD report</span>
          <span>Rendered deterministically from version {version.row.versionNo}; every number carries its refs.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/deals/${s}/memo`} className="text-[12.5px] text-ink-3 hover:text-ink">
            Investment memo
          </Link>
          <span className="text-line-strong">·</span>
          <Link href={`/deals/${s}/quick`} className="text-[12.5px] text-ink-3 hover:text-ink">
            Quick memo
          </Link>
          <span className="text-line-strong">·</span>
          <Link href={`/deals/${s}/brief`} className="mr-2 text-[12.5px] text-ink-3 hover:text-ink">
            Founder call brief
          </Link>
          <DownloadMarkdownButton filename={`${s}-deep-dd-v${version.row.versionNo}.md`} content={markdown} />
          <PrintButton />
        </div>
      </div>

      <EvidenceDrawerProvider claims={c.claims} sources={c.sources} slug={s}>
        <div className="grid gap-10 lg:grid-cols-[196px_minmax(0,1fr)] print:block">
          <MemoNav sections={report.sections.map((x) => ({ id: x.id, title: x.title, missing: x.missing }))} />

          <article className="dd-doc prose-memo print-page min-w-0 max-w-[820px]">
            <header className="border-b border-line-strong pb-5">
              <div className="t-eyebrow">Deep DD report{historical && " · historical version"}</div>
              <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">{report.company}</h1>
              <p className="!my-1 text-[14px] text-ink-2">{report.subtitle}</p>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                <Meta k="Version" v={`v${version.row.versionNo}`} />
                <Meta k="Stage" v={<span className="font-mono text-[11px]">{stage?.code ?? "—"}</span>} />
                <Meta k="Analysis date" v={date(version.row.createdAt)} />
                <Meta k="Mode" v={titleCase(c.analysis.mode)} />
                <Meta k="Depth" v={c.analysis.depth === "FULL" ? "Full" : "Partial"} />
                <Meta k="Registry" v={<span className="font-mono text-[11px]">{version.row.registryId}</span>} />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {historical && (
                  <Badge tone="warn" title="This is not the current analysis version">
                    Historical — superseded
                  </Badge>
                )}
                {flag.level !== "OK" && <Badge tone={flag.level === "INSUFFICIENT" ? "risk" : "warn"}>{flag.level === "INSUFFICIENT" ? "Analysis depth insufficient" : "Not a Deep DD-mode analysis"}</Badge>}
                <Badge tone="neutral">
                  {report.plan.items.length} requests · {report.plan.killCriteria.length} kill criteria
                </Badge>
              </div>
              {flag.level !== "OK" && <p className={`!mb-0 !mt-2 text-[12.5px] ${flag.level === "INSUFFICIENT" ? "text-risk" : "text-warn"}`}>{flag.text}</p>}
              {historical && (
                <p className="no-print !mb-0 !mt-2 text-[12.5px] text-ink-3">
                  <Link href={`/deals/${s}/deep-dd`} className="text-accent-text hover:underline">
                    Open the current version →
                  </Link>
                </p>
              )}
            </header>

            {report.sections.map((sec, i) => (
              <DdSectionView key={sec.id} section={sec} index={i} slug={s} />
            ))}

            <footer className="mt-12 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-3">
              {report.company} · Deep DD report · v{version.row.versionNo} · {stage?.code ?? "stage not recorded"} · {date(version.row.createdAt)} · registry {version.row.registryId} · fund profile {d.fundProfileId}. Generated
              deterministically from the stored canonical object and derived analysis of this version; no text was generated for this document. Indices are conventional scales, not probabilities. Analytical recommendation only; the IC
              decision is recorded separately.
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
