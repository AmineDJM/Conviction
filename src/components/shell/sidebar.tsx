"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx, Kbd } from "@/components/ui";
import { useShell } from "./shell-context";

const NAV = [
  { href: "/", label: "Deals", match: (p: string) => p === "/" || p.startsWith("/deals") || p.startsWith("/analyze") },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p.startsWith("/portfolio") },
  { href: "/compare", label: "Compare", match: (p: string) => p.startsWith("/compare") },
  { href: "/ic", label: "IC", match: (p: string) => p.startsWith("/ic") },
  { href: "/benchmarks", label: "Benchmarks", match: (p: string) => p.startsWith("/benchmarks") },
  { href: "/fund", label: "Fund", match: (p: string) => p.startsWith("/fund") },
];

export function Sidebar({ workspace, user, logout }: { workspace: string; user: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const { setPaletteOpen, toggleBrain, brainOpen } = useShell();
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-[208px] shrink-0 flex-col border-r border-line bg-bg px-3 py-4 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-[13px] font-semibold tracking-tight">
        <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink text-[11px] text-bg">C</span>
        <span className="truncate">{workspace}</span>
      </Link>

      <button
        onClick={() => setPaletteOpen(true)}
        className="mb-4 flex h-8 items-center justify-between rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong"
      >
        Search
        <Kbd>⌘K</Kbd>
      </button>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx("rounded-md px-2 py-1.5 text-[13px] transition-colors", n.match(path) ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        <Link href="/analyze" className="flex h-8 items-center justify-center rounded-md bg-ink text-[12.5px] font-medium text-bg transition-opacity hover:opacity-90">
          Analyze company
        </Link>
      </div>

      <div className="mt-auto space-y-1">
        <button
          onClick={toggleBrain}
          className={cx("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition-colors", brainOpen ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:bg-surface-2")}
        >
          Fund Brain
          <Kbd>⌘J</Kbd>
        </button>
        <div className="flex items-center justify-between px-2 pt-2 text-[12px] text-ink-3">
          <span className="truncate">{user}</span>
          <form action={logout}>
            <button className="hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/** Mobile: compact top bar. The full analytics desktop is not recreated on phones (§109). */
export function MobileNav({ workspace }: { workspace: string }) {
  const path = usePathname();
  const { toggleBrain } = useShell();
  return (
    <div className="no-print sticky top-0 z-40 flex items-center gap-3 overflow-x-auto border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur md:hidden">
      <Link href="/" className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
        <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink text-[11px] text-bg">C</span>
        {workspace}
      </Link>
      {NAV.slice(0, 4).map((n) => (
        <Link key={n.href} href={n.href} className={cx("shrink-0 text-[13px]", n.match(path) ? "font-medium text-ink" : "text-ink-3")}>
          {n.label}
        </Link>
      ))}
      <button onClick={toggleBrain} className="ml-auto shrink-0 text-[13px] text-accent-text">
        Brain
      </button>
    </div>
  );
}
