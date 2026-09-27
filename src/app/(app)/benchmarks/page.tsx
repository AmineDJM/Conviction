import { requireSession } from "@/server/session";
import { listRegistries, ACTIVE_REGISTRY_ID } from "@/engine/benchmarks";
import { metricDef } from "@/engine/metrics/dictionary";
import { PROFILE_LABELS, STAGE_BAND_LABELS } from "@/engine/scoring/peer";
import { rubricLabel } from "@/engine/scoring/dimensions";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Callout, Section } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { RecalculateButton } from "@/components/benchmarks/recalculate-button";
import { getDb, schema } from "@/db/client";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";

export const metadata = { title: "Benchmarks" };

const TYPE_TONE = { OBSERVED_DISTRIBUTION: "ok", INVESTOR_TARGET: "accent", INTERNAL_POLICY: "neutral", MODEL_ASSUMPTION: "warn", UNAVAILABLE: "unknown" } as const;

function fmtCurveValue(key: string, v: number) {
  const unit = metricDef(key)?.unit ?? (key.includes("usd") ? "USD" : key.includes("pct") ? "PERCENT" : "");
  if (unit === "USD") return v >= 1e9 ? `$${v / 1e9}B` : v >= 1e6 ? `$${v / 1e6}M` : v >= 1e3 ? `$${v / 1e3}k` : `$${v}`;
  if (unit === "PERCENT") return `${v}%`;
  if (unit === "MONTHS") return `${v}mo`;
  if (unit === "DAYS") return `${v}d`;
  if (unit === "MULTIPLE" || unit === "RATIO") return `${v}×`;
  return String(v);
}

