import Link from "next/link";
import type { MetricInstance } from "@/domain/canonical";
import { metricDef, type MetricDefinition } from "@/engine/metrics/dictionary";
import { loadDeal } from "@/server/deal";
import { Badge, Section, Td, Th, cx } from "@/components/ui";
import { metricValue, titleCase } from "@/lib/format";
import { isOverridden, isOverridePropagated } from "@/engine/override-marks";
import { metricEvidence } from "@/components/deal/metric";
import { CausalModelView } from "@/components/deal/causal-model";
import { DimensionDetail, FlagList, Layers, Prose, Quiet, TabMain, TableFrame, instancesOf, periodText, primaryOf } from "@/components/deal/tabs/shared";

const ECONOMICS = [
  "cac",
  "cac_payback_months",
  "gross_margin",
  "contribution_margin",
  "monthly_net_burn",
  "burn_multiple",
  "ltv_to_cac",
  "runway_months",
  "revenue_per_employee",
];

/** Inputs that the economics metrics are derived from — shown compactly for traceability. */
const INPUTS = ["acv", "ltv", "cash_balance", "headcount", "magic_number", "arpu_monthly"];

const METHOD_TEXT: Record<string, string> = { REPORTED: "Reported by company", DERIVED: "Derived by code", USER_CORRECTED: "Analyst override (legacy correction)" };
const methodLabel = (m: MetricInstance) => (isOverridden(m) ? "Analyst override" : isOverridePropagated(m) ? "Derived by code · overridden input" : (METHOD_TEXT[m.calculationMethod] ?? titleCase(m.calculationMethod)));

/** Keyword stems used to read the company's own definition against each dictionary checklist item. */
const TOPICS: [RegExp, RegExp][] = [
  [/salar/i, /salar/i],
  [/commission/i, /commission/i],
  [/marketing/i, /marketing|programs|paid/i],
  [/founder/i, /founder/i],
  [/sales engineering/i, /sales engineer|solutions engineer|pre-?sales/i],
  [/partner|channel/i, /partner|channel|referral/i],
  [/cloud|hosting/i, /cloud|hosting/i],
  [/inference|third-party api/i, /inference|api|model/i],
  [/human-in-the-loop|human operations/i, /human|manual|operations/i],
  [/support|delivery/i, /support|delivery|implementation/i],
  [/one-off/i, /one-off|one-time|non-recurring/i],
  [/gross.* vs\.? net/i, /\bnet\b|\bgross\b/i],
  [/pre- or post-round/i, /pre-round|post-round/i],
  [/contractors/i, /contractor/i],
];

type CheckState = "INCLUDED" | "EXCLUDED" | "UNSPECIFIED" | "OPEN";

/**
 * Resolves a checklist item against the company's stated definition, where
 * the text addresses it explicitly. Anything not mentioned stays open.
 */
function resolve(item: string, stated: string): CheckState {
  if (!stated) return "OPEN";
  const topic = TOPICS.find(([itemRe]) => itemRe.test(item));
  if (!topic) return "OPEN";
  const [, textRe] = topic;
  for (const clause of stated.split(/[;,.]| and /i)) {
    if (!textRe.test(clause)) continue;
    if (/not (specify|specified|state|stated|disclose|disclosed|define|defined)|unclear|unknown|unspecified/i.test(clause)) return "UNSPECIFIED";
    return /exclud|without|not incl|except/i.test(clause) ? "EXCLUDED" : "INCLUDED";
  }
  return "OPEN";
}

const CHECK: Record<CheckState, { mark: string; cls: string; label: string }> = {
  INCLUDED: { mark: "✓", cls: "text-ok", label: "addressed in company definition" },
  EXCLUDED: { mark: "✕", cls: "text-risk", label: "explicitly excluded by the company" },
  UNSPECIFIED: { mark: "?", cls: "text-warn", label: "company text says this is not specified" },
  OPEN: { mark: "", cls: "", label: "not addressed" },
};

