"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/formation", label: "Overview", match: (p: string) => p === "/formation" },
  { href: "/formation/practice", label: "Practice", match: (p: string) => p.startsWith("/formation/practice") || p.startsWith("/formation/review") },
  { href: "/formation/journal", label: "Journal", match: (p: string) => p.startsWith("/formation/journal") },
  { href: "/formation/mistakes", label: "Mistake library", match: (p: string) => p.startsWith("/formation/mistakes") },
];

export function FormationNav() {
  const path = usePathname();
  return (
    <nav className="no-print border-b border-line px-4 md:px-8">
      <div className="-mb-px flex gap-0.5 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cx("whitespace-nowrap border-b-2 px-2.5 py-2 text-[12.5px] transition-colors", t.match(path) ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
