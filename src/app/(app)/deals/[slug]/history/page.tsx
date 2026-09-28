import Link from "next/link";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import { listRunsWithCost } from "@/server/runs";
import { defaultComparison, diffVersions } from "@/reports/version-diff";
import { applyOverrides } from "@/engine/overrides";
import { Badge, Section, cx } from "@/components/ui";
import { date } from "@/lib/format";
import { VersionPicker } from "@/components/deal/history/version-picker";
import { VersionDiffView } from "@/components/deal/history/version-diff-view";
import { HISTORY_TYPE_TEXT, RUN_KIND_TEXT, reasonText } from "@/components/deal/history/labels";
import { deckAnalysisRow, deckComparisonForVersion, deckLineage } from "@/server/deck-versions";
import { DeckChanges } from "@/components/deal/deck/deck-changes";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

const time = (s: string) => `${date(s)} · ${s.slice(11, 16)} UTC`;
const usd4 = (n: number) => `$${n.toFixed(4)}`;

function duration(a: string, b: string | null) {
  if (!b) return "—";
  const s = Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 90 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)} min`;
}

const TYPE_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "risk"> = {
  FOUNDER_CALL_ADDED: "accent",
  METRIC_CORRECTED: "accent",
  OVERRIDE_ADDED: "accent",
  OVERRIDES_CARRIED_OVER: "accent",
  DECK_VERSION_ADDED: "accent",
  COMPANY_MERGED: "warn",
  RECOMMENDATION_CHANGED: "warn",
  ANALYSIS_COMPLETED: "ok",
  BENCHMARK_RECALCULATED: "neutral",
};

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { session, company } = await loadDeal(slug);

  const versions = repo.listVersions(company.id); // newest first
  const byId = new Map(versions.map((v) => [v.id, v]));
  const def = defaultComparison(versions);
  const fromId = one(sp.from) && byId.has(one(sp.from)!) ? one(sp.from)! : def?.fromId;
  const toId = one(sp.to) && byId.has(one(sp.to)!) ? one(sp.to)! : def?.toId;
  const a = fromId ? repo.getVersion(company.id, fromId) : null;
  const b = toId ? repo.getVersion(company.id, toId) : null;
  // Compare the effective deals (raw extraction + analyst overrides), the same objects derive() scored.
  const diff = a && b && a.row.id !== b.row.id ? diffVersions({ ...a.row, canonical: applyOverrides(a.canonical), derived: a.derived }, { ...b.row, canonical: applyOverrides(b.canonical), derived: b.derived }) : null;
  const isDefault = fromId === def?.fromId && toId === def?.toId;

  // Timeline: history events plus versions no event points to (e.g. preliminary versions).
  const events = repo.listHistory(company.id);
  const referenced = new Set(events.map((e) => e.versionId).filter(Boolean));
  type Item = { at: string; kind: "event" | "version"; type: string; summary: string; versionId: string | null };
  const items: Item[] = [
    ...events.map((e) => ({ at: e.createdAt, kind: "event" as const, type: e.type, summary: e.summary, versionId: e.versionId })),
    ...versions.filter((v) => !referenced.has(v.id)).map((v) => ({ at: v.createdAt, kind: "version" as const, type: v.reason, summary: v.summary ?? reasonText(v.reason), versionId: v.id })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  const prevOf = (vid: string) => {
    const v = byId.get(vid);
    return v ? versions.find((x) => x.versionNo === v.versionNo - 1) : undefined;
  };

  // Deck lineage (v1 → v2 → v3) and, for each deck from v2, what changed since the previous one.
  const decks = deckLineage(company.id).map((e) => {
    const row = deckAnalysisRow(company.id, e.documentId, Number.MAX_SAFE_INTEGER);
    return { e, row, comparison: row && e.seq > 1 ? deckComparisonForVersion(company.id, row.id) : null };
  });

  const runs = listRunsWithCost(session.workspaceId, company.id);
  const totalSpent = runs.reduce((s, r) => s + r.run.spentUsd, 0);

  return (
    <main className="mx-auto max-w-[1180px] space-y-14 px-4 py-8 sm:px-8">
      {decks.length > 0 && (
        <Section id="decks" eyebrow="Deck versions" title={decks.length > 1 ? `${decks.length} decks from this company` : "One deck so far"}>
          <ol className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
            {[...decks].reverse().map(({ e, row }) => (
              <li key={e.seq} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[70px_1fr_auto]">
                <Badge tone={e.seq === decks.at(-1)!.e.seq ? "accent" : "neutral"}>Deck v{e.seq}</Badge>
                <span className="min-w-0 truncate text-ink">
                  {e.filename}
                  <span className="text-ink-3">
                    {" "}
                    · uploaded {time(e.createdAt)}
                    {e.inferred ? " · first deck on record" : ""}
                  </span>
                </span>
                <span className="text-[12px] text-ink-3">
                  {row ? (
                    <Link href={`/deals/${company.slug}/history?${prevOf(row.id) ? `from=${prevOf(row.id)!.id}&` : ""}to=${row.id}#compare`} className="hover:text-accent-text">
                      analysed in v{row.versionNo}
                    </Link>
                  ) : (
                    "not analysed yet"
                  )}
                </span>
              </li>
            ))}
          </ol>
          {decks.length < 2 && <p className="mt-2 text-[12.5px] text-ink-3">Upload the founder&apos;s next deck with “New deck version” in the header: it is analysed on this company and compared with this one.</p>}
        </Section>
      )}
      {[...decks]
        .reverse()
        .filter((x) => x.comparison)
        .map((x, i) =>
          i === 0 ? (
            <DeckChanges key={x.e.seq} comparison={x.comparison!} slug={company.slug} />
          ) : (
            <details key={x.e.seq} className="rounded-lg border border-line px-4 py-3">
              <summary className="cursor-pointer text-[13px] text-ink-2">
                Deck v{x.e.seq - 1} → deck v{x.e.seq}
              </summary>
              <div className="mt-4">
                <DeckChanges comparison={x.comparison!} slug={company.slug} />
              </div>
            </details>
          ),
        )}
      <Section
        id="compare"
        eyebrow="Version comparison"
        title={diff ? `v${diff.from.versionNo} ${reasonText(diff.from.reason).toLowerCase()} → v${diff.to.versionNo} ${reasonText(diff.to.reason).toLowerCase()}` : "Compare two versions"}
        action={versions.length >= 2 && fromId && toId ? <VersionPicker slug={company.slug} versions={[...versions].map((v) => ({ id: v.id, versionNo: v.versionNo, reason: v.reason, createdAt: v.createdAt }))} fromId={fromId} toId={toId} /> : undefined}
      >
        {versions.length < 2 ? (
          <p className="text-ink-3">Only one version exists. Corrections, question updates, founder calls and benchmark recalculations each create a new version to compare against.</p>
        ) : !diff ? (
          <p className="text-ink-3">Pick two different versions.</p>
        ) : (
          <>
            <p className="mb-5 text-[12.5px] text-ink-3">
              {isDefault ? (versions.some((v) => v.reason === "FOUNDER_CALL") ? "Default: before vs after the latest founder call. " : "Default: previous vs current version. ") : ""}
              {diff.changeCount} change{diff.changeCount === 1 ? "" : "s"} · v{diff.from.versionNo} saved {time(diff.from.createdAt)} · v{diff.to.versionNo} saved {time(diff.to.createdAt)}
            </p>
            <VersionDiffView diff={diff} slug={company.slug} />
          </>
        )}
      </Section>

      <Section id="timeline" eyebrow="Timeline" title="What happened to this deal">
        {items.length === 0 ? (
          <p className="text-ink-3">No history recorded.</p>
        ) : (
          <ol className="relative ml-2 border-l border-line">
            {items.map((it, i) => {
              const v = it.versionId ? byId.get(it.versionId) : undefined;
              const prev = it.versionId ? prevOf(it.versionId) : undefined;
              return (
                <li key={i} className="relative grid grid-cols-[170px_1fr] gap-4 pb-4 pl-5 last:pb-0">
                  <span className={cx("absolute -left-[4.5px] top-[6px] h-2 w-2 rounded-full ring-2 ring-bg", it.type === "RECOMMENDATION_CHANGED" ? "bg-warn" : it.kind === "version" ? "bg-line-strong" : it.type === "FOUNDER_CALL_ADDED" || it.type === "METRIC_CORRECTED" ? "bg-accent" : "bg-ink-3")} />
                  <span className="num pt-[1px] text-[12px] text-ink-3">{time(it.at)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONE[it.type] ?? "neutral"}>{it.kind === "event" ? (HISTORY_TYPE_TEXT[it.type] ?? it.type) : `Version · ${reasonText(it.type)}`}</Badge>
                      {v && (
                        <Link
                          href={prev ? `/deals/${company.slug}/history?from=${prev.id}&to=${v.id}#compare` : `/deals/${company.slug}/history`}
                          className="num rounded bg-surface-3 px-1.5 font-mono text-[10.5px] text-ink-2 hover:text-accent-text"
                          title={prev ? `Compare v${prev.versionNo} → v${v.versionNo}` : undefined}
                        >
                          v{v.versionNo}
                        </Link>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-2">{it.summary}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section
        id="runs"
        eyebrow="Analysis runs and cost"
        title="Every model run, its budget and what it cost"
        action={
          <span className="num text-[12.5px] text-ink-3">
            {runs.length} run{runs.length === 1 ? "" : "s"} · {usd4(totalSpent)} total
          </span>
        }
      >
        {runs.length === 0 ? (
          <p className="text-ink-3">No runs recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  {["Started", "Run", "Status", "Depth", "Model", "Spent / cap", "Duration", ""].map((h, i) => (
                    <th key={i} className={cx("px-3 py-2 font-medium", h === "Spent / cap" && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              {runs.map(({ run, costs }) => {
                const pctOfCap = run.budgetUsd > 0 ? Math.min(100, (run.spentUsd / run.budgetUsd) * 100) : 0;
                const tok = costs.reduce((s, c) => ({ inp: s.inp + c.inputTokens, cached: s.cached + c.cachedTokens, out: s.out + c.outputTokens, web: s.web + c.webSearches }), { inp: 0, cached: 0, out: 0, web: 0 });
                return (
                  <tbody key={run.id} className="align-top">
                    <tr>
                      <td className="num border-t border-line px-3 py-2 text-[12.5px] text-ink-2">{time(run.startedAt)}</td>
                      <td className="border-t border-line px-3 py-2">
                        <div className="text-ink">{RUN_KIND_TEXT[run.kind] ?? run.kind}</div>
                        <div className="text-[11.5px] text-ink-3">
                          {run.mode.replace("_", " ").toLowerCase()} · <span className="font-mono">{run.id}</span>
                        </div>
                      </td>
                      <td className="border-t border-line px-3 py-2">
                        <Badge tone={run.status === "COMPLETED" ? "ok" : run.status === "FAILED" ? "risk" : run.status === "PARTIAL" ? "warn" : "accent"}>{run.status.charAt(0) + run.status.slice(1).toLowerCase()}</Badge>
                        {run.error && <div className="mt-1 max-w-[260px] text-[11.5px] text-risk">{run.error}</div>}
                      </td>
                      <td className="border-t border-line px-3 py-2 text-ink-2">{run.depth ? run.depth.charAt(0) + run.depth.slice(1).toLowerCase() : "—"}</td>
                      <td className="border-t border-line px-3 py-2 font-mono text-[11.5px] text-ink-2">{run.model}</td>
                      <td className="num border-t border-line px-3 py-2 text-right">
                        <div className="text-ink">
                          {usd4(run.spentUsd)} <span className="text-ink-3">/ ${run.budgetUsd.toFixed(2)}</span>
                        </div>
                        <div className="ml-auto mt-1 h-1 w-24 rounded-full bg-surface-3" aria-hidden>
                          <div className={cx("h-1 rounded-full", pctOfCap > 90 ? "bg-warn" : "bg-ink-3")} style={{ width: `${pctOfCap}%` }} />
                        </div>
                        <div className="text-[11px] text-ink-3">{pctOfCap.toFixed(0)}% of hard cap</div>
                      </td>
                      <td className="num border-t border-line px-3 py-2 text-ink-2">{duration(run.startedAt, run.finishedAt)}</td>
                      <td className="border-t border-line px-3 py-2 text-[12px] text-ink-3">
                        {costs.length} call{costs.length === 1 ? "" : "s"}
                        <div className="num text-[11px]">
                          {(tok.inp / 1000).toFixed(1)}k in · {(tok.out / 1000).toFixed(1)}k out{tok.web ? ` · ${tok.web} searches` : ""}
                        </div>
                      </td>
                    </tr>
                    {costs.length > 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 pb-3">
                          <details className="text-[12px]">
                            <summary className="cursor-pointer text-ink-3 hover:text-ink">Cost records · prompt versions {Object.values(run.promptVersions).length ? Object.entries(run.promptVersions).filter(([, v]) => costs.some((c) => c.promptVersion === v)).map(([, v]) => v).join(", ") || "—" : "—"}</summary>
                            <table className="mt-2 w-full text-[12px]">
                              <thead>
                                <tr className="text-left text-[11px] text-ink-3">
                                  {["Step", "Model", "Prompt", "Input", "Cached", "Output", "Reasoning", "Searches", "Estimated", "Actual", "Latency"].map((h) => (
                                    <th key={h} className={cx("py-1 pr-3 font-medium", ["Input", "Cached", "Output", "Reasoning", "Searches", "Estimated", "Actual", "Latency"].includes(h) && "text-right")}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="num">
                                {costs.map((c) => (
                                  <tr key={c.id} className="border-t border-line text-ink-2">
                                    <td className="py-1 pr-3 font-mono text-[11px]">{c.step}</td>
                                    <td className="py-1 pr-3 font-mono text-[11px]">{c.model}</td>
                                    <td className="py-1 pr-3 font-mono text-[11px]">{c.promptVersion ?? "—"}</td>
                                    <td className="py-1 pr-3 text-right">{c.inputTokens.toLocaleString("en-US")}</td>
                                    <td className="py-1 pr-3 text-right">{c.cachedTokens.toLocaleString("en-US")}</td>
                                    <td className="py-1 pr-3 text-right">{c.outputTokens.toLocaleString("en-US")}</td>
                                    <td className="py-1 pr-3 text-right">{c.reasoningTokens.toLocaleString("en-US")}</td>
                                    <td className="py-1 pr-3 text-right">{c.webSearches}</td>
                                    <td className="py-1 pr-3 text-right text-ink-3">{usd4(c.estimatedUsd)}</td>
                                    <td className="py-1 pr-3 text-right text-ink">{usd4(c.actualUsd)}</td>
                                    <td className="py-1 pr-3 text-right">{c.latencyMs !== null ? `${(c.latencyMs / 1000).toFixed(1)}s` : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-1.5 text-ink-3">Estimated is the worst case authorized before each call; actual is priced from reported token usage.</p>
                          </details>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
        <p className="mt-2 text-[12px] text-ink-3">Every model call is authorized against the run’s hard cap before it runs; a run that would exceed it degrades to a partial analysis instead.</p>
      </Section>
    </main>
  );
}
