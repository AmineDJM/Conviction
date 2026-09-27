"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { PrintButton } from "./print-button";

/**
 * Wraps a report sheet with a toolbar: Focus mode renders the sheet in a
 * full-screen overlay (hides app chrome); Print calls window.print().
 */
export function FocusFrame({ children, label, meta }: { children: ReactNode; label: string; meta?: ReactNode }) {
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocus(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [focus]);

  const toolbar = (
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="t-eyebrow">{label}</span>
        {meta}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant={focus ? "primary" : "secondary"} onClick={() => setFocus((f) => !f)} title={focus ? "Exit focus mode (Esc)" : "Hide app chrome"}>
          {focus ? "Exit focus" : "Focus mode"}
        </Button>
        <PrintButton />
      </div>
    </div>
  );

  if (focus)
    return (
      <div className="anim-in fixed inset-0 z-[60] overflow-y-auto bg-bg print:static print:overflow-visible" role="dialog" aria-label={`${label} — focus mode`}>
        <div className="mx-auto max-w-[1120px] px-4 py-6 sm:px-10 sm:py-8 print:p-0">
          {toolbar}
          {children}
        </div>
      </div>
    );

  return (
    <div>
      {toolbar}
      {children}
    </div>
  );
}
