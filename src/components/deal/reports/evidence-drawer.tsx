"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Claim, Source } from "@/domain/canonical";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { Badge, cx } from "@/components/ui";
import { EVIDENCE_LABEL_TEXT, date, evidenceLabelTone, titleCase, type Tone } from "@/lib/format";

type Target = { kind: "claim" | "source"; id: string } | null;

interface Ctx {
  open: (t: NonNullable<Target>) => void;
  current: Target;
}

const DrawerCtx = createContext<Ctx | null>(null);

/**
 * Right-side evidence drawer for report readers (§99). Claim and source
 * chips inside the memo open it; nothing leaves the page.
 */
export function EvidenceDrawerProvider({ claims, sources, slug, children }: { claims: Claim[]; sources: Source[]; slug: string; children: ReactNode }) {
  const [current, setCurrent] = useState<Target>(null);
  const open = useCallback((t: NonNullable<Target>) => setCurrent(t), []);
  const claimMap = useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);
  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCurrent(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  return (
    <DrawerCtx.Provider value={{ open, current }}>
      {children}
      {current && (
        <aside
          role="dialog"
          aria-label="Evidence"
          className="no-print anim-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <div className="flex items-center gap-2">
              <span className="t-eyebrow">Evidence</span>
              <span className="font-mono text-[11.5px] text-ink-2">{current.id}</span>
            </div>
            <button onClick={() => setCurrent(null)} className="rounded px-1.5 text-[12.5px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close evidence drawer">
              Close <span className="text-[10.5px]">Esc</span>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {current.kind === "claim" ? (
              <ClaimDetail claim={claimMap.get(current.id)} id={current.id} sources={sourceMap} slug={slug} onSource={(id) => open({ kind: "source", id })} />
            ) : (
              <SourceDetail source={sourceMap.get(current.id)} id={current.id} claims={claims} slug={slug} onClaim={(id) => open({ kind: "claim", id })} />
            )}
          </div>
        </aside>
      )}
    </DrawerCtx.Provider>
  );
}

const EFFECT_TONE: Record<string, Tone> = { ORIGIN: "neutral", CONFIRMS: "ok", PARTIALLY_CONFIRMS: "warn", CONTRADICTS: "risk", NEW_INFORMATION: "accent" };

