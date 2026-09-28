/**
 * 7. LAND → EXPAND → PLATFORM — if it wins a customer today, how much can it
 * sell that customer in five years? A $10k wedge that can become $500k per
 * customer is structurally different from a $10k product that stays $10k.
 *
 * Deterministic path: wedge ACV/ARPA (metrics first, stated entry price
 * second), NRR compounding over the horizon, priced modules (live/beta vs
 * roadmap), and the largest customer as the demonstrated ceiling.
 */
import { operatingSnapshot } from "../economics/inputs";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, fmtUsd, hasText, isFact, metricRef, moneyUsd, mult1, num, pagesOfEvidence, pct1, round } from "./util";

export interface ExpansionFactor extends FactorBase {
  id: "LAND_EXPAND_PLATFORM";
  wedgeAcvUsd: number | null;
  wedgeSource: string;
  nrrPct: number | null;
  nrrPathUsd: number | null;
  largestCustomerUsd: number | null;
  liveModulesUsd: number;
  roadmapModulesUsd: number;
  unpricedModules: number;
  demonstratedCeilingUsd: number | null;
  platformCeilingUsd: number | null;
  demonstratedMultiple: number | null;
  platformMultiple: number | null;
  modules: { name: string; status: string; priceUsd: number | null; page: number | null }[];
  expansionKinds: string[];
}

