import { loadDeal } from "@/server/deal";
import { Badge, Bullets, Callout, Section, Td, Th } from "@/components/ui";
import { RichText } from "@/components/deal/rich-text";
import {
  CLASS_LABEL,
  CONDITION_TONE,
  CategoryCoverage,
  FALSIFIER_LABEL,
  FALSIFIER_TONE,
  LevelBadge,
  RepairTable,
  RiskGrid,
  RiskMatrix,
  RISK_CATEGORY_LABEL,
} from "@/components/deal/risks/risk-views";
import { levelTone, titleCase } from "@/lib/format";
import { FALSIFIER_STATUS } from "@/domain/enums";

export default async function RisksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const s = company.slug;
  const profile = d.risk;
  const killers = profile.thesisKillers;
  const falsifiers = c.falsification.flatMap((f) => f.falsifiers);

  return (
    <main className="mx-auto max-w-[1180px] space-y-12 px-4 py-8 sm:px-8">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 md:grid-cols-5">
        <Fig k="Risks identified" v={String(c.risks.length)} />
        <div>
          <div className="text-[12px] text-ink-3">Headline severity</div>
          <div className="mt-1">{profile.headline ? <Badge tone={levelTone(profile.headline)} dot>{titleCase(profile.headline)}</Badge> : <span className="text-ink-3">—</span>}</div>
          <div className="mt-1 text-[11.5px] text-ink-3">Highest severity at moderate+ likelihood</div>
        </div>
        <Fig k="Thesis-killing" v={String(killers.length)} tone={killers.length ? "risk" : undefined} />
        <Fig k="Structural · repairable" v={`${profile.structural.length} · ${profile.repairable.length}`} />
        <div>
          <div className="text-[12px] text-ink-3">Risk filter index</div>
          <div className="num text-[17px] font-semibold tracking-tight">{profile.filterIndex}</div>
          <div className="text-[11.5px] text-ink-3">For sorting deals only — not a probability</div>
        </div>
      </div>

      {/* Thesis killers */}
      <Section eyebrow="Thesis killers" title={killers.length ? `${killers.length} risk${killers.length > 1 ? "s" : ""} could end the thesis outright` : "No thesis-killing risk identified"}>
        {killers.length ? (
          <div className="space-y-3">
            {killers.map((r) => (
              <div key={r.id} className="rounded-lg border border-risk/30 bg-risk-soft/50 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`#${r.id}`} className="font-mono text-[11px] text-ink-3 hover:text-accent-text">
                    {r.id}
                  </a>
                  <span className="text-[15px] font-semibold text-ink">{r.title}</span>
                  <Badge tone="risk">Thesis-killing</Badge>
                  <LevelBadge level={r.severity} kind="S" />
                  <LevelBadge level={r.likelihood} kind="L" />
                  <span className="text-[12px] text-ink-3">{RISK_CATEGORY_LABEL[r.category]}</span>
                </div>
                <p className="mt-2 text-ink-2">
                  <RichText text={r.description} slug={s} />
                </p>
                <div className="mt-3 grid gap-4 text-[13px] md:grid-cols-3">
                  <div>
                    <div className="t-eyebrow mb-1">Evidence</div>
                    <p className="text-ink-2">
                      <RichText text={r.evidence} slug={s} />
                    </p>
                  </div>
                  <div>
                    <div className="t-eyebrow mb-1">How to test / mitigate</div>
                    <p className="text-ink-2">
                      <RichText text={r.mitigation} slug={s} />
                    </p>
                  </div>
                  <div>
                    <div className="t-eyebrow mb-1">Resolution effort</div>
                    <p className="text-ink-2">{r.repair ? `${r.repair.resources} · ${r.repair.time} · ${titleCase(r.repair.difficulty)} difficulty` : "Not specified"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink-3">None of the {c.risks.length} identified risks is classed as thesis-killing. Structural risks below still limit the outcome.</p>
        )}
      </Section>

      {/* Grid + coverage */}
      <div className="grid gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Section eyebrow="Severity × likelihood" title="Where the risks sit">
          <RiskGrid risks={c.risks} />
        </Section>
        <Section eyebrow="Coverage by category" title="What has and has not been flagged">
          <CategoryCoverage profile={profile} />
        </Section>
      </div>

      {/* Matrix */}
      <Section eyebrow="Risk matrix" title="Every identified risk, by category">
        {c.risks.length ? <RiskMatrix risks={c.risks} slug={s} /> : <p className="text-ink-3">No risks were recorded in this version.</p>}
      </Section>

      {/* Weakness classes */}
      <div className="space-y-10">
        <Section eyebrow="Repairable weaknesses" title="What it would take to fix them">
          {profile.repairable.length ? <RepairTable risks={profile.repairable} slug={s} /> : <p className="text-ink-3">No repairable weaknesses recorded.</p>}
        </Section>
        <Section eyebrow="Structural weaknesses" title="Limits effort does not remove">
          {profile.structural.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {profile.structural.map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-baseline gap-2">
                    <a href={`#${r.id}`} className="font-mono text-[10.5px] text-ink-3 hover:text-accent-text">
                      {r.id}
                    </a>
                    <span className="font-medium text-ink">{r.title}</span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">
                    <RichText text={r.mitigation} slug={s} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-3">No structural weaknesses recorded.</p>
          )}
          <p className="mt-2 text-[12px] text-ink-3">
            Classes: {Object.values(CLASS_LABEL).join(" · ")}. Repairable = fixable with capital, hiring or time; structural = persists at scale; thesis-killing = if true, no price works.
          </p>
        </Section>
      </div>

      {/* Required conditions */}
      <Section eyebrow="Required conditions" title="What must be true for the thesis to hold">
        {c.thesis?.requiredConditions.length ? (
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr>
                  <Th className="w-[34%]">Condition</Th>
                  <Th>Current evidence</Th>
                  <Th className="w-[160px]">Status</Th>
                </tr>
              </thead>
              <tbody>
                {c.thesis.requiredConditions.map((rc, i) => (
                  <tr key={i}>
                    <Td className="font-medium text-ink">{rc.condition}</Td>
                    <Td className="text-[12.5px] text-ink-2">
                      <RichText text={rc.currentEvidence} slug={s} />
                    </Td>
                    <Td>
                      <Badge tone={CONDITION_TONE[rc.status]} dot>
                        {titleCase(rc.status)}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-3">No thesis conditions in this version.</p>
        )}
      </Section>

      {/* Falsification */}
      <Section
        eyebrow="Falsification engine"
        title="What would prove the thesis wrong — and have we looked?"
        action={
          falsifiers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {FALSIFIER_STATUS.map((st) => {
                const n = falsifiers.filter((f) => f.status === st).length;
                return n ? (
                  <Badge key={st} tone={FALSIFIER_TONE[st]}>
                    {FALSIFIER_LABEL[st]} · {n}
                  </Badge>
                ) : null;
              })}
            </div>
          )
        }
      >
        {c.falsification.length ? (
          <div className="space-y-6">
            {c.falsification.map((f, i) => (
              <div key={i}>
                <div className="mb-1 flex gap-2">
                  <span className="num text-[12px] text-ink-3">T{i + 1}</span>
                  <h3 className="font-medium text-ink">
                    <RichText text={f.thesis} slug={s} />
                  </h3>
                </div>
                <div className="-mx-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[13px]">
                    <tbody>
                      {f.falsifiers.map((x, j) => (
                        <tr key={j}>
                          <Td className="w-[44%] text-ink">{x.falsifier}</Td>
                          <Td className="w-[170px]">
                            <Badge tone={FALSIFIER_TONE[x.status]} dot>
                              {FALSIFIER_LABEL[x.status]}
                            </Badge>
                          </Td>
                          <Td className="text-[12.5px] text-ink-2">
                            <RichText text={x.evidence} slug={s} />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink-3">No falsification tests in this version.</p>
        )}
      </Section>

      {/* Red team */}
      <Section eyebrow="Symmetric red team" title="The case against investing, and the case against passing">
        {c.redTeam ? (
          <>
            <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
              <div className="bg-bg px-5 py-4">
                <div className="t-eyebrow mb-2">Case against investing</div>
                <Bullets items={c.redTeam.caseAgainstInvesting.map((t, i) => <RichText key={i} text={t} slug={s} />)} tone="risk" />
              </div>
              <div className="bg-bg px-5 py-4">
                <div className="t-eyebrow mb-2">Case against passing</div>
                <Bullets items={c.redTeam.caseAgainstPassing.map((t, i) => <RichText key={i} text={t} slug={s} />)} tone="ok" />
              </div>
            </div>
            <div className="mt-4">
              <Callout tone="neutral" title="Pass-regret scenario — if we pass and this becomes a category winner, what did we miss?">
                <RichText text={c.redTeam.passRegretScenario} slug={s} />
              </Callout>
            </div>
          </>
        ) : (
          <p className="text-ink-3">No red-team analysis in this version.</p>
        )}
      </Section>

      {/* Nonlinear */}
      <Section
        eyebrow="Nonlinear outcome analysis"
        title="Could this be disproportionately large?"
        action={
          c.nonlinear && (
            <Badge tone={c.nonlinear.outlierPlausible ? "ok" : "unknown"} dot>
              Outlier path {c.nonlinear.outlierPlausible ? "plausible" : "not plausible on current evidence"}
            </Badge>
          )
        }
      >
        {c.nonlinear ? (
          <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
            <Block k="Why it could be disproportionate" v={c.nonlinear.whyDisproportionate} slug={s} />
            <Block k="Mechanism" v={c.nonlinear.mechanism} slug={s} />
            <Block k="Why the market may underestimate it" v={c.nonlinear.whyUnderestimated} slug={s} />
            <Block k="Outlier rationale" v={c.nonlinear.outlierRationale} slug={s} />
            {c.nonlinear.compoundingAssumptions.length > 0 && (
              <div className="md:col-span-2">
                <div className="t-eyebrow mb-2">Compounding assumptions — each must hold</div>
                <ol className="grid gap-x-10 gap-y-1.5 text-[13px] text-ink-2 md:grid-cols-2">
                  {c.nonlinear.compoundingAssumptions.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="num w-4 shrink-0 text-ink-3">{i + 1}</span>
                      <span>
                        <RichText text={a} slug={s} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <p className="text-ink-3">No nonlinear analysis in this version.</p>
        )}
      </Section>
    </main>
  );
}

function Fig({ k, v, tone }: { k: string; v: string; tone?: "risk" }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{k}</div>
      <div className={`num text-[17px] font-semibold tracking-tight ${tone === "risk" ? "text-risk" : "text-ink"}`}>{v}</div>
    </div>
  );
}

function Block({ k, v, slug }: { k: string; v: string; slug: string }) {
  return (
    <div>
      <div className="t-eyebrow mb-1">{k}</div>
      <p className="text-ink-2">
        <RichText text={v} slug={slug} />
      </p>
    </div>
  );
}
