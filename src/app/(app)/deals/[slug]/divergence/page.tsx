import { loadDeal } from "@/server/deal";
import { divergenceReport } from "@/engine/divergence";
import { DivergenceHeader, FactorSection } from "@/components/deal/divergence/factor";

export const metadata = { title: "Divergence" };

export default async function DivergencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version, registry } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version.canonical;
  const d = version.derived;
  // Versions derived before the engine existed: compute on view (pure, < 20 ms) — nothing is stored or estimated beyond the record.
  const stored = d.divergence ?? null;
  const r = stored ?? divergenceReport(c, registry, d.peerGroup, { market: d.market ?? null, financing: d.financing ?? null, economics: d.economics ?? null, latent: d.latent ?? null });
  const docId = c.documents[0]?.id ?? null;

  return (
    <main className="mx-auto max-w-[1180px] space-y-10 px-4 py-8 sm:px-8">
      <DivergenceHeader r={r} computedOnView={!stored} />
      <div className="space-y-10">
        {r.factors.map((f) => (
          <FactorSection key={f.id} f={f} slug={company.slug} docId={docId} />
        ))}
      </div>
      <section className="border-t border-line pt-6">
        <div className="t-eyebrow mb-2">Engine assumptions · {r.assumptionsVersion}</div>
        <dl className="divide-y divide-line border-y border-line text-[12px]">
          {r.assumptions.map((a) => (
            <div key={a.id} className="grid gap-2 py-1.5 sm:grid-cols-[260px_1fr_120px]">
              <dt className="text-ink-2">{a.label}</dt>
              <dd className="text-ink-3">{a.value}</dd>
              <dd className="text-[11px] text-ink-3 sm:text-right">{a.kind === "MODEL_ASSUMPTION" ? "Model assumption" : "Registry"}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
