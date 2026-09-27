import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import { canWrite } from "@/server/session";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { metricDef } from "@/engine/metrics/dictionary";
import { Badge } from "@/components/ui";
import { evidenceTone, titleCase } from "@/lib/format";
import { EvidenceExplorer } from "@/components/deal/evidence/evidence-explorer";
import type { DocLite, EvidenceClaim, MetricDefLite, Selection } from "@/components/deal/evidence/labels";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function EvidencePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { session, company, version } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version!.canonical;
  const d = version!.derived;

  const claims: EvidenceClaim[] = c.claims.map((cl) => ({ ...cl, label: evidenceLabel(cl) }));

  const defs: Record<string, MetricDefLite> = {};
  for (const key of new Set(c.metrics.map((m) => m.metricKey))) {
    const def = metricDef(key);
    if (!def) continue;
    defs[key] = {
      key,
      name: def.name,
      shortName: def.shortName,
      definition: def.definition,
      formula: def.formula,
      unit: def.unit,
      period: def.period,
      direction: def.direction,
      disambiguation: def.disambiguation,
      requiredFields: def.requiredFields,
      exclusions: def.exclusions,
      maxAgeMonths: def.quality.maxAgeMonths,
      minSampleSize: def.quality.minSampleSize ?? null,
      minMeasurementMonths: def.quality.minMeasurementMonths ?? null,
    };
  }

  // Documents are looked up by company (itself workspace-scoped), never by a client-supplied id alone.
  const documents: DocLite[] = repo.listDocuments(company.id).map((doc) => ({
    id: doc.id,
    filename: doc.filename,
    kind: doc.kind,
    pages: repo.getDocumentPages(doc.id).map((p) => ({ pageNo: p.pageNo, text: p.text })),
  }));

  let initial: Selection | null = null;
  const claim = one(sp.claim);
  const source = one(sp.source);
  const metric = one(sp.metric);
  const doc = one(sp.doc);
  if (claim && c.claims.some((x) => x.id === claim)) initial = { kind: "claim", id: claim };
  else if (source && c.sources.some((x) => x.id === source)) initial = { kind: "source", id: source };
  else if (metric && c.metrics.some((x) => x.id === metric)) initial = { kind: "metric", id: metric };
  else if (doc) {
    const found = documents.find((x) => x.id === doc);
    if (found) {
      const n = Number(one(sp.page) ?? "1");
      initial = { kind: "doc", id: found.id, page: Number.isInteger(n) && n > 0 ? n : (found.pages[0]?.pageNo ?? 1) };
    }
  }

  const ev = d.evidence;
  const flags = c.analysis.securityFlags;
  const unverifiedCitations = c.sources.filter((s) => !s.citationVerified).length;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      {/* Summary: evidence quality in one line, then the ledger. */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-line pb-6">
        <div>
          <div className="t-eyebrow mb-1.5">Evidence quality</div>
          <div className="flex items-center gap-3">
            <Badge tone={evidenceTone(ev.category)} dot>
              {titleCase(ev.category)}
            </Badge>
            <span className="num text-[20px] font-semibold tracking-tight text-ink">{ev.index.toFixed(0)}</span>
            <span className="text-[12px] text-ink-3">Evidence index (0–100) — a conventional index, not a probability</span>
          </div>
        </div>
        <dl className="num grid grid-cols-2 gap-x-8 gap-y-1 text-[12.5px] sm:grid-cols-5">
          {[
            ["Claims", c.claims.length],
            ["Material", ev.materialClaims],
            ["Verified material", ev.verifiedMaterial],
            ["Company-only material", ev.companyOnlyMaterial],
            ["Contradicted material", ev.contradictedMaterial],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-3">{k}</dt>
              <dd className={`text-[15px] font-medium ${k === "Contradicted material" && Number(v) > 0 ? "text-risk" : "text-ink"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <nav aria-label="Evidence sections" className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink-3">
        <a href="#claims" className="hover:text-ink">
          Claim ledger <span className="num">{c.claims.length}</span>
        </a>
        <a href="#metrics" className="hover:text-ink">
          Metrics <span className="num">{c.metrics.length}</span>
        </a>
        <a href="#sources" className="hover:text-ink">
          Sources <span className="num">{c.sources.length}</span>
        </a>
        <a href="#documents" className="hover:text-ink">
          Raw pages <span className="num">{documents.reduce((a, x) => a + x.pages.length, 0)}</span>
        </a>
        <span className="ml-auto flex flex-wrap items-center gap-x-4">
          {unverifiedCitations > 0 && (
            <span title="Cited URLs that were not among retrieved search results never count as independent confirmation">
              {unverifiedCitations} unverified citation{unverifiedCitations === 1 ? "" : "s"}
            </span>
          )}
          {flags.length > 0 && (
            <a href="#security" className="hover:text-ink">
              {flags.length} instruction-like passage{flags.length === 1 ? "" : "s"} ignored
            </a>
          )}
        </span>
      </nav>

      <EvidenceExplorer
        companyId={company.id}
        versionId={version!.row.id}
        canWrite={canWrite(session)}
        claims={claims}
        sources={c.sources}
        metrics={c.metrics}
        defs={defs}
        documents={documents}
        securityFlags={flags}
        initial={initial}
      />

      {flags.length > 0 && (
        <section id="security" className="scroll-mt-32 border-t border-line pt-6">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-baseline gap-3 text-[13px]">
              <span className="t-eyebrow">Security flags</span>
              <span className="text-ink-2">
                {flags.length} passage{flags.length === 1 ? "" : "s"} in the materials read like instructions to an AI. They were treated as data and ignored.
              </span>
              <span className="text-[12px] text-ink-3 group-open:hidden">Show</span>
              <span className="hidden text-[12px] text-ink-3 group-open:inline">Hide</span>
            </summary>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {flags.map((f, i) => (
                <li key={i} className="grid grid-cols-[200px_1fr] gap-4 px-3 py-2 text-[12.5px]">
                  <span className="truncate text-ink-3" title={f.location}>
                    {f.location}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-2">“{f.excerpt}”</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </main>
  );
}
