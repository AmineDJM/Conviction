"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export const DEAL_TABS = [
  { seg: "", label: "Overview" },
  { seg: "quick", label: "Quick Memo" },
  { seg: "product", label: "Product" },
  { seg: "founders", label: "Founders" },
  { seg: "market", label: "Market" },
  { seg: "traction", label: "Traction" },
  { seg: "gtm", label: "GTM" },
  { seg: "economics", label: "Economics" },
  { seg: "competition", label: "Competition" },
  { seg: "returns", label: "Returns" },
  { seg: "risks", label: "Risks" },
  { seg: "evidence", label: "Evidence" },
  { seg: "questions", label: "Questions" },
  { seg: "memo", label: "Reports" },
  { seg: "history", label: "History" },
];

export function DealTabs({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/deals/${slug}`;
  const current = path === base ? "" : path.slice(base.length + 1).split("/")[0];
  return (
    <nav className="no-print border-t border-line px-6">
      <div className="-mb-px flex gap-0.5 overflow-x-auto">
        {DEAL_TABS.map((t) => (
          <Link
            key={t.seg}
            href={t.seg ? `${base}/${t.seg}` : base}
            className={cx(
              "whitespace-nowrap border-b-2 px-2.5 py-2 text-[12.5px] transition-colors",
              current === t.seg ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