function ClaimDetail({ claim, id, sources, slug, onSource }: { claim: Claim | undefined; id: string; sources: Map<string, Source>; slug: string; onSource: (id: string) => void }) {
  if (!claim) return <p className="text-ink-3">Claim {id} is not in this version&apos;s evidence ledger.</p>;
  const label = evidenceLabel(claim);
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={evidenceLabelTone(label)} dot>
            {EVIDENCE_LABEL_TEXT[label]}
          </Badge>
          <Badge>{titleCase(claim.category)}</Badge>
          {claim.material && <Badge tone="accent">Material</Badge>}
        </div>
        <p className="text-[14px] leading-relaxed text-ink">{claim.statement}</p>
        {(claim.valueText || claim.period) && (
          <p className="num mt-1 text-[12.5px] text-ink-3">
            {claim.valueText}
            {claim.valueText && claim.period && " · "}
            {claim.period}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line py-3 text-[12.5px]">
        <Dim k="Origin" v={titleCase(claim.origin)} />
        <Dim k="Verification" v={titleCase(claim.verification)} tone={claim.verification === "VERIFIED" ? "ok" : claim.verification === "CONTRADICTED" ? "risk" : undefined} />
        <Dim k="Freshness" v={titleCase(claim.freshness)} tone={claim.freshness === "STALE" ? "warn" : undefined} />
        <Dim k="Independence" v={titleCase(claim.independence)} />
        <div className="col-span-2">
          <dt className="text-ink-3">Method</dt>
          <dd className="text-ink-2">{claim.verificationMethod}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-3">Entity</dt>
          <dd className="text-ink-2">{claim.entity}</dd>
        </div>
      </dl>

      {claim.limitations && (
        <div>
          <div className="t-eyebrow mb-1">Limitations</div>
          <p className="text-[13px] text-ink-2">{claim.limitations}</p>
        </div>
      )}
      {claim.contradictions.length > 0 && (
        <div>
          <div className="t-eyebrow mb-1 !text-risk">Contradictions</div>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-2">
            {claim.contradictions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="t-eyebrow mb-2">Evidence ({claim.evidence.length})</div>
        <ol className="space-y-3">
          {claim.evidence.map((e, i) => {
            const s = sources.get(e.sourceId);
            return (
              <li key={i} className="border-l-2 border-line pl-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={EFFECT_TONE[e.effect] ?? "neutral"}>{titleCase(e.effect)}</Badge>
                  <button onClick={() => onSource(e.sourceId)} className="font-mono text-[10.5px] text-ink-3 hover:text-accent-text">
                    {e.sourceId}
                  </button>
                  {e.location && <span className="text-[11.5px] text-ink-3">{e.location}</span>}
                </div>
                <blockquote className="text-[13px] leading-relaxed text-ink-2">“{e.excerpt}”</blockquote>
                {s && <SourceLine s={s} />}
                {e.note && <p className="mt-1 text-[12px] text-ink-3">{e.note}</p>}
              </li>
            );
          })}
        </ol>
      </div>

      {claim.history.length > 0 && (
        <div>
          <div className="t-eyebrow mb-1">History</div>
          <ul className="space-y-0.5 text-[12px] text-ink-3">
            {claim.history.map((h, i) => (
              <li key={i}>
                <span className="num">{date(h.at)}</span> · {titleCase(h.change)} — {h.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href={`/deals/${slug}/evidence?claim=${claim.id}`} className="inline-block text-[12.5px] text-ink-3 hover:text-ink">
        Open in evidence ledger →
      </Link>
    </div>
  );
}

function SourceLine({ s }: { s: Source }) {
  return (
    <div className="mt-1 text-[12px] text-ink-3">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent-text">
          {s.title}
        </a>
      ) : (
        <span className="text-ink-2">{s.title}</span>
      )}
      {s.publisher && s.publisher !== s.title && <span> · {s.publisher}</span>}
      {s.publishedDate && <span> · {s.publishedDate}</span>}
      {!s.citationVerified && <span className="text-warn"> · citation not verified</span>}
    </div>
  );
}

function SourceDetail({ source, id, claims, slug, onClaim }: { source: Source | undefined; id: string; claims: Claim[]; slug: string; onClaim: (id: string) => void }) {
  if (!source) return <p className="text-ink-3">Source {id} is not in this version&apos;s evidence ledger.</p>;
  const related = claims.filter((c) => c.evidence.some((e) => e.sourceId === source.id));
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Badge>{titleCase(source.kind)}</Badge>
          <Badge>{titleCase(source.origin)}</Badge>
          {!source.citationVerified && <Badge tone="warn">Citation not verified</Badge>}
        </div>
        <p className="text-[14px] font-medium text-ink">{source.title}</p>
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-[12.5px] text-accent-text hover:underline">
            {source.url}
          </a>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line py-3 text-[12.5px]">
        <Dim k="Publisher" v={source.publisher ?? "—"} />
        <Dim k="Published" v={source.publishedDate ?? "—"} />
        <Dim k="Retrieved" v={date(source.retrievedAt)} />
        <Dim k="Independence group" v={source.independenceGroup} />
      </dl>
      <div>
        <div className="t-eyebrow mb-2">Claims citing this source ({related.length})</div>
        <ul className="space-y-2">
          {related.map((c) => (
            <li key={c.id} className="text-[13px] text-ink-2">
              <button onClick={() => onClaim(c.id)} className="mr-1.5 rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
                {c.id}
              </button>
              {c.statement}
            </li>
          ))}
        </ul>
      </div>
      <Link href={`/deals/${slug}/evidence?source=${source.id}`} className="inline-block text-[12.5px] text-ink-3 hover:text-ink">
        Open in evidence ledger →
      </Link>
    </div>
  );
}

function Dim({ k, v, tone }: { k: string; v: string; tone?: Tone }) {
  return (
    <div>
      <dt className="text-ink-3">{k}</dt>
      <dd className={cx(tone === "ok" ? "text-ok" : tone === "risk" ? "text-risk" : tone === "warn" ? "text-warn" : "text-ink-2")}>{v}</dd>
    </div>
  );
}

/** Inline reference chip. Opens the drawer when inside a provider, else links to the ledger. */
export function RefChip({ id, slug }: { id: string; slug: string }) {
  const ctx = useContext(DrawerCtx);
  const kind = id.startsWith("SRC") ? "source" : "claim";
  const active = ctx?.current?.id === id;
  const cls = cx(
    "rounded px-1 font-mono text-[10.5px] transition-colors print:bg-transparent print:px-0 print:text-ink-3",
    active ? "bg-accent-soft text-accent-text ring-1 ring-accent/30" : "bg-surface-3 text-ink-2 hover:bg-accent-soft hover:text-accent-text",
  );
  if (!ctx)
    return (
      <Link href={`/deals/${slug}/evidence?${kind}=${id}`} className={cls}>
        {id}
      </Link>
    );
  return (
    <button type="button" onClick={() => ctx.open({ kind, id })} className={cls} aria-label={`Show evidence for ${id}`}>
      {id}
    </button>
  );
}
