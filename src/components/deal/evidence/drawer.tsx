"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Right-side detail drawer. Fixed, no backdrop (the table behind stays
 * usable so another row can be picked), Esc closes.
 */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  meta,
  onBack,
  backLabel,
  children,
  footer,
  label,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title?: ReactNode;
  meta?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      // Esc inside a text field first blurs it; a second Esc closes.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") && panel.current?.contains(t)) {
        t.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panel.current?.scrollTo({ top: 0 });
  }, [open, title]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={label}
      aria-hidden={!open}
      className={cx(
        "no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-[100vw] flex-col sm:w-[520px] border-l border-line bg-surface shadow-[var(--shadow-pop)] transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
        <div className="min-w-0">
          {onBack && (
            <button type="button" onClick={onBack} className="mb-1.5 text-[12px] text-ink-3 hover:text-ink">
              ← {backLabel ?? "Back"}
            </button>
          )}
          {eyebrow && <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">{eyebrow}</div>}
          {title && <h2 className="text-[15px] font-semibold leading-snug text-ink">{title}</h2>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        <button type="button" onClick={onClose} className="-mr-1 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
          <kbd className="rounded border border-line px-1 font-mono text-[10px]">Esc</kbd>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div ref={panel} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {children}
      </div>
      {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
    </aside>
  );
}

export function DrawerSection({ title, children, className, aside }: { title: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={cx("mb-5", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="t-eyebrow">{title}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}
