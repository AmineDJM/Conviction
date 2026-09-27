import type { CompetitionSection } from "@/domain/sections";
import { loadDeal } from "@/server/deal";
import { Badge, Section, Td, Th, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { DimensionDetail, Prose, Quiet, TabMain, TableFrame } from "@/components/deal/tabs/shared";

const TYPE: Record<string, { text: string; tone: Tone }> = {
  DIRECT: { text: "Direct", tone: "warn" },
  INCUMBENT: { text: "Incumbent", tone: "warn" },
  INDIRECT: { text: "Indirect", tone: "neutral" },
  INTERNAL_SOLUTION: { text: "Internal solution", tone: "neutral" },
  DO_NOTHING: { text: "Do nothing", tone: "unknown" },
  EMERGING: { text: "Emerging", tone: "accent" },
};

const TEST: Record<string, { name: string; question: string }> = {
  INCUMBENT_COPY: { name: "Incumbent copy", question: "What if the largest incumbent builds this?" },
  COST_COMMODITIZATION: { name: "Cost commoditization", question: "What if the core capability becomes 10× cheaper for everyone?" },
  DISTRIBUTION: { name: "Distribution", question: "What if a weaker product has better distribution?" },
};

const VERDICT: Record<string, { text: string; tone: Tone }> = {
  SURVIVES: { text: "Survives", tone: "ok" },
  WEAKENED: { text: "Weakened", tone: "warn" },
  FAILS: { text: "Fails", tone: "risk" },
  UNCLEAR: { text: "Unclear", tone: "unknown" },
};

const STRENGTHS = ["NONE", "EMERGING", "MODERATE", "STRONG"] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Strength({ s }: { s: string }) {
  const i = STRENGTHS.indexOf(s as (typeof STRENGTHS)[number]);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-[2px]" aria-hidden>
        {[1, 2, 3].map((k) => (
          <span key={k} className={cx("h-2 w-2.5 rounded-[2px]", i >= k ? "bg-ink-2" : "bg-surface-3")} />
        ))}
      </span>
      <span className={cx("text-[12.5px]", i <= 0 ? "text-ink-3" : "text-ink")}>{titleCase(s)}</span>
    </span>
  );
}

/**
 * Builds the comparison matrix. The model sometimes puts the company name in
 * `company` and the company's actual value inside `competitorValues` under its
 * own name — both shapes are handled. Competitors named in at least half the
 * rows become columns; the rest fold into an "Other" column so one-off names
 * do not create mostly-empty columns. If no stable columns exist, the page
 * falls back to a row layout.
 */
function buildMatrix(comp: CompetitionSection, companyName: string) {
  const self = norm(companyName);
  const seen = new Map<string, { name: string; rows: number }>();
  for (const r of comp.comparison)
    for (const v of r.competitorValues) {
      const k = norm(v.competitor);
      if (k === self) continue;
      const e = seen.get(k) ?? { name: v.competitor, rows: 0 };
      e.rows += 1;
      seen.set(k, e);
    }
  const threshold = Math.max(2, Math.ceil(comp.comparison.length / 2));
  const columns = [...seen.values()].filter((e) => e.rows >= threshold).map((e) => e.name);
  const colKeys = new Set(columns.map(norm));
  const rows = comp.comparison.map((r) => {
    const own = r.competitorValues.find((v) => norm(v.competitor) === self)?.value ?? (norm(r.company) === self ? null : r.company);
    const cells = columns.map((col) => r.competitorValues.find((v) => norm(v.competitor) === norm(col))?.value ?? null);
    const pairs = r.competitorValues.filter((v) => norm(v.competitor) !== self);
    const other = pairs.filter((v) => !colKeys.has(norm(v.competitor)));
    return { dimension: r.dimension, own, cells, pairs, other };
  });
  const hasOther = rows.some((r) => r.other.length > 0);
  return { columns, rows, hasOther, dense: columns.length >= 2 && columns.length <= 5 };
}

