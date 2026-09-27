"use client";

import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

export function CompanyPicker({ companies, selected }: { companies: { slug: string; name: string }[]; selected: string[] }) {
  const router = useRouter();
  const toggle = (slug: string) => {
    const next = selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug].slice(0, 10);
    router.push(`/compare${next.length ? `?ids=${next.join(",")}` : ""}`);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {companies.map((c) => (
        <button
          key={c.slug}
          onClick={() => toggle(c.slug)}
          className={cx("rounded-md border px-2.5 py-1 text-[12.5px] transition-colors", selected.includes(c.slug) ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong")}
        >
          {c.name}
        </button>
      ))}
      {companies.length === 0 && <span className="text-ink-3">No analyzed companies yet.</span>}
    </div>
  );
}
