"use client";

/**
 * METRIC LINEAGE — every transformation from the raw text on a page to the
 * number that is scored: value, basis, period, source page and excerpt, the
 * ordered lineage steps (EXTRACTED → … → QUALITY_CHECKS), inputs of derived
 * metrics (clickable), flags explained, verification status and the override
 * history. Shared by the global lineage drawer and the evidence explorer.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MetricInstance, Source } from "@/domain/canonical";
import { Badge, Button, cx } from "@/components/ui";
import { metricValue, titleCase } from "@/lib/format";
import { flagText } from "@/components/deal/tabs/flag-text";
import { METHOD_TEXT, STATE_TEXT, VERIFICATION_TEXT, pageFromLocation, parseAmount, stateTone, unitHint, verificationTone } from "@/components/deal/evidence/labels";
import { sendOverride, showValue, type OverrideRow } from "@/components/deal/overrides/overrides-panel";

export interface OverrideEvent {
  at: string;
  type: string;
  summary: string;
  ref: string | null;
  by: string | null;
}

export interface LineageContextData {
  slug: string;
  companyId: string;
  versionId: string;
  canWrite: boolean;
  metrics: MetricInstance[];
  sources: Source[];
  overrides: OverrideRow[];
  events: OverrideEvent[];
  defs: Record<string, { name: string; definition: string; formula: string | null }>;
}

const STEP_TEXT: Record<string, string> = {
  EXTRACTED: "Extracted from the materials",
  PARSED: "Parsed from the raw text",
  PARSE_CHECK: "Checked against a deterministic parse",
  PARSE_OVERRIDE: "Model value replaced by the deterministic parse",
  RECLASSIFIED: "Reclassified by chronology basis",
  TIME_UNIT: "Converted to the dictionary time unit",
  PERCENT_SCALE: "Fraction scaled to percent",
  FX: "Converted to USD",
  FX_FAILED: "Currency conversion failed",
  ANNUALIZED: "Annualized",
  STALENESS: "Staleness check",
  QUALITY_CHECKS: "Quality checks",
  INPUTS: "Inputs",
  FORMULA: "Formula",
  OVERRIDE: "Analyst override",
  OVERRIDE_PROPAGATED: "Recomputed from an overridden input",
};

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1 text-[13px]">
      <div className="text-ink-3">{k}</div>
      <div className="min-w-0 break-words text-ink">{children}</div>
    </div>
  );
}

function Block({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="t-eyebrow">{title}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Headline block: value, override mark ("company reported X · analyst override Y · reason"), status badges. */
export function LineageHeadline({ m, overrides }: { m: MetricInstance; overrides: OverrideRow[] }) {
  const active = overrides.filter((o) => o.target === "METRIC" && o.ref === m.id && !o.stale);
  const last = active[active.length - 1];
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cx("num text-[26px] font-semibold tracking-tight", last ? "text-accent-text" : "text-ink")}>{metricValue(m.unit, m.normalizedValue)}</span>
        <span className="text-[12.5px] text-ink-3">raw “{m.rawValue}”</span>
      </div>
      {last && (
        <div className="mt-1.5 rounded-md border border-accent/25 bg-accent-soft/50 px-2.5 py-1.5 text-[12.5px]">
          <span className="text-ink-2">Company reported </span>
          <b className="font-medium text-ink">{typeof last.rawValue === "number" ? metricValue(m.unit, last.rawValue) : showValue(last.rawValue)}</b>
          <span className="text-ink-2"> · analyst override </span>
          <b className="font-medium text-accent-text">{typeof last.to === "number" ? metricValue(m.unit, last.to) : showValue(last.to)}</b>
          <span className="text-ink-3">
            {" "}
            · “{last.reason}” — {last.by ?? "unknown"}, {last.at.slice(0, 10)}
          </span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.isPrimary ? <Badge tone="accent">Primary — used for scoring</Badge> : <Badge tone="unknown">Not primary</Badge>}
        <Badge tone={stateTone(m.state)}>{STATE_TEXT[m.state]}</Badge>
        <Badge tone={verificationTone(m.verification)}>{VERIFICATION_TEXT[m.verification]}</Badge>
        <Badge tone="neutral">{METHOD_TEXT[m.calculationMethod]}</Badge>
        <Badge tone={m.basis === "FORECAST" || m.basis === "TARGET" || m.basis === "PIPELINE" ? "warn" : "neutral"}>Basis: {titleCase(m.basis)}</Badge>
      </div>
    </div>
  );
}

