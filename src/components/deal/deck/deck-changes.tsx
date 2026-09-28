/**
 * "What changed since the last deck" — engine/latent/deck-diff.ts on the stored
 * analyses of two consecutive deck versions (server/deck-versions.ts). Every
 * number is code-computed from what each deck said; pages are cited.
 * `compact`: overview card (headlines); otherwise the full comparison (History).
 */
import Link from "next/link";
import type { DeckComparison } from "@/server/deck-versions";
import type { MilestoneCheck, NumberPoint } from "@/engine/latent/deck-diff";
import { metricDef } from "@/engine/metrics/dictionary";
import { Badge, Section, cx } from "@/components/ui";
import { metricValue, titleCase } from "@/lib/format";

const fmt = (key: string, v: number) => metricValue(metricDef(key)?.unit ?? "COUNT", v);
const pg = (p: number | null) => (p !== null ? ` · p. ${p}` : "");
const pct = (p: number | null) => (p === null ? "n/a" : `${p > 0 ? "+" : ""}${p}%`);

function headlineTone(h: string): "warn" | "ok" | "neutral" {
  if (/^(Missed|Not reported|No longer reported|Customer logos no longer|Stopped talking)|restated|downgraded/.test(h)) return "warn";
  if (/^(Hit|New customer logos)|upgraded/.test(h)) return "ok";
  return "neutral";
}

const MILESTONE_TONE: Record<MilestoneCheck["status"], "ok" | "warn" | "risk" | "neutral"> = { HIT: "ok", MISSED: "risk", NOT_REPORTED: "warn", NOT_DUE: "neutral" };
const MILESTONE_TEXT: Record<MilestoneCheck["status"], string> = { HIT: "Hit", MISSED: "Missed", NOT_REPORTED: "Not reported", NOT_DUE: "Not due yet" };

function Point({ k, p }: { k: string; p: NumberPoint }) {
  return (
    <span>
      <span className="num text-ink">{fmt(k, p.value)}</span>
      <span className="text-ink-3">
        {p.period ? ` · ${p.period}` : ""}
        {pg(p.page)}
      </span>
    </span>
  );
}

