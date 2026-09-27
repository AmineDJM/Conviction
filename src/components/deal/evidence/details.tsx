"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MetricInstance, Source } from "@/domain/canonical";
import { Badge, Button, cx } from "@/components/ui";
import { EVIDENCE_LABEL_TEXT, date, evidenceLabelTone, metricValue, titleCase } from "@/lib/format";
import { DrawerSection } from "./drawer";
import {
  EFFECT_TEXT,
  FRESHNESS_TEXT,
  HISTORY_TEXT,
  INDEPENDENCE_TEXT,
  METHOD_TEXT,
  ORIGIN_TEXT,
  SOURCE_KIND_TEXT,
  STATE_TEXT,
  VERIFICATION_TEXT,
  effectTone,
  freshnessTone,
  hostOf,
  independenceTone,
  isUrl,
  pageFromLocation,
  parseAmount,
  stateTone,
  unitHint,
  verificationTone,
  type DocLite,
  type EvidenceClaim,
  type MetricDefLite,
  type Selection,
} from "./labels";

export interface EvidenceIndex {
  claims: EvidenceClaim[];
  sources: Source[];
  metrics: MetricInstance[];
  defs: Record<string, MetricDefLite>;
  documents: DocLite[];
  securityFlags: { location: string; excerpt: string }[];
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-3 py-1 text-[13px]">
      <div className="text-ink-3">{k}</div>
      <div className="min-w-0 break-words text-ink">{children}</div>
    </div>
  );
}

function RefButton({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="rounded bg-surface-3 px-1 font-mono text-[11px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
      {children}
    </button>
  );
}

function Excerpt({ children }: { children: ReactNode }) {
  return <blockquote className="my-1.5 border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink">“{children}”</blockquote>;
}

/** Locate a verbatim excerpt (e.g. from a call transcript) in a stored document's pages. */
function findExcerptPage(doc: DocLite | undefined, excerpt: string): number | null {
  if (!doc) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ");
  const probes = excerpt.split(/\.\.\.|…/).map((x) => norm(x).trim()).filter((x) => x.length >= 12);
  for (const probe of probes) {
    const hit = doc.pages.find((p) => norm(p.text).includes(probe.slice(0, 60)));
    if (hit) return hit.pageNo;
  }
  return null;
}

