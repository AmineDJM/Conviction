import type { ReactNode } from "react";

/** Standard page header for top-level screens. */
export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-8 pt-8 pb-5">
      <div>
        <h1 className="t-display">{title}</h1>
        {meta && <div className="mt-1 text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