export default async function CompetitionTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const comp = c.competition;
  const name = c.identity.name;
  const matrix = comp ? buildMatrix(comp, name) : null;
  const tests = comp ? ["INCUMBENT_COPY", "COST_COMMODITIZATION", "DISTRIBUTION"].map((t) => ({ t, x: comp.adversarialTests.find((a) => a.test === t) ?? null })) : [];

  return (
    <TabMain>
      {/* Competitors */}
      <Section eyebrow="Competitive landscape" title={comp ? `${comp.competitors.length} alternatives a buyer could choose instead` : "Competition not yet analyzed"}>
        {comp && comp.competitors.length ? (
          <TableFrame minWidth={900}>
            <thead>
              <tr>
                <Th className="w-[190px]">Competitor</Th>
                <Th className="w-[130px]">Type</Th>
                <Th>Description</Th>
                <Th className="w-[260px]">Scale</Th>
                <Th className="w-[150px]">Link</Th>
              </tr>
            </thead>
            <tbody>
              {comp.competitors.map((x) => {
                const t = TYPE[x.type] ?? { text: titleCase(x.type), tone: "neutral" as Tone };
                return (
                  <tr key={x.name}>
                    <Td className="font-medium text-ink">{x.name}</Td>
                    <Td>
                      <Badge tone={t.tone}>{t.text}</Badge>
                    </Td>
                    <Td className="text-[12.5px] text-ink-2">
                      <Prose text={x.description} slug={slug} />
                    </Td>
                    <Td className="text-[12.5px] text-ink-2">{x.scale ? <Prose text={x.scale} slug={slug} /> : <span className="text-ink-3">Not established</span>}</Td>
                    <Td className="text-[12px]">
                      {x.url ? (
                        <a href={x.url} target="_blank" rel="noreferrer noopener" className="text-ink-3 hover:text-accent-text">
                          {host(x.url)} ↗
                        </a>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        ) : (
          <Quiet>{comp ? "No competitors were identified — treat as a gap, not as an absence of competition." : "The competition section was not produced in this analysis."}</Quiet>
        )}
      </Section>

      {/* Comparison */}
      {comp && matrix && (
        <Section eyebrow="Comparison" title={`${name} against the alternatives, dimension by dimension`}>
          {matrix.rows.length === 0 ? (
            <Quiet>No comparison was produced.</Quiet>
          ) : matrix.dense ? (
            <TableFrame minWidth={160 + 150 * (matrix.columns.length + 1 + (matrix.hasOther ? 1 : 0))}>
              <thead>
                <tr>
                  <Th className="w-[150px]">Dimension</Th>
                  <Th className="bg-surface-2 text-ink">{name}</Th>
                  {matrix.columns.map((col) => (
                    <Th key={col}>{col}</Th>
                  ))}
                  {matrix.hasOther && <Th>Other</Th>}
                </tr>
              </thead>
              <tbody className="text-[12.5px]">
                {matrix.rows.map((r) => (
                  <tr key={r.dimension}>
                    <Td className="font-medium text-ink">{r.dimension}</Td>
                    <Td className="bg-surface-2/60 text-ink">{r.own ? <Prose text={r.own} slug={slug} /> : <span className="text-ink-3">Not stated</span>}</Td>
                    {r.cells.map((v, i) => (
                      <Td key={i} className="text-ink-2">
                        {v ? <Prose text={v} slug={slug} /> : <span className="text-ink-3">—</span>}
                      </Td>
                    ))}
                    {matrix.hasOther && (
                      <Td className="text-ink-2">
                        {r.other.length ? (
                          r.other.map((o) => (
                            <div key={o.competitor} className="mb-1 last:mb-0">
                              <span className="text-ink-3">{o.competitor}: </span>
                              <Prose text={o.value} slug={slug} />
                            </div>
                          ))
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          ) : (
            // Sparse comparisons (each dimension names different competitors) read better as rows than as a mostly-empty grid.
            <TableFrame minWidth={860}>
              <thead>
                <tr>
                  <Th className="w-[170px]">Dimension</Th>
                  <Th className="w-[34%] bg-surface-2 text-ink">{name}</Th>
                  <Th>Alternatives</Th>
                </tr>
              </thead>
              <tbody className="text-[12.5px]">
                {matrix.rows.map((r) => (
                  <tr key={r.dimension}>
                    <Td className="font-medium text-ink">{r.dimension}</Td>
                    <Td className="bg-surface-2/60 text-ink">{r.own ? <Prose text={r.own} slug={slug} /> : <span className="text-ink-3">Not stated</span>}</Td>
                    <Td>
                      <dl className="space-y-1">
                        {r.pairs.map((p) => (
                          <div key={p.competitor} className="grid grid-cols-[150px_1fr] gap-3">
                            <dt className="text-ink-3">{p.competitor}</dt>
                            <dd className="text-ink-2">
                              <Prose text={p.value} slug={slug} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </Section>
      )}

      {/* Adversarial tests */}
      {comp && (
        <Section eyebrow="Adversarial tests" title="Does the position survive the obvious attacks?">
          <TableFrame minWidth={900}>
            <thead>
              <tr>
                <Th className="w-[200px]">Test</Th>
                <Th>Scenario</Th>
                <Th>Outcome · interpretation</Th>
                <Th className="w-[110px]">Verdict</Th>
              </tr>
            </thead>
            <tbody>
              {tests.map(({ t, x }) => {
                const v = x ? VERDICT[x.verdict] ?? { text: titleCase(x.verdict), tone: "unknown" as Tone } : null;
                return (
                  <tr key={t}>
                    <Td>
                      <div className="font-medium text-ink">{TEST[t]?.name ?? titleCase(t)}</div>
                      <div className="text-[11.5px] text-ink-3">{TEST[t]?.question}</div>
                    </Td>
                    <Td className="text-[12.5px] text-ink-2">{x ? <Prose text={x.scenario} slug={slug} /> : <span className="text-ink-3">Not run</span>}</Td>
                    <Td className="text-[12.5px] text-ink-2">{x ? <Prose text={x.outcome} slug={slug} /> : <span className="text-ink-3">—</span>}</Td>
                    <Td>{v ? <Badge tone={v.tone} dot>{v.text}</Badge> : <Badge tone="unknown">Not run</Badge>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        </Section>
      )}

      {/* Moat dynamics */}
      <Section eyebrow="Moat dynamics" title="Defensibility today, and what it could become in three years">
        {c.moat.length ? (
          <TableFrame minWidth={980}>
            <thead>
              <tr>
                <Th className="w-[170px]">Dimension</Th>
                <Th className="w-[130px]">Today</Th>
                <Th className="w-[160px]">In 3 years</Th>
                <Th>What must happen</Th>
                <Th>Evidence</Th>
              </tr>
            </thead>
            <tbody>
              {[...c.moat]
                .sort((a, b) => STRENGTHS.indexOf(b.in3Years) - STRENGTHS.indexOf(a.in3Years) || STRENGTHS.indexOf(b.current) - STRENGTHS.indexOf(a.current))
                .map((mo) => {
                  const delta = STRENGTHS.indexOf(mo.in3Years) - STRENGTHS.indexOf(mo.current);
                  return (
                    <tr key={mo.dimension}>
                      <Td className="font-medium text-ink">{titleCase(mo.dimension)}</Td>
                      <Td>
                        <Strength s={mo.current} />
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <Strength s={mo.in3Years} />
                          {delta !== 0 && (
                            <span className={cx("text-[12px]", delta > 0 ? "text-ok" : "text-risk")} title={delta > 0 ? "Strengthening" : "Weakening"}>
                              {delta > 0 ? "↑" : "↓"}
                              <span className="sr-only">{delta > 0 ? "strengthening" : "weakening"}</span>
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td className="text-[12.5px] text-ink-2">
                        <Prose text={mo.whatMustHappen} slug={slug} />
                      </Td>
                      <Td className="text-[12.5px] text-ink-3">
                        <Prose text={mo.evidence} slug={slug} />
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </TableFrame>
        ) : (
          <Quiet>No moat analysis was produced.</Quiet>
        )}
        {c.moat.length > 0 && <p className="mt-2 text-[11.5px] text-ink-3">Three-year strengths are conditional on the “what must happen” column — they are hypotheses, not forecasts.</p>}
      </Section>

      <Section eyebrow="Operating quality" title="Moat dimension">
        <DimensionDetail d={d} id="MOAT" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
