import Link from "next/link";
import type { FounderCallChanges } from "@/reports/version-diff";
import { Badge } from "@/components/ui";
import { date, metricValue, type Tone } from "@/lib/format";
import { metricDef } from "@/engine/metrics/dictionary";
import { QUESTION_STATUS_TEXT, questionStatusTone } from "./labels";

function Group({ title, tone, items, slug, empty }: { title: string; tone: Tone; items: { id: string; text: string; note?: string }[]; slug: string; empty?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="num text-[12px] text-ink-3">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">{empty ?? "None"}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((x) => (
            <li key={x.id + x.text} className="text-[12.5px] leading-snug">
              <Link href={x.id.startsWith("Q-") ? `/deals/${slug}/questions#${x.id}` : x.id.startsWith("MET-") ? `/deals/${slug}/evidence?metric=${x.id}` : `/deals/${slug}/evidence?claim=${x.id}`} className="mr-1.5 rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
                {x.id}
              </Link>
              <span className="text-ink">{x.text}</span>
              {x.note && <span className="block pl-0 text-ink-3">{x.note}</span>}
            </li>
          ))}
          {items.length > 8 && <li className="text-[12px] text-ink-3">+{items.length - 8} more in the version comparison</li>}
        </ul>
      )}
    </div>
  );
}

export function WhatChanged({ changes, slug, versionNo, prevVersionNo, createdAt, modelSummary }: { changes: FounderCallChanges; slug: string; versionNo: number; prevVersionNo: number; createdAt: string; modelSummary: string | null }) {
  const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium text-ink">
          What changed after the founder call <span className="font-normal text-ink-3">· v{prevVersionNo} → v{versionNo} · {date(createdAt)}</span>
        </div>
        <Link href={`/deals/${slug}/history`} className="text-[12.5px] text-ink-3 hover:text-ink">
          Full version comparison →
        </Link>
      </div>
      {modelSummary && <p className="mb-4 max-w-[900px] text-[13px] leading-relaxed text-ink-2">{modelSummary}</p>}
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
        <Group title="New claims" tone="accent" slug={slug} items={changes.newClaims.map((c) => ({ id: c.id, text: clip(c.statement) }))} />
        <Group title="Confirmed" tone="ok" slug={slug} items={changes.confirmed.map((c) => ({ id: c.id, text: clip(c.statement), note: clip(c.note, 140) }))} />
        <Group title="Changed" tone="warn" slug={slug} items={changes.changed.map((c) => ({ id: c.id, text: clip(c.statement), note: clip(c.note, 140) }))} />
        <Group title="Contradicted" tone="risk" slug={slug} items={changes.contradicted.map((c) => ({ id: c.id, text: clip(c.statement), note: clip(c.note, 140) }))} />
        <Group title="Discussed, unresolved" tone="unknown" slug={slug} items={changes.unresolvedClaims.map((c) => ({ id: c.id, text: clip(c.statement), note: clip(c.note, 140) }))} />
        <Group title="Questions resolved" tone="ok" slug={slug} items={changes.questionsResolved.map((q) => ({ id: q.id, text: clip(q.question) }))} />
      </div>
      {changes.newMetrics.length > 0 && (
        <div className="mt-5 text-[12.5px]">
          <span className="text-ink-3">New metrics stated on the call: </span>
          {changes.newMetrics.map((m, i) => (
            <span key={m.to!.id}>
              {i > 0 && " · "}
              <Link href={`/deals/${slug}/evidence?metric=${m.to!.id}`} className="text-ink hover:text-accent-text">
                {metricDef(m.metricKey)?.shortName ?? m.label} {metricValue(m.unit, m.to!.value)}
              </Link>
            </span>
          ))}
        </div>
      )}
      <div className="mt-5 border-t border-line pt-3">
        <div className="mb-1.5 text-[12px] text-ink-3">Still unresolved after the call ({changes.stillUnresolved.length})</div>
        {changes.stillUnresolved.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {changes.stillUnresolved.map((q) => (
              <li key={q.id} className="flex items-center gap-1.5 text-[12.5px]">
                <Link href={`#${q.id}`} className="font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
                  {q.id}
                </Link>
                <Badge tone={questionStatusTone(q.to)}>{QUESTION_STATUS_TEXT[q.to]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">Every question is resolved.</p>
        )}
      </div>
    </div>
  );
}