function CitationBadge({ s }: { s: Source }) {
  return s.citationVerified ? (
    <Badge tone="neutral" title={s.kind === "WEB" ? "URL was returned by the search tool" : "Material uploaded to the platform"}>
      Retrieved
    </Badge>
  ) : (
    <Badge tone="warn" title="The cited URL was not among retrieved search results">
      Unverified citation
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Claim                                                               */
/* ------------------------------------------------------------------ */

export function ClaimDetail({ id, idx, open }: { id: string; idx: EvidenceIndex; open: (s: Selection) => void }) {
  const c = idx.claims.find((x) => x.id === id);
  if (!c) return <p className="text-ink-3">Claim {id} is not in the current version.</p>;
  const linked = idx.metrics.filter((m) => m.claimId === c.id);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge tone={evidenceLabelTone(c.label)} dot>
          {EVIDENCE_LABEL_TEXT[c.label]}
        </Badge>
        <Badge tone={verificationTone(c.verification)}>{VERIFICATION_TEXT[c.verification]}</Badge>
        <Badge tone={independenceTone(c.independence)}>{INDEPENDENCE_TEXT[c.independence]}</Badge>
        <Badge tone={freshnessTone(c.freshness)}>{FRESHNESS_TEXT[c.freshness]}</Badge>
        <Badge tone="neutral">Origin: {ORIGIN_TEXT[c.origin]}</Badge>
      </div>
      <DrawerSection title="Claim">
        <Row k="Value">{c.valueText ?? <span className="text-ink-3">—</span>}</Row>
        <Row k="Entity">{c.entity}</Row>
        <Row k="Period">{c.period ?? <span className="text-ink-3">Not stated</span>}</Row>
        <Row k="Category">{titleCase(c.category)}{c.material ? " · material" : ""}</Row>
        <Row k="How verified">{c.verificationMethod}</Row>
      </DrawerSection>

      <DrawerSection title={`Evidence (${c.evidence.length})`}>
        {c.evidence.length === 0 && <p className="text-ink-3">No evidence links recorded.</p>}
        <ol className="space-y-3">
          {c.evidence.map((e, i) => {
            const s = idx.sources.find((x) => x.id === e.sourceId);
            const docId = s?.documentId ?? null;
            const page = pageFromLocation(e.location) ?? (docId ? findExcerptPage(idx.documents.find((d) => d.id === docId), e.excerpt) : null);
            const hasDoc = docId && idx.documents.some((d) => d.id === docId && d.pages.some((p) => p.pageNo === page));
            return (
              <li key={i} className="rounded-md border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={effectTone(e.effect)}>{EFFECT_TEXT[e.effect]}</Badge>
                  <RefButton onClick={() => open({ kind: "source", id: e.sourceId })} title="Open source">
                    {e.sourceId}
                  </RefButton>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink" title={s?.title}>
                    {s?.title ?? "Unknown source"}
                  </span>
                </div>
                {s && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                    {s.publisher && <span>{s.publisher}</span>}
                    <span>{ORIGIN_TEXT[s.origin]}</span>
                    <span>
                      group <span className="font-mono">{s.independenceGroup}</span>
                    </span>
                    <CitationBadge s={s} />
                  </div>
                )}
                <Excerpt>{e.excerpt}</Excerpt>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                  <span>Location:</span>
                  {hasDoc && page ? (
                    <button type="button" className="text-accent-text hover:underline" onClick={() => open({ kind: "doc", id: docId!, page })}>
                      {e.location && pageFromLocation(e.location) ? e.location : `${e.location ?? "Transcript"}, p. ${page}`} — open page
                    </button>
                  ) : isUrl(e.location) ? (
                    <a href={e.location} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-accent-text hover:underline">
                      {hostOf(e.location)} ↗
                    </a>
                  ) : (
                    <span className="text-ink-2">{e.location ?? "not recorded"}</span>
                  )}
                </div>
                {e.note && <p className={cx("mt-1 text-[12px]", /unverified/i.test(e.note) ? "text-warn" : "text-ink-2")}>{e.note}</p>}
              </li>
            );
          })}
        </ol>
      </DrawerSection>

      {c.limitations && (
        <DrawerSection title="Limitations">
          <p className="text-[13px] text-ink-2">{c.limitations}</p>
        </DrawerSection>
      )}
      <DrawerSection title="Contradictions">
        {c.contradictions.length ? (
          <ul className="space-y-1.5">
            {c.contradictions.map((x, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-risk" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">None recorded.</p>
        )}
      </DrawerSection>
      {linked.length > 0 && (
        <DrawerSection title="Metrics from this claim">
          <div className="flex flex-wrap gap-2">
            {linked.map((m) => (
              <button key={m.id} type="button" onClick={() => open({ kind: "metric", id: m.id })} className="rounded-md border border-line px-2 py-1 text-left text-[12px] hover:border-line-strong hover:bg-surface-2">
                <span className="font-mono text-[10.5px] text-ink-3">{m.id}</span> <span className="text-ink">{idx.defs[m.metricKey]?.shortName ?? m.label}</span> <span className="num text-ink-2">{metricValue(m.unit, m.normalizedValue)}</span>
                {m.isPrimary && <span className="ml-1 text-[10px] uppercase tracking-wide text-accent-text">primary</span>}
              </button>
            ))}
          </div>
        </DrawerSection>
      )}
      <DrawerSection title="History">
        <ol className="relative ml-1 border-l border-line">
          {c.history.map((h, i) => (
            <li key={i} className="relative pb-3 pl-4 last:pb-0">
              <span className={cx("absolute -left-[4px] top-[6px] h-[7px] w-[7px] rounded-full ring-2 ring-surface", h.change === "CONTRADICTED" ? "bg-risk" : h.change === "CONFIRMED" ? "bg-ok" : h.change === "CORRECTED" || h.change === "CHANGED" ? "bg-accent" : "bg-line-strong")} />
              <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                <span className="font-medium text-ink">{HISTORY_TEXT[h.change]}</span>
                <span className="num text-ink-3">{date(h.at)}</span>
              </div>
              <div className="text-[12.5px] text-ink-2">{h.note}</div>
            </li>
          ))}
        </ol>
      </DrawerSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Source                                                              */
/* ------------------------------------------------------------------ */

export function SourceDetail({ id, idx, open }: { id: string; idx: EvidenceIndex; open: (s: Selection) => void }) {
  const s = idx.sources.find((x) => x.id === id);
  if (!s) return <p className="text-ink-3">Source {id} is not in the current version.</p>;
  const citing = idx.claims.flatMap((c) => c.evidence.filter((e) => e.sourceId === s.id).map((e) => ({ c, e })));
  const doc = s.documentId ? idx.documents.find((d) => d.id === s.documentId) : undefined;
  const sameGroup = s.independenceGroup === "COMPANY" ? [] : idx.sources.filter((x) => x.id !== s.id && x.independenceGroup === s.independenceGroup);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge tone="neutral">{SOURCE_KIND_TEXT[s.kind]}</Badge>
        <Badge tone="neutral">Origin: {ORIGIN_TEXT[s.origin]}</Badge>
        <CitationBadge s={s} />
      </div>
      <DrawerSection title="Source">
        <Row k="Title">{s.title}</Row>
        {s.url && (
          <Row k="URL">
            {isUrl(s.url) ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent-text hover:underline">
                {s.url}
              </a>
            ) : (
              <span className="break-all">{s.url}</span>
            )}
          </Row>
        )}
        <Row k="Publisher">{s.publisher ?? <span className="text-ink-3">—</span>}</Row>
        <Row k="Published">{s.publishedDate ?? <span className="text-ink-3">—</span>}</Row>
        <Row k="Retrieved">{date(s.retrievedAt)}</Row>
        <Row k="Independence group">
          <span className="font-mono text-[12px]">{s.independenceGroup}</span>
          <div className="mt-0.5 text-[12px] text-ink-3">Sources in one group share an underlying origin and count once toward verification.{sameGroup.length > 0 && ` ${sameGroup.length} other source(s) in this group.`}</div>
        </Row>
        <Row k="Citation">
          {s.citationVerified ? (s.kind === "WEB" ? "Retrieved — URL returned by the search tool" : "Uploaded material") : "Unverified — the URL was not among retrieved search results and does not count as independent confirmation"}
        </Row>
        {doc && (
          <Row k="Document">
            <button type="button" className="text-accent-text hover:underline" onClick={() => open({ kind: "doc", id: doc.id, page: doc.pages[0]?.pageNo ?? 1 })}>
              {doc.filename} — {doc.pages.length} pages
            </button>
          </Row>
        )}
      </DrawerSection>
      <DrawerSection title={`Cited by ${new Set(citing.map((x) => x.c.id)).size} claim(s)`}>
        {citing.length === 0 && <p className="text-[13px] text-ink-3">No claims cite this source.</p>}
        <ul className="divide-y divide-line">
          {citing.map(({ c, e }, i) => (
            <li key={i}>
              <button type="button" onClick={() => open({ kind: "claim", id: c.id })} className="block w-full py-2 text-left hover:bg-surface-2">
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className="font-mono text-ink-3">{c.id}</span>
                  <Badge tone={effectTone(e.effect)}>{EFFECT_TEXT[e.effect]}</Badge>
                  {e.location && !isUrl(e.location) && <span className="text-ink-3">{e.location}</span>}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[13px] text-ink">{c.statement}</div>
              </button>
            </li>
          ))}
        </ul>
      </DrawerSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metric                                                              */
/* ------------------------------------------------------------------ */

export function MetricDetail({ id, idx, open, companyId, versionId, canWrite, onCorrected }: { id: string; idx: EvidenceIndex; open: (s: Selection) => void; companyId: string; versionId: string; canWrite: boolean; onCorrected: (newId: string) => void }) {
  const m = idx.metrics.find((x) => x.id === id);
  if (!m) return <p className="text-ink-3">Metric {id} is not in the current version. It may have been re-derived after a correction.</p>;
  const def = idx.defs[m.metricKey];
  const siblings = idx.metrics.filter((x) => x.metricKey === m.metricKey && x.id !== m.id);
  const source = m.sourceId ? idx.sources.find((s) => s.id === m.sourceId) : undefined;
  const page = pageFromLocation(m.location);
  const docOk = source?.documentId && page && idx.documents.some((d) => d.id === source.documentId);
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <span className="num text-[26px] font-semibold tracking-tight text-ink">{metricValue(m.unit, m.normalizedValue)}</span>
        <span className="text-[12.5px] text-ink-3">raw “{m.rawValue}”</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {m.isPrimary ? <Badge tone="accent">Primary — used for scoring</Badge> : <Badge tone="unknown">Not primary</Badge>}
        <Badge tone={stateTone(m.state)}>{STATE_TEXT[m.state]}</Badge>
        <Badge tone={verificationTone(m.verification)}>{VERIFICATION_TEXT[m.verification]}</Badge>
        <Badge tone={m.calculationMethod === "USER_CORRECTED" ? "accent" : "neutral"}>{METHOD_TEXT[m.calculationMethod]}</Badge>
      </div>

      <DrawerSection title="Instance">
        <Row k="Normalized">
          <span className="num">{m.normalizedValue ?? "—"}</span> <span className="text-ink-3">{m.unit}{m.currency && m.unit === "USD" ? "" : m.currency ? ` · ${m.currency}` : ""}</span>
        </Row>
        <Row k="Period">
          {m.periodType.toLowerCase().replace(/_/g, " ")}
          {m.periodStart || m.periodEnd ? <span className="num text-ink-2"> · {[m.periodStart, m.periodEnd].filter(Boolean).join(" → ")}</span> : null}
        </Row>
        <Row k="Definition used">{m.definitionUsed ?? <span className="text-ink-3">Not stated by the company</span>}</Row>
        <Row k="Entity scope">{m.entityScope}</Row>
        <Row k="Sample size">{m.sampleSize ?? <span className="text-ink-3">Unknown</span>}</Row>
        {m.cohortDefinition && <Row k="Cohort">{m.cohortDefinition}</Row>}
        {m.components.length > 0 && <Row k="Components">{m.components.join(", ")}</Row>}
        {m.derivation && <Row k="Derivation">{m.derivation}</Row>}
        <Row k="Source">
          {m.sourceId ? (
            <span className="flex flex-wrap items-center gap-2">
              <RefButton onClick={() => open({ kind: "source", id: m.sourceId! })}>{m.sourceId}</RefButton>
              <span className="text-ink-2">{source?.title}</span>
              {docOk ? (
                <button type="button" className="text-[12px] text-accent-text hover:underline" onClick={() => open({ kind: "doc", id: source!.documentId!, page: page! })}>
                  {m.location} — open page
                </button>
              ) : (
                m.location && <span className="text-[12px] text-ink-3">{m.location}</span>
              )}
            </span>
          ) : (
            <span className="text-ink-3">{m.calculationMethod === "DERIVED" ? "Computed by code from other metrics" : "—"}</span>
          )}
        </Row>
        {m.claimId && (
          <Row k="Claim">
            <RefButton onClick={() => open({ kind: "claim", id: m.claimId! })}>{m.claimId}</RefButton>
          </Row>
        )}
        {m.excerpt && (
          <Row k="Excerpt">
            <Excerpt>{m.excerpt}</Excerpt>
          </Row>
        )}
        {m.notes && <Row k="Notes">{m.notes}</Row>}
      </DrawerSection>

      <DrawerSection title="Quality flags">
        {m.qualityFlags.length ? (
          <ul className="space-y-1">
            {m.qualityFlags.map((f) => (
              <li key={f} className="font-mono text-[11.5px] text-warn">
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">None.</p>
        )}
      </DrawerSection>

      {def ? (
        <>
          <DrawerSection title="Dictionary definition">
            <p className="text-[13px] font-medium text-ink">{def.name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{def.definition}</p>
            {def.formula && <p className="mt-2 rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink-2">{def.formula}</p>}
            <div className="mt-2 text-[12px] text-ink-3">
              Unit {def.unit.toLowerCase()} · {def.period.toLowerCase().replace(/_/g, " ")} · {def.direction.toLowerCase().replace(/_/g, " ")} · max age {def.maxAgeMonths} mo
              {def.minSampleSize ? ` · min sample ${def.minSampleSize}` : ""}
              {def.minMeasurementMonths ? ` · min ${def.minMeasurementMonths} mo measured` : ""}
            </div>
            {def.exclusions.length > 0 && <p className="mt-1 text-[12px] text-ink-3">Excludes: {def.exclusions.join("; ")}</p>}
          </DrawerSection>
          {def.disambiguation.length > 0 && (
            <DrawerSection title="Disambiguation checklist">
              <p className="mb-2 text-[12px] text-ink-3">Confirm each before relying on this number.</p>
              <ul className="space-y-1.5">
                {def.disambiguation.map((d) => (
                  <li key={d} className="flex gap-2.5 text-[13px] text-ink-2">
                    <span aria-hidden className="mt-[3px] h-3 w-3 shrink-0 rounded-[3px] border border-line-strong" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
              {def.requiredFields.length > 0 && <p className="mt-2 text-[12px] text-ink-3">Required fields: {def.requiredFields.join(", ")}</p>}
            </DrawerSection>
          )}
        </>
      ) : (
        <DrawerSection title="Dictionary definition">
          <p className="text-[13px] text-ink-3">No dictionary entry for “{m.metricKey}”.</p>
        </DrawerSection>
      )}

      {siblings.length > 0 && (
        <DrawerSection title="Other instances of this metric">
          <ul className="divide-y divide-line rounded-md border border-line">
            {siblings.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => open({ kind: "metric", id: x.id })} className="grid w-full grid-cols-[64px_1fr_auto] items-baseline gap-3 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2">
                  <span className="font-mono text-[10.5px] text-ink-3">{x.id}</span>
                  <span className="text-ink-2">
                    <span className="num text-ink">{metricValue(x.unit, x.normalizedValue)}</span> · {x.periodEnd ?? "no period"} · {METHOD_TEXT[x.calculationMethod].toLowerCase()} · {STATE_TEXT[x.state].toLowerCase()}
                  </span>
                  {x.isPrimary ? <span className="text-[10px] uppercase tracking-wide text-accent-text">primary</span> : <span />}
                </button>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}

      {canWrite && <CorrectionForm key={m.id} m={m} companyId={companyId} versionId={versionId} onCorrected={onCorrected} />}
    </div>
  );
}

function CorrectionForm({ m, companyId, versionId, onCorrected }: { m: MetricInstance; companyId: string; versionId: string; onCorrected: (newId: string) => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = value.trim() ? parseAmount(value) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (parsed === null) return setError("Enter a number in the unit shown.");
    if (note.trim().length < 3) return setError("Add a short note: where the corrected value comes from.");
    setBusy(true);
    try {
      const r = await fetch(`/api/deals/${companyId}/metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metricId: m.id, value: parsed, note: note.trim(), versionId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setValue("");
      setNote("");
      onCorrected(j.metricId);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DrawerSection title="Correct this metric" className="rounded-lg border border-line bg-surface-2/60 px-3 py-3">
      <form onSubmit={submit} className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-3">Corrected value ({unitHint(m.unit)})</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder={m.normalizedValue !== null ? String(m.normalizedValue) : "value"}
            className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus-visible:border-accent"
          />
          {parsed !== null && <span className="mt-1 block text-[11.5px] text-ink-3">Will be stored as {metricValue(m.unit, parsed)}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-3">Note — source or reason (kept in the audit trail)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Data room ARR bridge excludes $420k of pilots" className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] outline-none focus-visible:border-accent" />
        </label>
        {!m.isPrimary && <p className="text-[12px] text-ink-3">User corrections take precedence: the corrected value becomes the primary instance for this metric.</p>}
        {error && <p className="text-[12px] text-risk">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-ink-3">Creates a new version; the original instance is kept. Scores are recomputed.</span>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </Button>
        </div>
      </form>
    </DrawerSection>
  );
}

/* ------------------------------------------------------------------ */
/* Document page                                                       */
/* ------------------------------------------------------------------ */

export function DocDetail({ id, page, idx, open }: { id: string; page: number; idx: EvidenceIndex; open: (s: Selection) => void }) {
  const d = idx.documents.find((x) => x.id === id);
  if (!d) return <p className="text-ink-3">Document not found for this company.</p>;
  const p = d.pages.find((x) => x.pageNo === page);
  const pos = d.pages.findIndex((x) => x.pageNo === page);
  const prev = pos > 0 ? d.pages[pos - 1] : undefined;
  const next = pos >= 0 && pos < d.pages.length - 1 ? d.pages[pos + 1] : undefined;
  const srcIds = new Set(idx.sources.filter((s) => s.documentId === d.id).map((s) => s.id));
  const citing = idx.claims.flatMap((c) => c.evidence.filter((e) => srcIds.has(e.sourceId) && pageFromLocation(e.location) === page).map((e) => ({ c, e })));
  const flags = idx.securityFlags.filter((f) => f.location.includes(d.filename) && pageFromLocation(f.location) === page);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="num text-[12px] text-ink-3">
          Page {page} of {d.pages.length}
        </span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" disabled={!prev} onClick={() => prev && open({ kind: "doc", id: d.id, page: prev.pageNo })}>
            ← Prev
          </Button>
          <Button size="sm" variant="secondary" disabled={!next} onClick={() => next && open({ kind: "doc", id: d.id, page: next.pageNo })}>
            Next →
          </Button>
        </div>
      </div>
      {flags.length > 0 && (
        <p className="mb-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
          This page contains {flags.length} instruction-like passage{flags.length > 1 ? "s" : ""} addressed to an AI. It was treated as data and ignored.
        </p>
      )}
      {citing.length > 0 && (
        <DrawerSection title={`Claims citing this page (${citing.length})`}>
          <ul className="divide-y divide-line">
            {citing.map(({ c, e }, i) => (
              <li key={i}>
                <button type="button" onClick={() => open({ kind: "claim", id: c.id })} className="block w-full py-1.5 text-left hover:bg-surface-2">
                  <span className="font-mono text-[10.5px] text-ink-3">{c.id}</span> <span className="text-[12.5px] text-ink-2">“{e.excerpt}”</span>
                </button>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
      <DrawerSection title="Extracted text">
        {p ? (
          p.text.trim() ? (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-3 py-2.5 font-sans text-[12.5px] leading-relaxed text-ink">{p.text}</pre>
          ) : (
            <p className="text-[13px] italic text-ink-3">No extractable text on this page (image-only).</p>
          )
        ) : (
          <p className="text-[13px] text-ink-3">Page {page} does not exist in this document.</p>
        )}
      </DrawerSection>
    </div>
  );
}
