"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

type Step = { step: string; label: string; status: string; detail?: string };

/** Live progress of a meeting run (transcription → extraction → post-meeting analysis → brief → memory). */
export function MeetingRun({ runId, initial }: { runId: string; initial: Step[] }) {
  const router = useRouter();
  const [steps, setSteps] = useState(initial);
  const [cost, setCost] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await fetch(`/api/runs/${runId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      if (r) {
        setSteps(r.progress);
        setCost(`$${Number(r.spentUsd).toFixed(4)}`);
        if (r.status !== "RUNNING" && r.status !== "QUEUED") return router.refresh();
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, router]);
  return (
    <div aria-live="polite">
      <ol className="space-y-1">
        {steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2 text-[12.5px]">
            <span className={cx("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", s.status === "DONE" && "bg-ok", s.status === "RUNNING" && "pulse-dot bg-accent", s.status === "PENDING" && "bg-line-strong", s.status === "SKIPPED" && "bg-ink-3", s.status === "FAILED" && "bg-risk")} />
            <span className={s.status === "PENDING" ? "text-ink-3" : "text-ink"}>
              {s.label}
              <span className="text-ink-3"> — {s.status === "PENDING" ? "waiting" : s.status.toLowerCase()}</span>
              {s.detail && <span className="text-ink-3">: {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {cost && <div className="num mt-1.5 text-[11.5px] text-ink-3">Spent so far {cost}</div>}
    </div>
  );
}