/** Lineage steps, inputs, flags and override history. */
export function LineageSections({ m, data, onOpenMetric, showSource = true }: { m: MetricInstance; data: LineageContextData; onOpenMetric: (id: string) => void; showSource?: boolean }) {
  const source = m.sourceId ? data.sources.find((s) => s.id === m.sourceId) : undefined;
  const page = pageFromLocation(m.location);
  const docHref = source?.documentId && page ? `/deals/${data.slug}/evidence?doc=${source.documentId}&page=${page}` : null;
  const inputs = m.inputs.map((id) => ({ id, m: data.metrics.find((x) => x.id === id) }));
  const dependents = data.metrics.filter((x) => x.inputs.includes(m.id));
  const overrides = data.overrides.filter((o) => o.target === "METRIC" && o.ref === m.id);
  const events = data.events.filter((e) => e.ref === m.id);
  return (
    <div>
      {showSource && (
        <Block title="Value and source">
          <Row k="Normalized">
            <span className="num">{m.normalizedValue ?? "—"}</span> <span className="text-ink-3">{m.unit}</span>
          </Row>
          <Row k="Period">
            {m.periodType.toLowerCase().replace(/_/g, " ")}
            {m.periodStart || m.periodEnd ? <span className="num text-ink-2"> · {[m.periodStart, m.periodEnd].filter(Boolean).join(" → ")}</span> : <span className="text-unknown"> · undated</span>}
          </Row>
          <Row k="Definition">{m.definitionUsed ?? <span className="text-unknown">Not stated by the company</span>}</Row>
          <Row k="Sample">{m.sampleSize ?? <span className="text-unknown">Unknown</span>}</Row>
          <Row k="Source">
            {source ? (
              <span>
                <Link href={`/deals/${data.slug}/evidence?source=${source.id}`} className="rounded bg-surface-3 px-1 font-mono text-[11px] text-ink-2 hover:text-accent-text">
                  {source.id}
                </Link>{" "}
                {source.title}
                {m.location && (
                  <>
                    {" · "}
                    {docHref ? (
                      <Link href={docHref} className="text-accent-text hover:underline">
                        {m.location} — open page
                      </Link>
                    ) : (
                      <span className="text-ink-3">{m.location}</span>
                    )}
                  </>
                )}
                <span className="block text-[11.5px] text-ink-3">
                  published {source.publishedDate ?? "undated"} · retrieved {source.retrievedAt.slice(0, 10)}
                </span>
              </span>
            ) : m.calculationMethod === "DERIVED" ? (
              <span className="text-ink-3">Computed by code from its inputs (below)</span>
            ) : (
              <span className="text-unknown">No source recorded</span>
            )}
          </Row>
          {m.claimId && (
            <Row k="Claim">
              <Link href={`/deals/${data.slug}/evidence?claim=${m.claimId}`} className="rounded bg-surface-3 px-1 font-mono text-[11px] text-ink-2 hover:text-accent-text">
                {m.claimId}
              </Link>
            </Row>
          )}
          {m.excerpt && (
            <Row k="Excerpt">
              <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed">“{m.excerpt}”</blockquote>
            </Row>
          )}
        </Block>
      )}

      <Block title="Lineage" aside={<span className="text-[11px] text-ink-3">{m.lineage.length} step{m.lineage.length === 1 ? "" : "s"}</span>}>
        {m.lineage.length ? (
          <ol className="relative ml-1.5 border-l border-line pl-4">
            {m.lineage.map((l, i) => (
              <li key={i} className="relative pb-2.5 last:pb-0">
                <span className={cx("absolute -left-[21px] top-[5px] h-2 w-2 rounded-full ring-2 ring-surface", l.step.startsWith("OVERRIDE") ? "bg-accent" : l.step === "QUALITY_CHECKS" || l.step === "FX_FAILED" || l.step === "PARSE_OVERRIDE" ? "bg-warn" : "bg-ink-3")} />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[10.5px] text-ink-3">{l.step}</span>
                  <span className="text-[12.5px] font-medium text-ink">{STEP_TEXT[l.step] ?? titleCase(l.step)}</span>
                </div>
                <div className="text-[12px] text-ink-2">{l.detail}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-ink-3">No lineage recorded (instance created before lineage tracking). The raw text and source above are the audit trail.</p>
        )}
      </Block>

      {m.calculationMethod === "DERIVED" && (
        <Block title="Inputs">
          {inputs.length ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {inputs.map(({ id, m: x }) => (
                <li key={id}>
                  <button type="button" onClick={() => onOpenMetric(id)} disabled={!x} className="grid w-full grid-cols-[64px_1fr_auto] items-baseline gap-3 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2 disabled:cursor-default">
                    <span className="font-mono text-[10.5px] text-ink-3">{id}</span>
                    <span className="text-ink-2">{x ? `${data.defs[x.metricKey]?.name ?? x.metricKey} · ${x.periodEnd ?? "undated"}` : "not in this version"}</span>
                    <span className="num text-ink">{x ? metricValue(x.unit, x.normalizedValue) : "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">Inputs not recorded.</p>
          )}
          {m.derivation && <p className="mt-1.5 rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink-2">{m.derivation}</p>}
        </Block>
      )}

      {dependents.length > 0 && (
        <Block title="Used by">
          <div className="flex flex-wrap gap-1.5">
            {dependents.map((x) => (
              <button key={x.id} type="button" onClick={() => onOpenMetric(x.id)} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text">
                {x.id} · {data.defs[x.metricKey]?.name ?? x.metricKey}
              </button>
            ))}
          </div>
        </Block>
      )}

      <Block title="Flags explained">
        {m.qualityFlags.length ? (
          <ul className="space-y-1">
            {m.qualityFlags.map((f) => {
              const t = flagText(f);
              return (
                <li key={f} className="text-[12.5px]">
                  <span className={t.tone === "risk" ? "text-risk" : t.tone === "warn" ? "text-warn" : "text-ink-2"}>{t.text}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-ink-3">{f.match(/^[A-Z0-9_]+/)?.[0]}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">None.</p>
        )}
      </Block>

      <Block title="Override history">
        {overrides.length === 0 && events.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">Never overridden.</p>
        ) : (
          <ul className="space-y-1.5 text-[12.5px]">
            {overrides.map((o) => (
              <li key={o.id}>
                <Badge tone={o.stale ? "unknown" : "accent"}>{o.stale ? "Not applied" : "Active"}</Badge> <span className="font-mono text-[10.5px] text-ink-3">{o.id}</span> {typeof o.from === "number" ? metricValue(m.unit, o.from) : showValue(o.from)} → <b className="font-medium">{typeof o.to === "number" ? metricValue(m.unit, o.to) : showValue(o.to)}</b> · “{o.reason}” — {o.by ?? "unknown"}, {o.at.slice(0, 10)}
              </li>
            ))}
            {events
              .filter((e) => e.type === "OVERRIDE_REVERTED")
              .map((e, i) => (
                <li key={`e${i}`} className="text-ink-3">
                  <Badge tone="neutral">Reverted</Badge> {e.summary} — {e.by ?? "unknown"}, {e.at.slice(0, 10)}
                </li>
              ))}
          </ul>
        )}
      </Block>

      {data.canWrite && m.calculationMethod !== "DERIVED" && <OverrideForm m={m} data={data} />}
      {data.canWrite && m.calculationMethod === "DERIVED" && <p className="text-[11.5px] text-ink-3">Derived values are computed by code; override one of the inputs instead.</p>}
    </div>
  );
}

function OverrideForm({ m, data }: { m: MetricInstance; data: LineageContextData }) {
  const router = useRouter();
  const active = data.overrides.filter((o) => o.target === "METRIC" && o.ref === m.id && !o.stale);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = value.trim() ? parseAmount(value) : null;

  const save = async () => {
    setError(null);
    if (parsed === null) return setError("Enter a number in the unit shown.");
    if (reason.trim().length < 3) return setError("Give the reason or source (kept in the audit trail).");
    setBusy("save");
    const err = await sendOverride(data.companyId, "POST", { target: "METRIC", ref: m.id, field: "normalizedValue", to: parsed, reason: reason.trim(), versionId: data.versionId });
    setBusy(null);
    if (err) return setError(err);
    setOpen(false);
    setValue("");
    setReason("");
    router.refresh();
  };
  const revert = async (id: string) => {
    setBusy(id);
    setError(null);
    const err = await sendOverride(data.companyId, "DELETE", { overrideId: id, versionId: data.versionId });
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  };

  return (
    <section className="rounded-lg border border-line bg-surface-2/60 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="t-eyebrow">Analyst override</div>
        <div className="flex gap-1.5">
          {active.map((o) => (
            <Button key={o.id} size="sm" variant="ghost" onClick={() => revert(o.id)} disabled={busy !== null}>
              {busy === o.id ? "Reverting…" : `Revert ${o.id}`}
            </Button>
          ))}
          {!open && (
            <Button size="sm" onClick={() => setOpen(true)}>
              Override value…
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-3">New value ({unitHint(m.unit)})</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={m.normalizedValue !== null ? String(m.normalizedValue) : "value"} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]" />
            {parsed !== null && <span className="mt-1 block text-[11.5px] text-ink-3">Scored as {metricValue(m.unit, parsed)}; the company-reported value stays visible.</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-3">Reason — source or rationale</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]" />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-ink-3">Saves a new version (reason USER_OVERRIDE). Raw extraction is never overwritten.</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={busy !== null}>
                {busy === "save" ? "Saving…" : "Save override"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-risk">{error}</p>}
    </section>
  );
}
