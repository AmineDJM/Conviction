"use client";

/**
 * "Refresh stale sources (N)": re-research only the items code selected as stale
 * (engine/refresh.ts), as a new version. Disabled — with the reason — when nothing
 * is stale. Shows what the last refresh re-checked, what happened to each item and
 * a link to the version diff. Progress and Stop live in the deal header's run bar.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, cx } from "@/components/ui";
import type { Tone } from "@/lib/format";

export interface RefreshPanelData {
  companyId: string;
  asOf: string;
  items: { key: string; kind: string; ref: string; label: string; reason: string }[];
  deferred: { key: string; kind: string; ref: string; label: string; reason: string }[];
  counts: Record<string, number>;
  /** Why the button is disabled when nothing is stale. */
  nothingMessage: string | null;
  budgetUsd: number;
  refreshRunning: boolean;
  otherRunRunning: boolean;
  last: {
    at: string;
    asOf: string;
    searches: number;
    costUsd: number;
    discardedOutOfScope: number;
    items: { key: string; kind: string; ref: string; outcome: string; note: string | null; newClaimIds: string[]; freshnessBefore: string | null; freshnessAfter: string | null }[];
    diffHref: string | null;
    versionLabel: string | null;
  } | null;
}

const KIND_TEXT: Record<string, string> = { CLAIM: "Claim", SOURCE: "Source", METRIC: "Metric", GAP: "Question" };
const OUTCOME: Record<string, { text: string; tone: Tone }> = {
  CONFIRMED: { text: "Confirmed", tone: "ok" },
  UPDATED: { text: "Newer information", tone: "accent" },
  CONTRADICTED: { text: "Contradicted", tone: "risk" },
  RESOLVED: { text: "Resolved", tone: "ok" },
  NOT_FOUND: { text: "Nothing newer found", tone: "unknown" },
  NO_RESULT: { text: "No result", tone: "unknown" },
};

