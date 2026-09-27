"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export function useSort<T, K extends string>(rows: T[], initial: SortState<K>, accessors: Record<K, (r: T) => string | number | null>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    const out = [...rows];
    out.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return sort.dir === "asc" ? c : -c;
    });
    return out;
  }, [rows, sort, accessors]);
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  return { sorted, sort, toggle };
}

/** Sticky, sortable header cell. The arrow is paired with aria-sort so direction is never conveyed by glyph alone. */
export function SortTh<K extends string>({ k, sort, onSort, children, className, align = "left" }: { k: K; sort: SortState<K>; onSort: (k: K) => void; children: ReactNode; className?: string; align?: "left" | "right" }) {
  const active = sort.key === k;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cx("sticky top-0 z-10 bg-surface px-3 py-2 text-[11.5px] font-medium text-ink-3 shadow-[inset_0_-1px_0_var(--line)]", align === "right" ? "text-right" : "text-left", className)}
    >
      <button type="button" onClick={() => onSort(k)} className={cx("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
        {children}
        <span aria-hidden className={cx("text-[9px]", active ? "opacity-100" : "opacity-0")}>
          {sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

export function PlainTh({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) {
  return <th className={cx("sticky top-0 z-10 bg-surface px-3 py-2 text-[11.5px] font-medium text-ink-3 shadow-[inset_0_-1px_0_var(--line)]", align === "right" ? "text-right" : "text-left", className)}>{children}</th>;
}

/** Bordered scroll container so sticky headers stay pinned inside long tables. */
export function TableFrame({ children, maxH = "max-h-[68vh]" }: { children: ReactNode; maxH?: string }) {
  return <div className={cx("overflow-auto rounded-lg border border-line bg-surface", maxH)}>{children}</div>;
}

export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink outline-none hover:border-line-strong focus-visible:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <svg className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-[260px] rounded-md border border-line bg-surface pl-7 pr-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 hover:border-line-strong focus-visible:border-accent"
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[12.5px] text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
      {label}
    </label>
  );
}