function Checklist({ items, stated }: { items: string[]; stated: string }) {
  if (!items.length) return <span className="text-[12px] text-ink-3">No ambiguity recorded in the dictionary.</span>;
  return (
    <ul className="space-y-0.5 text-[12px] text-ink-2">
      {items.map((x) => {
        const st = resolve(x, stated);
        const c = CHECK[st];
        return (
          <li key={x} className="flex gap-2" title={c.label}>
            {st === "OPEN" ? (
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-[2px] border border-line-strong" aria-hidden />
            ) : (
              <span className={cx("w-2 shrink-0 text-center text-[11px] font-semibold leading-[18px]", c.cls)} aria-hidden>
                {c.mark}
              </span>
            )}
            <span>
              {x}
              {st !== "OPEN" && <span className={cx("ml-1.5 text-[11px]", c.cls)}>{st === "INCLUDED" ? "stated" : st === "EXCLUDED" ? "excluded" : "not specified"}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MetricRow({ m, def, others, slug }: { m: MetricInstance; def: MetricDefinition | undefined; others: MetricInstance[]; slug: string }) {
  const ev = metricEvidence(m);
  const small = m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN"));
  const stated = m.definitionUsed && m.calculationMethod !== "DERIVED" ? m.definitionUsed : null;
  const extraComponents = m.components.filter((x) => !(stated ?? "").toLowerCase().includes(x.toLowerCase()));
  return (
    <Link
      href={`/deals/${slug}/evidence?metric=${m.id}`}
      className="group grid gap-8 border-t border-line px-2 py-5 transition-colors first:border-t-0 hover:bg-surface-2/60 md:grid-cols-[220px_1fr_1fr]"
    >
      {/* value */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-ink">{def?.shortName ?? m.label}</span>
          <span className="font-mono text-[10.5px] text-ink-3">{m.id}</span>
        </div>
        <div className="num mt-0.5 text-[22px] font-semibold tracking-tight text-ink">{metricValue(m.unit, m.normalizedValue)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
          <Badge tone={ev.tone}>{ev.text}</Badge>
          <span className="num">{periodText(m)}</span>
          {m.sampleSize !== null && <span className={cx("num", small && "text-warn")}>n={m.sampleSize}</span>}
        </div>
        {m.calculationMethod !== "DERIVED" && <div className="mt-1.5 text-[12px] text-ink-3">Raw “{m.rawValue}”</div>}
        {others.length > 0 && (
          <div className="mt-1 text-[11.5px] text-ink-3">
            +{others.length} other observation{others.length === 1 ? "" : "s"} ({others.map((o) => `${o.id}: ${metricValue(o.unit, o.normalizedValue)}`).join(", ")})
          </div>
        )}
        <div className="mt-2 text-[11.5px] text-ink-3 group-hover:text-accent-text">Open evidence →</div>
      </div>

      {/* definitions */}
      <div className="space-y-3">
        <div>
          <div className="t-eyebrow mb-1">Definition used</div>
          {stated || extraComponents.length ? (
            <div className="text-[12.5px] text-ink-2">
              {stated && <p>{stated}</p>}
              {extraComponents.length > 0 && <p className="mt-0.5 text-ink-3">Components: {extraComponents.join("; ")}</p>}
            </div>
          ) : m.calculationMethod === "DERIVED" ? (
            <p className="text-[12.5px] text-ink-2">Computed from the inputs below — no company definition applies.</p>
          ) : (
            <p className="text-[12.5px] text-warn">Not stated by the company.</p>
          )}
        </div>
        <div>
          <div className="t-eyebrow mb-1">Canonical definition</div>
          <p className="text-[12.5px] text-ink-2">{def?.definition ?? "Not in the metric dictionary."}</p>
          {def?.formula && <code className="mt-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{def.formula}</code>}
        </div>
      </div>

      {/* method, flags, checklist */}
      <div className="space-y-3">
        <div>
          <div className="t-eyebrow mb-1">Calculation</div>
          <div className="text-[12.5px] text-ink-2">{methodLabel(m)}</div>
          {m.derivation && <code className="mt-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{m.derivation}</code>}
        </div>
        <div>
          <div className="t-eyebrow mb-1">Quality flags</div>
          {m.qualityFlags.length ? <FlagList flags={m.qualityFlags} /> : <span className="text-[12px] text-ink-3">None</span>}
        </div>
        <div>
          <div className="t-eyebrow mb-1">Confirm before relying on it</div>
          {m.calculationMethod !== "DERIVED" && (stated || m.components.length > 0) && (
            <p className="mb-1 text-[11px] text-ink-3">Checked against the company&apos;s stated definition; open boxes are not addressed.</p>
          )}
          <Checklist items={def?.disambiguation ?? []} stated={m.calculationMethod === "DERIVED" ? "" : [m.definitionUsed ?? "", ...m.components].join("; ")} />
        </div>
      </div>
    </Link>
  );
}

export default async function EconomicsTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version!.canonical;
  const d = version!.derived;

  const present = ECONOMICS.map((k) => ({ k, m: primaryOf(c.metrics, k), def: metricDef(k) })).filter((x) => x.m);
  const missing = ECONOMICS.filter((k) => !primaryOf(c.metrics, k)).map((k) => ({ k, def: metricDef(k) }));
  const inputs = INPUTS.map((k) => primaryOf(c.metrics, k)).filter((m): m is MetricInstance => !!m);

  return (
    <TabMain>
      <Section eyebrow="Causal business model" title="How the business turns demand into cash — and where it binds">
        <CausalModelView c={c} slug={slug} />
      </Section>

      <Section
        eyebrow="Unit economics & cash"
        title={present.length ? `${present.length} of ${ECONOMICS.length} economics metrics available` : "No economics metrics disclosed"}
        action={
          <Link href={`/deals/${slug}/evidence`} className="text-[12.5px] text-ink-3 hover:text-ink">
            All metrics and claims →
          </Link>
        }
      >
        <p className="mb-4 max-w-[820px] text-[13px] leading-relaxed text-ink-3">
          Each number is shown against the definition the company used and the canonical definition it is scored against. A mismatch between the two is a diligence
          item, not a rounding difference.
        </p>
        {present.length ? (
          <div className="border-y border-line">
            {present.map(({ k, m, def }) => (
              <MetricRow key={k} m={m!} def={def} slug={slug} others={instancesOf(c.metrics, k).filter((o) => o.id !== m!.id)} />
            ))}
          </div>
        ) : (
          <Quiet>The company disclosed no unit-economics or cash metrics, and none could be derived.</Quiet>
        )}
      </Section>

      {missing.length > 0 && (
        <Section eyebrow="Not disclosed" title="Missing, and what would be needed">
          <TableFrame minWidth={820}>
            <thead>
              <tr>
                <Th className="w-[180px]">Metric</Th>
                <Th>Canonical definition</Th>
                <Th className="w-[300px]">Required inputs</Th>
              </tr>
            </thead>
            <tbody>
              {missing.map(({ k, def }) => (
                <tr key={k}>
                  <Td className="text-ink-2">{def?.shortName ?? k}</Td>
                  <Td className="text-[12.5px] text-ink-3">
                    {def?.definition}
                    {def?.formula && <code className="ml-1.5 rounded bg-surface-2 px-1 font-mono text-[10.5px]">{def.formula}</code>}
                  </Td>
                  <Td className="text-[12.5px] text-ink-3">{def?.requiredFields.join(", ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </Section>
      )}

      {inputs.length > 0 && (
        <Section eyebrow="Inputs" title="Figures the derived metrics are computed from">
          <TableFrame minWidth={720}>
            <thead>
              <tr>
                <Th className="w-[180px]">Input</Th>
                <Th className="w-[120px]" align="right">
                  Value
                </Th>
                <Th className="w-[160px]">Raw</Th>
                <Th className="w-[110px]">Period</Th>
                <Th>Definition used</Th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <Link href={`/deals/${slug}/evidence?metric=${m.id}`} className="text-ink hover:text-accent-text">
                      {metricDef(m.metricKey)?.shortName ?? m.label}
                    </Link>{" "}
                    <span className="font-mono text-[10.5px] text-ink-3">{m.id}</span>
                  </Td>
                  <Td align="right" className="font-medium">
                    {metricValue(m.unit, m.normalizedValue)}
                  </Td>
                  <Td className="text-[12px] text-ink-2">“{m.rawValue}”</Td>
                  <Td className="num text-[12px] text-ink-2">{periodText(m)}</Td>
                  <Td className="text-[12.5px] text-ink-2">{m.definitionUsed ?? <span className="text-warn">Not stated</span>}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </Section>
      )}

      <Section eyebrow="Economics notes" title="What the numbers do and do not show">
        {c.economicsNotes ? (
          <div className="max-w-[900px]">
            <Layers interpretation={<Prose text={c.economicsNotes} slug={slug} />} />
          </div>
        ) : (
          <Quiet>No economics notes were produced.</Quiet>
        )}
      </Section>

      <Section eyebrow="Operating quality" title="Economics dimension">
        <DimensionDetail d={d} id="ECONOMICS" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