export function DeckChanges({ comparison: c, slug, compact = false }: { comparison: DeckComparison; slug: string; compact?: boolean }) {
  const title = compact ? "What changed since the last deck" : `Deck v${c.previous.seq} → deck v${c.current.seq}`;
  const provenance = (
    <p className="mb-3 text-[12.5px] text-ink-3">
      Deck v{c.previous.seq} <span className="text-ink-2">{c.previous.filename}</span>
      {c.previousVersion ? ` (analysis v${c.previousVersion.versionNo})` : ""} → deck v{c.current.seq} <span className="text-ink-2">{c.current.filename}</span>
      {c.currentVersion ? ` (analysis v${c.currentVersion.versionNo})` : ""}. Computed by code from what each deck said — not the analyst overrides.
    </p>
  );
  if (!c.diff)
    return (
      <Section id={compact ? "deck-changes" : `deck-v${c.current.seq}`} eyebrow={`Deck v${c.current.seq}`} title={title}>
        {provenance}
        <p className="text-ink-3">Comparison unavailable: {c.unavailable}.</p>
      </Section>
    );
  const d = c.diff;
  const counts: [number, string][] = [
    [d.changedNumbers.filter((x) => x.kind === "RESTATED").length, "restated"],
    [d.changedNumbers.filter((x) => x.kind === "UPDATED").length, "updated"],
    [d.metricsRemoved.length, "no longer reported"],
    [d.metricsAdded.length, "newly reported"],
    [d.milestones.filter((m) => m.status === "MISSED").length, "milestones missed"],
    [d.milestones.filter((m) => m.status === "HIT").length, "milestones hit"],
    [d.logosRemoved.length, "logos dropped"],
    [d.termChanges.length + d.marketChanges.filter((m) => ["TAM", "SAM", "SOM"].includes(m.field)).length, "round / market changes"],
  ];
  const chips = counts.filter(([n]) => n > 0);

  if (compact) {
    const shown = d.headlines.slice(0, 6);
    return (
      <Section
        id="deck-changes"
        eyebrow={`Deck v${c.previous.seq} → v${c.current.seq}`}
        title={title}
        action={
          <Link href={`/deals/${slug}/history#deck-v${c.current.seq}`} className="text-[12.5px] text-ink-3 hover:text-ink">
            Full comparison →
          </Link>
        }
      >
        {provenance}
        {chips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {chips.map(([n, label]) => (
              <Badge key={label} tone="neutral">
                {n} {label}
              </Badge>
            ))}
          </div>
        )}
        {shown.length ? (
          <ul className="space-y-1.5 text-[13px]">
            {shown.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className={cx("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", headlineTone(h) === "warn" ? "bg-warn" : headlineTone(h) === "ok" ? "bg-ok" : "bg-ink-3")} />
                <span className="text-ink-2">{h}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-3">No material change between the two decks.</p>
        )}
        {d.headlines.length > shown.length && <p className="mt-2 text-[12px] text-ink-3">{d.headlines.length - shown.length} more in the full comparison.</p>}
      </Section>
    );
  }

  const th = "px-3 py-1.5 text-left text-[11.5px] font-medium text-ink-3";
  const td = "border-t border-line px-3 py-1.5 align-top";
  return (
    <Section id={`deck-v${c.current.seq}`} eyebrow="Deck versions" title={title}>
      {provenance}
      <div className="space-y-6">
        {d.changedNumbers.length > 0 && (
          <div>
            <div className="t-eyebrow mb-2">Restated and updated numbers</div>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead>
                  <tr>
                    <th className={th}>Metric</th>
                    <th className={th}>Kind</th>
                    <th className={th}>Deck v{c.previous.seq}</th>
                    <th className={th}>Deck v{c.current.seq}</th>
                    <th className={cx(th, "text-right")}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {d.changedNumbers.map((x, i) => (
                    <tr key={i}>
                      <td className={cx(td, "text-ink")}>{x.label}</td>
                      <td className={td}>
                        <Badge tone={x.kind === "RESTATED" ? "warn" : "neutral"}>{x.kind === "RESTATED" ? "Restated (same period)" : "Updated (newer period)"}</Badge>
                      </td>
                      <td className={td}>
                        <Point k={x.metricKey} p={x.previous} />
                      </td>
                      <td className={td}>
                        <Point k={x.metricKey} p={x.current} />
                      </td>
                      <td className={cx(td, "num text-right text-ink-2")}>{pct(x.changePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {d.milestones.length > 0 && (
          <div>
            <div className="t-eyebrow mb-2">Milestones promised in deck v{c.previous.seq}</div>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-[12.5px]">
              {d.milestones.map((m, i) => (
                <li key={i} className="grid gap-2 px-3 py-1.5 sm:grid-cols-[110px_1fr_auto]">
                  <Badge tone={MILESTONE_TONE[m.status]}>{MILESTONE_TEXT[m.status]}</Badge>
                  <span className="text-ink-2">
                    {m.description}
                    {m.dueDate && <span className="text-ink-3"> · due {m.dueDate}</span>}
                    {m.previousPage !== null && <span className="text-ink-3"> · p. {m.previousPage}</span>}
                  </span>
                  <span className="num text-ink-3">{m.actual ? `actual ${m.metricKey ? fmt(m.metricKey, m.actual.value) : m.actual.rawText}${m.gapPct !== null ? ` (${pct(m.gapPct)})` : ""}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(d.metricsRemoved.length > 0 || d.metricsAdded.length > 0) && (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="t-eyebrow mb-2">No longer reported</div>
              {d.metricsRemoved.length ? (
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {d.metricsRemoved.map((m) => (
                    <li key={m.metricKey}>
                      {m.label} <span className="text-ink-3">— last “{m.value}”{pg(m.page)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-3">None.</p>
              )}
            </div>
            <div>
              <div className="t-eyebrow mb-2">Newly reported</div>
              {d.metricsAdded.length ? (
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {d.metricsAdded.map((m) => (
                    <li key={m.metricKey}>
                      {m.label} <span className="text-ink-3">— “{m.value}”{pg(m.page)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-3">None.</p>
              )}
            </div>
          </div>
        )}

        {(d.marketChanges.length > 0 || d.termChanges.length > 0) && (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="t-eyebrow mb-2">Market as pitched</div>
              {d.marketChanges.length ? (
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {d.marketChanges.map((m, i) => (
                    <li key={i}>
                      <span className="text-ink-3">{m.field === "MARKET_CLAIM_ADDED" ? "New claim" : m.field === "MARKET_CLAIM_REMOVED" ? "Dropped claim" : titleCase(m.field)}:</span> {m.previous ?? "—"} → {m.current ?? "—"}
                      {m.changePct !== null && <span className="num text-ink-3"> ({pct(m.changePct)})</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-3">Unchanged.</p>
              )}
            </div>
            <div>
              <div className="t-eyebrow mb-2">Round terms</div>
              {d.termChanges.length ? (
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {d.termChanges.map((t, i) => (
                    <li key={i}>
                      <span className="text-ink-3">{titleCase(t.field.replace(/([A-Z])/g, "_$1"))}:</span> {t.previous ?? "not stated"} → {t.current ?? "not stated"}
                      {t.changePct !== null && <span className="num text-ink-3"> ({pct(t.changePct)})</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-3">Unchanged.</p>
              )}
            </div>
          </div>
        )}

        {(d.logosRemoved.length > 0 || d.logosAdded.length > 0 || d.logoStatusChanges.length > 0) && (
          <div>
            <div className="t-eyebrow mb-2">Customer logos</div>
            <ul className="space-y-1 text-[12.5px] text-ink-2">
              {d.logosRemoved.map((l) => (
                <li key={`r${l.name}`}>
                  <Badge tone="warn">Dropped</Badge> {l.name} <span className="text-ink-3">(was {titleCase(l.previousLevel ?? "unknown")})</span>
                </li>
              ))}
              {d.logoStatusChanges.map((l) => (
                <li key={`s${l.name}`}>
                  <Badge tone="neutral">Changed</Badge> {l.name} <span className="text-ink-3">{titleCase(l.previousLevel ?? "?")} → {titleCase(l.currentLevel ?? "?")}</span>
                </li>
              ))}
              {d.logosAdded.map((l) => (
                <li key={`a${l.name}`}>
                  <Badge tone="ok">New</Badge> {l.name} <span className="text-ink-3">({titleCase(l.currentLevel ?? "unknown")})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {d.stoppedTalkingAbout.length > 0 && (
          <div>
            <div className="t-eyebrow mb-2">What the founder stopped talking about</div>
            <ul className="space-y-1 text-[12.5px] text-ink-2">
              {d.stoppedTalkingAbout.slice(0, 12).map((t, i) => (
                <li key={i}>
                  <Badge tone="neutral">{titleCase(t.kind)}</Badge> {t.topic}
                  <span className="text-ink-3">
                    {t.kind !== "CLAIM" && ` — last ${t.lastSeen}`}
                    {pg(t.page)}
                  </span>
                </li>
              ))}
            </ul>
            {d.stoppedTalkingAbout.length > 12 && <p className="mt-1 text-[12px] text-ink-3">{d.stoppedTalkingAbout.length - 12} more topics.</p>}
          </div>
        )}

        {!d.headlines.length && <p className="text-ink-3">No material change between the two decks.</p>}
      </div>
    </Section>
  );
}
