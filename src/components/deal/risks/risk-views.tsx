import Link from "next/link";
import type { Risk } from "@/domain/canonical";
import { LEVELS, RISK_CATEGORIES, type Level } from "@/domain/enums";
import type { RiskProfile } from "@/engine/risk";
import { Badge, Td, Th, cx } from "@/components/ui";
import { RichText } from "@/components/deal/rich-text";
import { levelTone, titleCase, type Tone } from "@/lib/format";

export const CLASS_TONE: Record<string, Tone> = { REPAIRABLE: "neutral", STRUCTURAL: "warn", THESIS_KILLING: "risk" };
export const CLASS_LABEL: Record<string, string> = { REPAIRABLE: "Repairable", STRUCTURAL: "Structural", THESIS_KILLING: "Thesis-killing" };
export const RISK_CATEGORY_LABEL: Record<string, string> = {
  TECHNICAL: "Technical",
  PRODUCT: "Product",
  MARKET: "Market",
  GTM: "Go-to-market",
  CUSTOMER: "Customer",
  COMPETITION: "Competition",
  REGULATORY: "Regulatory",
  LEGAL_IP: "Legal / IP",
  FINANCING: "Financing",
  EXECUTION: "Execution",
  KEY_PERSON: "Key person",
};
const TIMING_LABEL: Record<string, string> = { NOW: "Now", NEXT_12_MONTHS: "Next 12 mo", NEXT_ROUND: "Next round", AT_SCALE: "At scale", EXIT: "At exit" };

export function LevelBadge({ level, kind }: { level: Level; kind: "S" | "L" }) {
  return (
    <Badge tone={levelTone(level)} title={`${kind === "S" ? "Severity" : "Likelihood"}: ${titleCase(level)}`}>
      <span className="text-[10px] opacity-70">{kind}</span>
      {titleCase(level)}
    </Badge>
  );
}

/**
 * Severity × likelihood 4×4 grid. Counts only; each count links to the
 * risk rows. Shading steps with exposure but the numbers carry the meaning.
 */