export function landExpandPlatform(inp: DivergenceInputs): ExpansionFactor {
  const ex = inp.draft?.expansion ?? null;
  const op = operatingSnapshot(inp.deal);
  const acv = metricRef(inp.deal, "acv");
  const evidence: DivergenceEvidence[] = [];
  let wedge: number | null = null;
  let wedgeSource = "Unavailable";
  let wedgeBasis: "COMPUTED" | "MODEL_OBSERVED" = "COMPUTED";
  if (op.arpaUsd !== null && op.arpaUsd > 0 && op.arpaSource !== "Model assumption (analysis)") {
    wedge = op.arpaUsd;
    wedgeSource = op.arpaSource;
  } else if (moneyUsd(ex?.entryPrice) !== null && moneyUsd(ex?.entryPrice)! > 0) {
    wedge = moneyUsd(ex!.entryPrice)!;
    wedgeSource = `Entry price as stated (${ex!.entryPrice!.rawText})`;
    wedgeBasis = "MODEL_OBSERVED";
  } else if (op.arpaUsd !== null && op.arpaUsd > 0) {
    wedge = op.arpaUsd;
    wedgeSource = op.arpaSource;
  }
  if (wedge !== null) evidence.push(ev(wedgeBasis, `Wedge: ${fmtUsd(wedge)} per customer per year — ${wedgeSource}`, [acv?.page], [acv?.ref]));

  const nrrRef = metricRef(inp.deal, "nrr");
  const nrr = nrrRef?.value ?? op.nrrPct ?? null;
  const nrrUsed = nrr !== null ? Math.min(nrr, A.nrrCapPct) : null;
  const nrrPath = wedge !== null && nrrUsed !== null && nrrUsed > 0 ? round(wedge * Math.pow(nrrUsed / 100, A.expansionHorizonYears), 0) : null;
  if (nrrPath !== null) evidence.push(ev("COMPUTED", `NRR ${pct1(nrr)} compounded over ${A.expansionHorizonYears} years: ${fmtUsd(wedge)} → ${fmtUsd(nrrPath)} per customer${nrr! > A.nrrCapPct ? ` (NRR capped at ${A.nrrCapPct}%)` : ""}`, [nrrRef?.page], [nrrRef?.ref]));

  const largest = moneyUsd(ex?.largestCustomerAnnualValue);
  if (largest !== null && largest > 0) evidence.push(ev("MODEL_OBSERVED", `Largest customer: ${ex!.largestCustomerAnnualValue!.rawText} per year`));
  const modules = (ex?.modules ?? []).map((m) => ({ name: m.name, status: m.status, priceUsd: moneyUsd(m.annualPricePerCustomer), page: m.page, evidence: m.evidence }));
  const live = modules.filter((m) => m.status === "LIVE" || m.status === "BETA");
  const roadmap = modules.filter((m) => m.status === "ROADMAP" || m.status === "VISION");
  const liveUsd = live.reduce((s, m) => s + (m.priceUsd ?? 0), 0);
  const roadmapUsd = roadmap.reduce((s, m) => s + (m.priceUsd ?? 0), 0);
  const unpriced = modules.filter((m) => m.priceUsd === null).length;
  for (const m of modules) evidence.push(ev("MODEL_OBSERVED", `Module ${m.name} (${m.status.toLowerCase()})${m.priceUsd !== null ? ` ${fmtUsd(m.priceUsd)}/customer/year` : " — unpriced"}${hasText(m.evidence) ? `: ${m.evidence}` : ""}`, [m.page]));
  const kinds = [...new Set((ex?.expansionEvidence ?? []).filter((e) => isFact(e.evidence)).map((e) => e.kind))];
  for (const e of (ex?.expansionEvidence ?? []).filter((x) => isFact(x.evidence))) evidence.push(ev("MODEL_OBSERVED", `Observed expansion — ${e.kind.toLowerCase().replace(/_/g, " ")}: ${e.evidence}`, [e.page]));

  let demonstrated: number | null = null;
  let platform: number | null = null;
  if (wedge !== null) {
    demonstrated = Math.max(wedge, nrrPath ?? 0, largest ?? 0, wedge + liveUsd);
    platform = Math.max(demonstrated, wedge + liveUsd + roadmapUsd);
  }
  const dm = demonstrated !== null && wedge ? round(demonstrated / wedge, 1) : null;
  const pm = platform !== null && wedge ? round(platform / wedge, 1) : null;
  const expansionKnown = nrr !== null || modules.length > 0 || (largest !== null && largest > 0) || kinds.length > 0;

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = wedge === null ? "WEDGE_PRICE_UNKNOWN" : "WEDGE_ONLY_KNOWN";
  if (wedge !== null && expansionKnown && dm !== null && pm !== null) {
    if (dm >= A.platformMultiple || (dm >= A.meaningfulMultiple && pm >= A.platformMultiple)) {
      level = "STRONG";
      reading = dm >= A.platformMultiple ? "PLATFORM_DEMONSTRATED" : "EXPANSION_DEMONSTRATED_PLATFORM_ROADMAP";
    } else if (pm >= A.platformMultiple) {
      level = "ADEQUATE";
      reading = "PLATFORM_ON_ROADMAP";
    } else if (dm >= A.meaningfulMultiple || pm >= A.meaningfulMultiple || kinds.length >= 2) {
      level = "ADEQUATE";
      reading = "MEANINGFUL_EXPANSION";
    } else {
      level = "WEAK";
      reading = "SINGLE_PRODUCT_CEILING";
    }
  }
  const why =
    level === "INSUFFICIENT_EVIDENCE"
      ? wedge === null
        ? "Entry price per customer is unknown (no ACV/ARPA, no stated price)."
        : `Wedge ${fmtUsd(wedge)} known, but nothing shows how much more a customer can buy (no NRR, modules or expansion evidence).`
      : `A ${fmtUsd(wedge)} wedge reaches ${fmtUsd(demonstrated)} per customer on demonstrated evidence (${mult1(dm)}) and ${fmtUsd(platform)} with the roadmap (${mult1(pm)}).`;

  const ref = A.referenceArrUsd;
  const custAtWedge = wedge ? Math.ceil(ref / wedge) : null;
  const custAtCeiling = demonstrated ? Math.ceil(ref / demonstrated) : null;
  const custAtPlatform = platform ? Math.ceil(ref / platform) : null;
  const implications: string[] = [];
  if (custAtWedge !== null && custAtCeiling !== null && level !== "INSUFFICIENT_EVIDENCE")
    implications.push(`Growth structure: ${fmtUsd(ref)} ARR needs ${custAtWedge.toLocaleString("en-US")} customers at the wedge price, ${custAtCeiling.toLocaleString("en-US")} at the demonstrated ceiling${custAtPlatform !== null && custAtPlatform < custAtCeiling ? ` and ${custAtPlatform.toLocaleString("en-US")} if the roadmap sells` : ""}.`);
  if (reading === "PLATFORM_ON_ROADMAP") implications.push("The platform ceiling rests on roadmap modules not yet sold — the expansion thesis is a product-execution bet.");
  if (level === "WEAK") implications.push("Each customer stays small: growth must come almost entirely from new logos, so CAC efficiency decides the outcome.");
  if (unpriced > 0) implications.push(`${unpriced} module${unpriced > 1 ? "s" : ""} without a stated price — ask for pricing to size the platform ceiling.`);

  return {
    id: "LAND_EXPAND_PLATFORM",
    n: 7,
    name: "Land → expand → platform",
    question: "If it wins a customer today, how much can it sell that customer in five years?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: `Wedge = ACV (else ARPU × 12, else revenue ÷ customers), else the stated entry price. Demonstrated ceiling (per customer, ${A.expansionHorizonYears} years) = max(wedge × NRR^${A.expansionHorizonYears} [NRR capped at ${A.nrrCapPct}%], largest customer's annual value, wedge + live/beta module prices). Platform ceiling adds roadmap/vision module prices. Demonstrated ≥ ${A.platformMultiple}× wedge, or ≥ ${A.meaningfulMultiple}× with a ≥ ${A.platformMultiple}× platform ceiling → STRONG; platform ≥ ${A.platformMultiple}× on roadmap only, or any ≥ ${A.meaningfulMultiple}× / ≥ 2 observed expansion kinds → ADEQUATE; otherwise WEAK. Needs a wedge price and at least one expansion input.`,
    evidence,
    coverage: coverage(
      [wedge !== null && "wedge price", nrr !== null && "NRR", modules.length > 0 && "product modules", largest !== null && "largest customer value", kinds.length > 0 && "observed expansion"],
      [wedge === null && "wedge price (ACV / ARPA / entry price)", nrr === null && "NRR", !modules.length && "product modules", largest === null && "largest customer value", !kinds.length && "observed expansion"],
    ),
    computed: [
      num("wedgeAcvUsd", "Wedge per customer / year", wedge, "USD", wedgeBasis),
      num("nrrPathUsd", `NRR path after ${A.expansionHorizonYears} years`, nrrPath, "USD"),
      num("demonstratedCeilingUsd", "Demonstrated ceiling per customer", demonstrated, "USD"),
      num("platformCeilingUsd", "Platform ceiling per customer (incl. roadmap)", platform, "USD"),
      num("demonstratedMultiple", "Demonstrated ÷ wedge", dm, "MULTIPLE"),
      num("platformMultiple", "Platform ÷ wedge", pm, "MULTIPLE"),
      num("customersAtWedge", `Customers for ${fmtUsd(ref)} ARR at wedge`, custAtWedge, "COUNT"),
      num("customersAtCeiling", `Customers for ${fmtUsd(ref)} ARR at ceiling`, custAtCeiling, "COUNT"),
    ],
    implications,
    wedgeAcvUsd: wedge,
    wedgeSource,
    nrrPct: nrr,
    nrrPathUsd: nrrPath,
    largestCustomerUsd: largest,
    liveModulesUsd: liveUsd,
    roadmapModulesUsd: roadmapUsd,
    unpricedModules: unpriced,
    demonstratedCeilingUsd: demonstrated,
    platformCeilingUsd: platform,
    demonstratedMultiple: dm,
    platformMultiple: pm,
    modules: modules.map(({ name, status, priceUsd, page }) => ({ name, status, priceUsd, page })),
    expansionKinds: kinds,
  };
}
