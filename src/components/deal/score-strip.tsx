import type { DerivedAnalysis } from "@/engine/derive";
import { Badge, IndexBar } from "@/components/ui";
import { evidenceTone, levelTone, titleCase } from "@/lib/format";

/**
 * §84 metric strip. Deliberately heterogeneous: an index with bounds, an
 * anchored category, an index, a gate + index, and a multidimensional risk
 * headline — so they are not read as the same kind of number.
 */
export function ScoreStrip({ d }: { d: DerivedAnalysis }) {
  const oqi = d.operatingQuality;
  const pl = d.powerLaw;
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-4 md:grid-cols-5">
      <div>
        <div className="t-eyebrow mb-1">Operating quality</div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[20px] font-semibold tracking-tight">{oqi.value !== null ? Math.round(oqi.value) : "—"}</span>
          <span className="text-[12px] text-ink-3">/ 100</span>
          {oqi.status !== "SCORED" && <Badge tone={oqi.status === "PARTIAL" ? "warn" : "unknown"}>{oqi.status === "PARTIAL" ? "Partial" : "Not scorable"}</Badge>}
        </div>
        <div className="mt-1.5">
          <IndexBar value={oqi.value} lower={oqi.lower} upper={oqi.upper} width={120} />
        </div>
        <div className="num mt-1 text-[11.5px] text-ink-3">
          Bounds {Math.round(oqi.lower)}–{Math.round(oqi.upper)} · coverage {Math.round(oqi.coverage * 100)}%
        </div>
        <div className="text-[11.5px] text-ink-3">{d.peerGroup.name}</div>
      </div>

      <div>
        <div className="t-eyebrow mb-1">Evidence</div>
        <Badge tone={evidenceTone(d.evidence.category)} dot>
          {titleCase(d.evidence.category)}
        </Badge>
        <div className="num mt-2 text-[11.5px] text-ink-3">
          {d.evidence.verifiedMaterial}/{d.evidence.materialClaims} material claims verified
          {d.evidence.contradictedMaterial > 0 && <span className="text-risk"> · {d.evidence.contradictedMaterial} contradicted</span>}
        </div>
        <div className="num text-[11.5px] text-ink-3">Evidence index {Math.round(d.evidence.index)} — not a probability</div>
      </div>

      <div>
        <div className="t-eyebrow mb-1">Power-law potential</div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[20px] font-semibold tracking-tight">{pl.value !== null ? Math.round(pl.value) : "—"}</span>
          <span className="text-[12px] text-ink-3">anchored index</span>
        </div>
        <div className="mt-1 space-y-0.5 text-[11.5px] text-ink-3">
          {pl.components.map((c) => (
            <div key={c.id} className="flex justify-between gap-2">
              <span>{c.label}</span>
              <span className="num">{c.score !== null ? Math.round(c.score) : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="t-eyebrow mb-1">Fund fit</div>
        <div className="flex items-center gap-2">
          <Badge tone={d.fundFit.mandate === "PASS" ? "ok" : d.fundFit.mandate === "FAIL" ? "risk" : "warn"}>Mandate {titleCase(d.fundFit.mandate)}</Badge>
          <span className="num text-[15px] font-semibold">{d.fundFit.index ?? "—"}</span>
        </div>
        <div className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-3">
          {d.fundFit.gates
            .filter((g) => g.result !== "PASS")
            .slice(0, 3)
            .map((g) => (
              <div key={g.id}>
                {g.label}: {titleCase(g.result)}
              </div>
            ))}
          <div>Fund fit ≠ company quality</div>
        </div>
      </div>

      <div>
        <div className="t-eyebrow mb-1">Risk</div>
        {d.risk.headline ? (
          <Badge tone={levelTone(d.risk.headline)} dot>
            {titleCase(d.risk.headline)}
          </Badge>
        ) : (
          <span className="text-ink-3">—</span>
        )}
        <div className="mt-2 space-y-0.5 text-[11.5px] text-ink-3">
          <div>{d.risk.thesisKillers.length} thesis-killing</div>
          <div>{d.risk.structural.length} structural · {d.risk.repairable.length} repairable</div>
          <div>Financing path: {titleCase(d.financing.risk)}</div>
        </div>
      </div>
    </div>
  );
}
