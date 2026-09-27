"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

type Step = { step: string; label: string; status: string; at: string; detail?: string };

/** Meaningful progress (no fake loading): each step reflects a real pipeline stage. */
export function RunProgress({ runId, initial, hasVersion }: { runId: string; initial: Step[]; hasVersion: boolean }) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(initial);
  const [spent, setSpent] = useState<number | null>(null);
  const [versionSeen, setVersionSeen] = useState(hasVersion);
  const [status, setStatus] = useState<string>("RUNNING");
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    setCancelling(true);
    const r = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => null);
    if (!r?.ok) setCancelling(false);
  }

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await fetch(`/api/runs/${runId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive || !r) return;
      setSteps(r.progress);
      setSpent(r.spentUsd);
      setStatus(r.status);
      if (r.hasVersion && !versionSeen) {
        setVersionSeen(true);
        router.refresh(); // preliminary understanding is available
      }
      if (r.status !== "RUNNING" && r.status !== "QUEUED") {
        router.refresh();
        return;
      }
      setTimeout(tick, 1500);
    };
    const t = setTimeout(tick, 1000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [runId, router, versionSeen]);

  const done = steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED" || s.status === "FAILED").length;
  return (
    <div className="no-print border-b border-line bg-surface px-8 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[13px] font-medium">
          {hasVersion ? "Analysis in progress — showing preliminary understanding" : "Analyzing"}
        </div>
        <div className="flex items-baseline gap-4">
          <div className="num text-[12px] text-ink-3">
            {status === "QUEUED" ? "Queued — waiting for a free analysis slot" : `${done}/${steps.length} steps`}
            {spent !== null ? ` · $${spent.toFixed(3)} spent` : ""}
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling}
            className="text-[12px] text-ink-3 underline-offset-2 hover:text-risk hover:underline disabled:opacity-50"
            title="Stop the analysis. Work already done is kept as a partial version."
          >
            {cancelling ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>
      <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2 text-[12.5px]">
            <span
              className={cx(
                "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
                s.status === "DONE" && "bg-ok",
                s.status === "RUNNING" && "pulse-dot bg-accent",
                s.status === "PENDING" && "bg-line-strong",
                s.status === "SKIPPED" && "bg-warn",
                s.status === "FAILED" && "bg-risk",
              )}
            />
            <span className={cx(s.status === "PENDING" ? "text-ink-3" : "text-ink")}>
              {s.label}
              {s.detail && <span className="text-ink-3"> — {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
