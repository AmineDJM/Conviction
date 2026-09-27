/**
 * §51–55 Fund mandate gates (binary) and fund fit (descriptive).
 * Mandate gates are never averaged into Fund Fit. Fund fit is not company quality.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { FinancingStage } from "@/domain/enums";
import type { BenchmarkRegistry } from "./benchmarks/types";
import type { EntryTerms } from "./returns";

export type GateResult = "PASS" | "FAIL" | "UNKNOWN";

export interface MandateGate {
  id: "GEOGRAPHY" | "SECTOR_EXCLUDED" | "STAGE" | "CHECK_SIZE" | "EXCLUDED_CATEGORY";
  label: string;
  result: GateResult;
  detail: string;
}

export interface FundFitResult {
  mandate: "PASS" | "FAIL" | "INCOMPLETE";
  gates: MandateGate[];
  index: number | null;
  components: { id: string; label: string; score: number | null; detail: string }[];
  portfolio: { overlaps: string[]; conflicts: string[]; sectorExposure: number };
  concentration: { maxCheckPlusReservesUsd: number; limitUsd: number; ok: boolean };
}

const STAGE_ORDER: FinancingStage[] = ["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "SERIES_C_PLUS"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function geoMatch(hq: string | null, allowed: string[]): GateResult {
  if (allowed.length === 0) return "PASS";
  if (!hq) return "UNKNOWN";
  const h = norm(hq);
  const EUROPE = ["france", "germany", "unitedkingdom", "uk", "spain", "italy", "netherlands", "sweden", "denmark", "norway", "finland", "switzerland", "ireland", "belgium", "portugal", "austria", "poland", "estonia", "czechrepublic", "czechia"];
  for (const a of allowed) {
    const n = norm(a);
    if (n === h || h.includes(n) || n.includes(h)) return "PASS";
    if (n === "europe" && EUROPE.includes(h)) return "PASS";
    if ((n === "us" || n === "usa" || n === "northamerica") && (h === "unitedstates" || h === "usa" || h === "us" || (n === "northamerica" && h === "canada"))) return "PASS";
  }
  return "FAIL";
}

export function fundFit(deal: CanonicalDeal, fund: FundProfile, registry: BenchmarkRegistry, entry: EntryTerms): FundFitResult {
  const gates: MandateGate[] = [];
  const hq = deal.identity.hqCountry;
  const g = geoMatch(hq, fund.geographies);
  gates.push({ id: "GEOGRAPHY", label: "Geography", result: g, detail: fund.geographies.length ? `HQ ${hq ?? "unknown"} vs allowed ${fund.geographies.join(", ")}` : "Global mandate" });

  const excludedHit = deal.classification.industry.filter((i) => fund.excludedIndustries.includes(i));
  gates.push({
    id: "SECTOR_EXCLUDED",
    label: "Excluded sectors",
    result: excludedHit.length ? "FAIL" : "PASS",
    detail: excludedHit.length ? `Excluded: ${excludedHit.join(", ")}` : "No excluded sector",
  });

  const catText = [deal.identity.oneLiner, deal.product?.whatItIs ?? "", ...deal.classification.industry].join(" ").toLowerCase();
  const catHit = fund.excludedCategories.filter((c) => c && catText.includes(c.toLowerCase()));
  gates.push({ id: "EXCLUDED_CATEGORY", label: "Excluded categories", result: catHit.length ? "FAIL" : "PASS", detail: catHit.length ? `Matches: ${catHit.join(", ")}` : "None matched" });

  const stage = deal.classification.financingStage;
  gates.push({
    id: "STAGE",
    label: "Stage",
    result: stage === "UNKNOWN" ? "UNKNOWN" : fund.stages.includes(stage) ? "PASS" : "FAIL",
    detail: `${stage} vs mandate ${fund.stages.join(", ")}`,
  });

  const raise = entry.raiseUsd;
  gates.push({
    id: "CHECK_SIZE",
    label: "Check size feasible",
    result: raise === null ? "UNKNOWN" : raise < fund.checkMinUsd ? "FAIL" : "PASS",
    detail: raise === null ? "Round size unknown" : `Round $${(raise / 1e6).toFixed(1)}M vs minimum check $${(fund.checkMinUsd / 1e6).toFixed(1)}M`,
  });

  const mandate = gates.some((x) => x.result === "FAIL") ? "FAIL" : gates.some((x) => x.result === "UNKNOWN") ? "INCOMPLETE" : "PASS";

  // Descriptive fit components (0–100).
  const comps: FundFitResult["components"] = [];
  const idx = STAGE_ORDER.indexOf(stage as FinancingStage);
  const stageScore = stage === "UNKNOWN" ? null : fund.stages.includes(stage) ? 100 : fund.stages.some((s) => Math.abs(STAGE_ORDER.indexOf(s) - idx) === 1) ? 50 : 0;
  comps.push({ id: "STAGE", label: "Stage fit", score: stageScore, detail: `${stage}` });

  const maxShare = registry.fundFit.maxShareOfRoundPct / 100;
  const achievableCheck = raise !== null ? Math.min(fund.checkMaxUsd, raise * maxShare) : null;
  const checkScore = achievableCheck === null ? null : achievableCheck >= fund.checkMinUsd ? 100 : Math.max(0, (achievableCheck / fund.checkMinUsd) * 100);
  comps.push({ id: "CHECK", label: "Check fit", score: checkScore, detail: achievableCheck === null ? "Round size unknown" : `Achievable check ≈ $${(achievableCheck / 1e6).toFixed(2)}M` });

  const ownership = achievableCheck !== null && entry.postMoneyUsd ? (achievableCheck / entry.postMoneyUsd) * 100 : null;
  const ownScore = ownership === null ? null : Math.min(100, (ownership / fund.ownershipTargetPct) * 100);
  comps.push({ id: "OWNERSHIP", label: "Ownership fit", score: ownScore, detail: ownership === null ? "Valuation unknown" : `Max achievable ${ownership.toFixed(1)}% vs target ${fund.ownershipTargetPct}%` });

  const sectorOverlap = deal.classification.industry.some((i) => fund.sectorExpertise.includes(i));
  const inFocus = fund.sectors.length === 0 || deal.classification.industry.some((i) => fund.sectors.includes(i));
  comps.push({ id: "SECTOR", label: "Sector expertise", score: sectorOverlap ? 100 : inFocus ? 60 : 30, detail: sectorOverlap ? "Within sector expertise" : inFocus ? "In mandate, outside core expertise" : "Outside focus" });

  const geoExp = hq ? fund.geographicExpertise.some((x) => geoMatch(hq, [x]) === "PASS") : false;
  comps.push({ id: "GEOGRAPHY", label: "Geographic expertise", score: hq ? (geoExp ? 100 : 50) : null, detail: hq ?? "HQ unknown" });

  // Portfolio context (§54).
  const competitorNames = new Set((deal.competition?.competitors ?? []).map((c) => norm(c.name)));
  const conflicts = fund.portfolio.filter((p) => competitorNames.has(norm(p.name))).map((p) => p.name);
  const overlaps = fund.portfolio.filter((p) => p.industry.some((i) => deal.classification.industry.includes(i))).map((p) => p.name);
  const sectorExposure = fund.portfolio.length ? overlaps.length / fund.portfolio.length : 0;
  comps.push({
    id: "PORTFOLIO",
    label: "Portfolio fit",
    score: conflicts.length ? 0 : Math.round(100 - Math.min(60, sectorExposure * 100)),
    detail: conflicts.length ? `Competitive conflict: ${conflicts.join(", ")}` : `${overlaps.length} portfolio companies in same industry`,
  });

  const reserves = (achievableCheck ?? fund.initialCheckDefaultUsd) * fund.reserveRatio;
  const limit = (fund.maxConcentrationPct / 100) * fund.fundSizeUsd;
  const exposure = (achievableCheck ?? fund.initialCheckDefaultUsd) + reserves;
  comps.push({ id: "RESERVES", label: "Reserve fit", score: exposure <= limit ? 100 : Math.max(0, (limit / exposure) * 100), detail: `Check + reserves $${(exposure / 1e6).toFixed(1)}M vs concentration limit $${(limit / 1e6).toFixed(1)}M` });

  const w = registry.fundFit.weights;
  let ws = 0;
  let ss = 0;
  for (const c of comps) {
    const wt = w[c.id as keyof typeof w] ?? 0;
    if (c.score === null) continue;
    ws += wt;
    ss += wt * c.score;
  }
  return {
    mandate,
    gates,
    index: ws > 0 ? Math.round(ss / ws) : null,
    components: comps,
    portfolio: { overlaps, conflicts, sectorExposure },
    concentration: { maxCheckPlusReservesUsd: exposure, limitUsd: limit, ok: exposure <= limit },
  };
}