export default async function BenchmarksPage() {
  const s = await requireSession();
  const registries = listRegistries();
  const reg = registries.find((r) => r.id === ACTIVE_REGISTRY_ID)!;
  const recalcs = getDb()
    .select({ summary: schema.historyEvents.summary, at: schema.historyEvents.createdAt, companyId: schema.historyEvents.companyId, name: schema.companies.name, slug: schema.companies.slug })
    .from(schema.historyEvents)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.historyEvents.companyId))
    .where(and(eq(schema.historyEvents.workspaceId, s.workspaceId), eq(schema.historyEvents.type, "BENCHMARK_RECALCULATED")))
    .orderBy(desc(schema.historyEvents.createdAt))
    .limit(30)
    .all();

  return (
    <main className="pb-16">
      <PageHeader title="Benchmark registry" meta="The only authoritative scoring source. Every analysis stores the version it was scored under." actions={<RecalculateButton registryId={reg.id} />} />
      <div className="max-w-[1180px] space-y-12 px-8">
        <Section eyebrow="Versions">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Published</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 font-medium">Changelog</th>
              </tr>
            </thead>
            <tbody>
              {registries.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-2 pr-4 font-mono text-[12px]">
                    {r.id} {r.id === ACTIVE_REGISTRY_ID && <Badge tone="accent">Active</Badge>}
                  </td>
                  <td className="num py-2 pr-4 text-ink-2">{r.publishedAt}</td>
                  <td className="py-2 pr-4 text-ink-2">{r.description}</td>
                  <td className="py-2 text-ink-3">{r.changelog.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4">
            <Callout tone="warn" title="No observed distributions in this version">
              All metric curves are investor targets, internal policy or model assumptions. The product therefore shows no percentiles. To enable percentiles, publish a new registry version with an OBSERVED_DISTRIBUTION including population, sample size, period, geography, stage, business model, source, exclusions and selection bias — then recalculate the portfolio (old versions are preserved).
            </Callout>
          </div>
        </Section>

        <Section eyebrow="Metric benchmarks" title={`${reg.benchmarks.length} benchmarks`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  <th className="py-2 pr-3 font-medium">Id</th>
                  <th className="py-2 pr-3 font-medium">Metric</th>
                  <th className="py-2 pr-3 font-medium">Peer groups</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Thresholds (value → score)</th>
                  <th className="py-2 font-medium">Source / population</th>
                </tr>
              </thead>
              <tbody>
                {reg.benchmarks.map((b) => (
                  <tr key={b.id} id={b.id} className="scroll-mt-6 border-t border-line align-top target:bg-accent-soft/60">
                    <td className="py-2 pr-3 font-mono text-[11.5px]">{b.id}</td>
                    <td className="py-2 pr-3">{metricDef(b.metricKey)?.name ?? titleCase(b.metricKey)}</td>
                    <td className="py-2 pr-3 text-ink-2">
                      {b.profiles === "ALL" ? "All profiles" : b.profiles.map((p) => PROFILE_LABELS[p]).join(", ")}
                      <div className="text-ink-3">{b.stageBands === "ALL" ? "All stages" : b.stageBands.map((x) => STAGE_BAND_LABELS[x]).join(", ")}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={TYPE_TONE[b.type]}>{titleCase(b.type)}</Badge>
                    </td>
                    <td className="num py-2 pr-3 text-ink-2">{b.curve ? b.curve.map((p) => `${fmtCurveValue(b.metricKey, p.value)}→${p.score}`).join("  ") : "Not scored"}</td>
                    <td className="max-w-[340px] py-2 text-ink-3">
                      {b.provenance.source}
                      {b.provenance.sampleSize && <div>n = {b.provenance.sampleSize}, {b.provenance.population}, {b.provenance.period}</div>}
                      {b.provenance.selectionBias && <div className="mt-0.5">Bias: {b.provenance.selectionBias}</div>}
                      {b.notes && <div className="mt-0.5 text-ink-2">{b.notes}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section eyebrow="Dimensions & weights (internal policy)" title="Operating Quality Index composition">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  <th className="py-2 pr-3 font-medium">Dimension</th>
                  {(["EARLY", "GROWTH", "LATE"] as const).map((b) => (
                    <th key={b} className="py-2 pr-3 text-right font-medium">
                      {STAGE_BAND_LABELS[b]}
                    </th>
                  ))}
                  <th className="py-2 pr-3 text-right font-medium">Biotech</th>
                  <th className="py-2 font-medium">Components (default)</th>
                </tr>
              </thead>
              <tbody>
                {reg.dimensions.map((d) => (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 font-medium">{d.name}</td>
                    {(["EARLY", "GROWTH", "LATE"] as const).map((b) => (
                      <td key={b} className="num py-2 pr-3 text-right">
                        {Math.round(reg.dimensionWeights[b][d.id] * 100)}%
                      </td>
                    ))}
                    <td className="num py-2 pr-3 text-right">{Math.round((reg.dimensionWeightOverrides.BIOTECH_MEDTECH?.[d.id] ?? 0) * 100)}%</td>
                    <td className="py-2 text-ink-2">
                      {d.components
                        .map((c) => `${c.kind === "RUBRIC" ? rubricLabel(c.criterion) : c.kind === "METRIC" ? c.metricKeys.map((k) => metricDef(k)?.shortName ?? k).join(" / ") : c.kind === "MARKET_SIZE" ? "Reconstructed market" : "Founder capabilities"} ${Math.round(c.weight * 100)}%`)
                        .join(" · ")}
                      {d.profileOverrides && <div className="text-ink-3">Profile overrides: {Object.keys(d.profileOverrides).map((p) => PROFILE_LABELS[p as keyof typeof PROFILE_LABELS]).join(", ")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-ink-3">
            Weights are declared policy, not objective truth; they never change for a single deal. Rubric anchors (model assumption): {Object.entries(reg.rubricPoints).map(([k, v]) => `${titleCase(k)} ${v}`).join(" · ")}. Coverage: scored ≥ {reg.coverage.scoredMin * 100}%, partial ≥ {reg.coverage.partialMin * 100}%; inferred and stale evidence earn {reg.coverage.credit.INFERRED * 100}% credit, small samples ×{reg.coverage.credit.SMALL_SAMPLE_MULTIPLIER}.
          </p>
        </Section>

        <div className="grid gap-10 md:grid-cols-2">
          <Section eyebrow="Decision gates" title="Recommendation rules">
            <ul className="space-y-2 text-[13px]">
              {reg.decision.gates.map((g) => (
                <li key={g.id}>
                  <span className="font-mono text-[11.5px] text-ink-3">{g.id}</span>
                  <div className="text-ink-2">{g.description}</div>
                </li>
              ))}
            </ul>
          </Section>
          <Section eyebrow="Return model assumptions" title="Dilution, exits and plausibility">
            <ul className="space-y-1.5 text-[13px] text-ink-2">
              {Object.entries(reg.returns.futureRounds)
                .filter(([k]) => k !== "UNKNOWN")
                .map(([stage, rounds]) => (
                  <li key={stage}>
                    <span className="text-ink-3">{titleCase(stage)}:</span> {rounds.map((r) => `${r.name} ${r.dilutionPct}% @ ${r.stepUp}×`).join(", ")}
                  </li>
                ))}
              <li>
                <span className="text-ink-3">Default exits (× reference valuation):</span> {Object.entries(reg.returns.defaultExitMultipleOfPostMoney).map(([k, v]) => `${titleCase(k)} ${v}×`).join(", ")}
              </li>
              <li>
                <span className="text-ink-3">SAM-share plausibility:</span> plausible ≤ {reg.returns.samSharePlausibility.PLAUSIBLE}%, demanding ≤ {reg.returns.samSharePlausibility.DEMANDING}%, heroic ≤ {reg.returns.samSharePlausibility.HEROIC}%
              </li>
            </ul>
          </Section>
        </div>

        <Section eyebrow="Recalculation history" title="V-to-V score differences">
          {recalcs.length === 0 ? (
            <p className="text-ink-3">No recalculations yet.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line text-[13px]">
              {recalcs.map((r, i) => (
                <li key={i} className="flex justify-between gap-4 py-2">
                  <span>
                    <Link href={`/deals/${r.slug}/history`} className="font-medium hover:text-accent-text">
                      {r.name}
                    </Link>{" "}
                    <span className="text-ink-2">{r.summary}</span>
                  </span>
                  <span className="num shrink-0 text-ink-3">{r.at.slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