export function RefreshStale({ data, canWrite, slug, compact = false }: { data: RefreshPanelData; canWrite: boolean; slug: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const n = data.items.length;
  const disabledReason = !canWrite
    ? "Read-only role"
    : data.refreshRunning
      ? "A refresh is running — progress is shown at the top of the page"
      : data.otherRunRunning
        ? "Another run is in progress for this company"
        : n === 0
          ? (data.nothingMessage ?? "Nothing is stale")
          : null;

  async function start() {
    setBusy(true);
    setMessage(null);
    const r = await fetch(`/api/deals/${encodeURIComponent(data.companyId)}/refresh`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.status === 202) router.refresh();
    else setMessage(j.message ?? j.error ?? "Could not start the refresh");
    setBusy(false);
  }

  const summary = Object.entries(data.counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${KIND_TEXT[k]?.toLowerCase() ?? k}${v === 1 ? "" : "s"}`)
    .join(", ");

  const button = (
    <Button size="sm" onClick={start} disabled={busy || disabledReason !== null} title={disabledReason ?? `One web-research call on these ${n} item(s) only, capped at $${data.budgetUsd.toFixed(2)}; creates a new version`}>
      {busy ? "Starting…" : `Refresh stale sources (${n})`}
    </Button>
  );

  if (compact)
    return (
      <div className="flex flex-col items-end gap-1">
        {button}
        {disabledReason && n === 0 && <span className="max-w-[340px] text-right text-[11.5px] text-ink-3">{disabledReason}</span>}
        {message && <span className="text-[11.5px] text-risk">{message}</span>}
      </div>
    );

  return (
    <div className="mb-8 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="t-eyebrow mb-1">Freshness</div>
          <div className="text-[13px] text-ink">
            {n > 0 ? (
              <>
                {n} stale item{n === 1 ? "" : "s"} as of {data.asOf.slice(0, 10)}: {summary}.{" "}
                <span className="text-ink-3">Only these are re-researched; everything else stays as it is.</span>
              </>
            ) : (
              <span className="text-ink-2">{data.nothingMessage}</span>
            )}
          </div>
          {data.deferred.length > 0 && <div className="mt-0.5 text-[12px] text-ink-3">{data.deferred.length} more due item(s) deferred (re-checked recently, or over the per-refresh cap).</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {button}
          {disabledReason && n > 0 && <span className="text-[11.5px] text-ink-3">{disabledReason}</span>}
          {message && <span className="max-w-[340px] text-right text-[11.5px] text-risk">{message}</span>}
        </div>
      </div>

      {(n > 0 || data.deferred.length > 0) && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
            <span className="group-open:hidden">Show what would be refreshed</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <ul className="mt-2 divide-y divide-line text-[12.5px]">
            {[...data.items.map((x) => ({ ...x, deferred: false })), ...data.deferred.map((x) => ({ ...x, deferred: true }))].map((x) => (
              <li key={x.key} className={cx("grid grid-cols-[76px_1fr] gap-3 py-1.5", x.deferred && "opacity-60")}>
                <span className="font-mono text-[11px] text-ink-3">
                  <Link href={refHref(slug, x.kind, x.ref)} className="hover:text-ink">
                    {x.ref}
                  </Link>
                </span>
                <span>
                  <span className="text-ink">{x.label}</span>
                  <span className="block text-[11.5px] text-ink-3">
                    {KIND_TEXT[x.kind] ?? x.kind} · {x.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.last && (
        <div className="mt-3 border-t border-line pt-2 text-[12.5px]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-ink-2">
              Last refresh {data.last.at.slice(0, 10)}: {data.last.items.length} item(s) re-checked · {data.last.searches} search(es) · ${data.last.costUsd.toFixed(4)}
              {data.last.discardedOutOfScope > 0 && <span className="text-ink-3"> · {data.last.discardedOutOfScope} out-of-scope result(s) discarded</span>}
            </span>
            {data.last.diffHref && (
              <Link href={data.last.diffHref} className="text-accent-text hover:underline">
                What changed{data.last.versionLabel ? ` (${data.last.versionLabel})` : ""} →
              </Link>
            )}
          </div>
          <details className="group mt-1">
            <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
              <span className="group-open:hidden">Show outcomes</span>
              <span className="hidden group-open:inline">Hide outcomes</span>
            </summary>
            <ul className="mt-1 divide-y divide-line">
              {data.last.items.map((x) => (
                <li key={x.key} className="grid grid-cols-[76px_150px_1fr] gap-3 py-1.5">
                  <Link href={refHref(slug, x.kind, x.ref)} className="font-mono text-[11px] text-ink-3 hover:text-ink">
                    {x.ref}
                  </Link>
                  <span>
                    <Badge tone={OUTCOME[x.outcome]?.tone ?? "neutral"}>{OUTCOME[x.outcome]?.text ?? x.outcome}</Badge>
                    {x.freshnessBefore && x.freshnessAfter && x.freshnessBefore !== x.freshnessAfter && (
                      <span className="block text-[11px] text-ink-3">
                        {x.freshnessBefore.toLowerCase()} → {x.freshnessAfter.toLowerCase()}
                      </span>
                    )}
                  </span>
                  <span className="text-ink-2">
                    {x.note ?? <span className="text-ink-3">—</span>}
                    {x.newClaimIds.length > 0 && (
                      <span className="block text-[11.5px] text-ink-3">
                        New:{" "}
                        {x.newClaimIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ", "}
                            <Link href={`/deals/${slug}/evidence?claim=${id}`} className="font-mono hover:text-ink">
                              {id}
                            </Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

function refHref(slug: string, kind: string, ref: string) {
  if (kind === "CLAIM") return `/deals/${slug}/evidence?claim=${ref}`;
  if (kind === "SOURCE") return `/deals/${slug}/evidence?source=${ref}`;
  if (kind === "METRIC") return `/deals/${slug}/evidence?metric=${ref}`;
  return `/deals/${slug}/questions`;
}