export function RiskGrid({ risks }: { risks: Risk[] }) {
  const sev = [...LEVELS].reverse();
  return (
    <div>
      <div className="grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-[3px] text-[12px]">
        <div />
        {LEVELS.map((l) => (
          <div key={l} className="pb-1 text-center text-[11px] text-ink-3">
            {titleCase(l)}
          </div>
        ))}
        {sev.map((s) => (
          <Row key={s} s={s} risks={risks} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-[76px_1fr] text-[11px] text-ink-3">
        <span>↑ Severity</span>
        <span className="text-center">Likelihood →</span>
      </div>
    </div>
  );
}

function Row({ s, risks }: { s: Level; risks: Risk[] }) {
  const si = LEVELS.indexOf(s);
  return (
    <>
      <div className="flex items-center text-[11px] text-ink-3">{titleCase(s)}</div>
      {LEVELS.map((l) => {
        const li = LEVELS.indexOf(l);
        const cell = risks.filter((r) => r.severity === s && r.likelihood === l);
        const exposure = (si + 1) * (li + 1);
        const shade = !cell.length ? "bg-surface-2/60" : exposure >= 9 ? "bg-risk-soft" : exposure >= 4 ? "bg-warn-soft" : "bg-surface-3";
        return (
          <div key={l} className={cx("flex min-h-[46px] flex-col justify-between rounded-[4px] px-2 py-1.5", shade)} title={`${titleCase(s)} severity × ${titleCase(l)} likelihood: ${cell.length}`}>
            <span className={cx("num text-[15px] font-semibold leading-none", cell.length ? "text-ink" : "text-ink-3/50")}>{cell.length || "·"}</span>
            {cell.length > 0 && (
              <span className="flex flex-wrap gap-x-1.5 leading-tight">
                {cell.map((r) => (
                  <a key={r.id} href={`#${r.id}`} className="font-mono text-[10px] text-ink-2 hover:text-accent-text hover:underline">
                    {r.id}
                  </a>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

export function CategoryCoverage({ profile }: { profile: RiskProfile }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr>
          <Th className="!px-0">Category</Th>
          <Th align="right">Risks</Th>
          <Th className="!pr-0">Highest severity</Th>
        </tr>
      </thead>
      <tbody>
        {RISK_CATEGORIES.map((c) => {
          const cell = profile.byCategory[c];
          return (
            <tr key={c}>
              <Td className="!px-0 !py-1.5">
                {cell.count ? (
                  <a href={`#cat-${c}`} className="hover:text-accent-text">
                    {RISK_CATEGORY_LABEL[c]}
                  </a>
                ) : (
                  <span className="text-ink-3">{RISK_CATEGORY_LABEL[c]}</span>
                )}
              </Td>
              <Td align="right" className="!py-1.5">
                {cell.count || <span className="text-ink-3">—</span>}
              </Td>
              <Td className="!pr-0 !py-1.5">{cell.max ? <Badge tone={levelTone(cell.max)}>{titleCase(cell.max)}</Badge> : <span className="text-ink-3">None identified</span>}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** §56 risk matrix — rows grouped by category in canonical order. */
export function RiskMatrix({ risks, slug }: { risks: Risk[]; slug: string }) {
  const groups = RISK_CATEGORIES.map((c) => ({ c, rs: risks.filter((r) => r.category === c) })).filter((g) => g.rs.length > 0);
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full min-w-[980px] text-[13px]">
        <thead>
          <tr>
            <Th className="w-[70px]">ID</Th>
            <Th className="w-[30%]">Risk</Th>
            <Th className="w-[100px]">Severity</Th>
            <Th className="w-[100px]">Likelihood</Th>
            <Th className="w-[92px]">Timing</Th>
            <Th className="w-[112px]">Class</Th>
            <Th>Mitigation · evidence</Th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.c} id={`cat-${g.c}`} className="scroll-mt-32">
            <tr>
              <td colSpan={7} className="border-t border-line-strong px-3 pb-1 pt-3">
                <span className="t-eyebrow">{RISK_CATEGORY_LABEL[g.c]}</span>
              </td>
            </tr>
            {g.rs.map((r) => (
              <tr key={r.id} id={r.id} className={cx("scroll-mt-32 target:bg-accent-soft/50", r.weaknessClass === "THESIS_KILLING" && "bg-risk-soft/40")}>
                <Td className="font-mono text-[11px] text-ink-3">{r.id}</Td>
                <Td>
                  <div className="font-medium text-ink">{r.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
                    <RichText text={r.description} slug={slug} />
                  </div>
                </Td>
                <Td>
                  <LevelBadge level={r.severity} kind="S" />
                </Td>
                <Td>
                  <LevelBadge level={r.likelihood} kind="L" />
                </Td>
                <Td className="text-[12.5px] text-ink-2">{TIMING_LABEL[r.timing] ?? titleCase(r.timing)}</Td>
                <Td>
                  <Badge tone={CLASS_TONE[r.weaknessClass]}>{CLASS_LABEL[r.weaknessClass]}</Badge>
                </Td>
                <Td className="text-[12.5px] leading-snug text-ink-2">
                  <RichText text={r.mitigation} slug={slug} />
                  <div className="mt-1 text-[11.5px] text-ink-3">
                    Evidence: <RichText text={r.evidence} slug={slug} />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function RepairTable({ risks, slug }: { risks: Risk[]; slug: string }) {
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr>
            <Th className="w-[34%]">Weakness</Th>
            <Th>Resources required</Th>
            <Th className="w-[120px]">Time</Th>
            <Th className="w-[110px]">Difficulty</Th>
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link href={`#${r.id}`} className="mr-1.5 font-mono text-[10.5px] text-ink-3 hover:text-accent-text">
                  {r.id}
                </Link>
                <span className="text-ink">{r.title}</span>
              </Td>
              <Td className="text-[12.5px] text-ink-2">{r.repair ? <RichText text={r.repair.resources} slug={slug} /> : <span className="text-ink-3">Not specified</span>}</Td>
              <Td className="num text-[12.5px]">{r.repair?.time ?? "—"}</Td>
              <Td>{r.repair ? <Badge tone={levelTone(r.repair.difficulty)}>{titleCase(r.repair.difficulty)}</Badge> : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const FALSIFIER_TONE: Record<string, Tone> = { NOT_TESTED: "unknown", SEARCHED_NOT_FOUND: "ok", PARTIAL_SIGNAL: "warn", FOUND: "risk" };
export const FALSIFIER_LABEL: Record<string, string> = {
  NOT_TESTED: "Not tested",
  SEARCHED_NOT_FOUND: "Searched — not found",
  PARTIAL_SIGNAL: "Partial signal",
  FOUND: "Found",
};
export const CONDITION_TONE: Record<string, Tone> = { SUPPORTED: "ok", PARTIALLY_SUPPORTED: "warn", HYPOTHETICAL: "unknown", CONTRADICTED: "risk" };
