/**
 * Core UI primitives. Deliberately small: typography and alignment do most
 * of the work; containers are used sparingly.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  accent: "bg-accent-soft text-accent-text ring-accent/15",
  ok: "bg-ok-soft text-ok ring-ok/15",
  warn: "bg-warn-soft text-warn ring-warn/15",
  risk: "bg-risk-soft text-risk ring-risk/15",
  unknown: "bg-unknown-soft text-unknown ring-line",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  risk: "bg-risk",
  unknown: "bg-unknown",
};

/** Quiet badge. Color is never the only signal: the label carries the meaning. */
export function Badge({ tone = "neutral", children, dot, title, className }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string; className?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-[5px] px-1.5 py-[1px] text-[11.5px] font-medium ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={cx("inline-block h-1.5 w-1.5 rounded-full", DOT[tone])} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface px-1 font-mono text-[10.5px] text-ink-3">{children}</kbd>;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  href,
  type = "button",
  onClick,
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const cls = cx(
    "inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
    variant === "primary" && "bg-ink text-bg hover:bg-ink/85",
    variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
    variant === "danger" && "border border-risk/30 bg-surface text-risk hover:bg-risk-soft",
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls} title={title}>
        {children}
      </Link>
    );
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} title={title}>
      {children}
    </button>
  );
}

export function Section({ title, eyebrow, action, children, className, id }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("scroll-mt-28", className)}>
      {(title || eyebrow || action) && (
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            {eyebrow && <div className="t-eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="t-section">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx("h-px bg-line", className)} />;
}

/** Horizontal indicator — restrained alternative to gauges. Shows bounds when provided. */
export function IndexBar({ value, lower, upper, width = 96 }: { value: number | null; lower?: number; upper?: number; width?: number }) {
  return (
    <div className="relative h-1.5 rounded-full bg-surface-3" style={{ width }} aria-hidden>
      {lower !== undefined && upper !== undefined && (
        <div className="absolute inset-y-0 rounded-full bg-line-strong/70" style={{ left: `${lower}%`, width: `${Math.max(0, upper - lower)}%` }} />
      )}
      {value !== null && <div className="absolute -top-[2px] h-2.5 w-[3px] rounded-full bg-ink" style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 1.5px)` }} />}
    </div>
  );
}

export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cx("grid grid-cols-[minmax(120px,32%)_1fr] gap-3 py-1.5", className)}>
      <div className="text-ink-3">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line px-5 py-6">
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="max-w-xl text-ink-3">{children}</div>}
      {action}
    </div>
  );
}

export function Bullets({ items, tone }: { items: ReactNode[]; tone?: Tone }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={cx("mt-[8px] h-1 w-1 shrink-0 rounded-full", tone ? DOT[tone] : "bg-ink-3")} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Callout({ tone = "neutral", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  const border = { neutral: "border-line", accent: "border-accent/30", ok: "border-ok/30", warn: "border-warn/30", risk: "border-risk/30", unknown: "border-line" }[tone];
  const bg = { neutral: "bg-surface", accent: "bg-accent-soft/60", ok: "bg-ok-soft/60", warn: "bg-warn-soft/60", risk: "bg-risk-soft/60", unknown: "bg-surface-2" }[tone];
  return (
    <div className={cx("rounded-lg border px-4 py-3", border, bg)}>
      {title && <div className="mb-1 font-medium text-ink">{title}</div>}
      <div className="text-ink-2">{children}</div>
    </div>
  );
}

export function Th({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) {
  return <th className={cx("sticky top-0 z-10 bg-bg px-3 py-2 text-[11.5px] font-medium text-ink-3", align === "right" ? "text-right" : "text-left", className)}>{children}</th>;
}

export function Td({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) {
  return <td className={cx("border-t border-line px-3 py-2 align-top", align === "right" && "num text-right", className)}>{children}</td>;
}
