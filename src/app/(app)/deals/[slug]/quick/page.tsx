import Link from "next/link";
import { loadDeal } from "@/server/deal";
import { buildQuickMemo } from "@/reports/quick-memo";
import { coreMetrics } from "@/components/deal/metric";
import { QuickMemoSheet } from "@/components/deal/reports/quick-memo-sheet";
import { FocusFrame } from "@/components/deal/reports/focus-frame";
import { date } from "@/lib/format";

export default async function QuickMemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const q = buildQuickMemo(c, d, { country: company.country });
  const metrics = coreMetrics(c.metrics, 8);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <FocusFrame
        label="Quick memo"
        meta={
          <Link href={`/deals/${company.slug}/brief`} className="hover:text-ink">
            Founder call brief →
          </Link>
        }
      >
        <QuickMemoSheet
          q={q}
          metrics={metrics}
          footer={
            <>
              <span>
                {company.name} · Quick memo · v{version!.row.versionNo} · {date(version!.row.createdAt)} · <span className="font-mono">{version!.row.registryId}</span>
              </span>
              <span>Analytical view only — IC decision recorded separately. Indices are not probabilities.</span>
            </>
          }
        />
      </FocusFrame>
    </main>
  );
}
