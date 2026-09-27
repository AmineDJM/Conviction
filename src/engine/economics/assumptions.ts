/**
 * Explicit, documented constants of the institutional economics engine.
 *
 * Every number here is a MODEL_ASSUMPTION (a convention of this engine, not an
 * observation about the company). They are returned with every report so a
 * reader can see — and override — exactly what the model assumed.
 */

export interface EconomicsAssumptions {
  /** Option pool (granted + unallocated) as % of fully diluted shares before the round, when no cap table is provided. */
  existingPoolPrePct: number;
  /** Post-round pool target at entry when the deck states no top-up (% of post-money FD). */
  entryPoolTargetPostPct: number;
  /** Pool refresh target applied in every future priced round (% of post-money FD). */
  futurePoolTargetPostPct: number;
  /** Upper bound of the inferred ownership of prior preferred investors (pre-round FD %). */
  priorPrefMaxPct: number;
  /** Step-up used to infer the previous round's post-money when the registry has no prior stage. */
  defaultPriorStepUp: number;
  /** Simple interest on convertible notes (% per year). */
  noteInterestPct: number;
  /** Seniority of future rounds: pari passu with all preferred (market default) or stacked (each new round senior). */
  futureSeniority: "PARI_PASSU" | "STACKED";
  /** Growth-persistence heuristic: growth rate decays by this fraction every year. */
  growthDecayPerYear: number;
  /** Low / high bound of the decay heuristic, reported as a range. */
  growthDecayRange: [number, number];
  /** Ratio of required starting growth to current growth mapped to plausibility labels. */
  growthPlausibility: { PLAUSIBLE: number; DEMANDING: number; HEROIC: number };
  /** Gross-margin-adjusted CAC payback above which acquisition economics break (months). */
  cacPaybackThresholdMonths: number;
  /** NRR below which the installed base shrinks (percent). */
  nrrThresholdPct: number;
  /** Bridge raised when the next round slips: post-money cap as a multiple of the entry post-money (1 = flat). */
  bridgeValuationFactor: number;
  /** Bridge size when burn data is unavailable (% of the entry round). */
  bridgeFallbackPctOfRaise: number;
  /** Default capital multiple of the trajectory question ("return 20× our capital"). */
  trajectoryMultiple: number;
  /** Bisection iterations for every breakpoint (relative precision ≈ 2^-n). */
  bisectionIterations: number;
}

export const DEFAULT_ECONOMICS_ASSUMPTIONS: EconomicsAssumptions = {
  existingPoolPrePct: 10,
  entryPoolTargetPostPct: 10,
  futurePoolTargetPostPct: 10,
  priorPrefMaxPct: 40,
  defaultPriorStepUp: 2.5,
  noteInterestPct: 6,
  futureSeniority: "PARI_PASSU",
  growthDecayPerYear: 0.25,
  growthDecayRange: [0.2, 0.3],
  growthPlausibility: { PLAUSIBLE: 1, DEMANDING: 1.5, HEROIC: 2.5 },
  cacPaybackThresholdMonths: 36,
  nrrThresholdPct: 100,
  bridgeValuationFactor: 1,
  bridgeFallbackPctOfRaise: 25,
  trajectoryMultiple: 20,
  bisectionIterations: 60,
};

export interface AssumptionEntry {
  id: string;
  label: string;
  value: string;
  kind: "MODEL_ASSUMPTION" | "REGISTRY" | "DEAL" | "FUND";
}

export function describeAssumptions(a: EconomicsAssumptions): AssumptionEntry[] {
  return [
    { id: "POOL_PRE", label: "Existing option pool before the round (synthesized cap table)", value: `${a.existingPoolPrePct}% of FD`, kind: "MODEL_ASSUMPTION" },
    { id: "POOL_ENTRY", label: "Entry pool target when no top-up is stated", value: `${a.entryPoolTargetPostPct}% of post-money FD`, kind: "MODEL_ASSUMPTION" },
    { id: "POOL_REFRESH", label: "Pool refresh in each future round", value: `${a.futurePoolTargetPostPct}% of post-money FD`, kind: "MODEL_ASSUMPTION" },
    { id: "PRIOR_PREF", label: "Prior preferred: total raised to date at the previous round's inferred price", value: `previous post = current pre ÷ registry step-up; capped at ${a.priorPrefMaxPct}% of pre-round FD`, kind: "MODEL_ASSUMPTION" },
    { id: "PREF_STACK", label: "Preference stack", value: `every series 1x non-participating ${a.futureSeniority === "PARI_PASSU" ? "pari passu" : "stacked (newest senior)"}; our series uses the stated terms`, kind: "MODEL_ASSUMPTION" },
    { id: "SAFE", label: "SAFE", value: "post-money SAFE at the valuation cap with the stated discount, converting at the next priced round (liquidity event before conversion: greater of 1x or as-converted at the cap)", kind: "MODEL_ASSUMPTION" },
    { id: "NOTE", label: "Convertible note", value: `pre-money cap, ${a.noteInterestPct}% simple interest until conversion`, kind: "MODEL_ASSUMPTION" },
    { id: "POOL_AS_COMMON", label: "Option pool at exit", value: "treated as exercised common (strike ignored — conservative for preferred)", kind: "MODEL_ASSUMPTION" },
    { id: "GROWTH_DECAY", label: "Growth persistence heuristic", value: `growth decays ${Math.round(a.growthDecayPerYear * 100)}%/yr (range ${Math.round(a.growthDecayRange[0] * 100)}–${Math.round(a.growthDecayRange[1] * 100)}%)`, kind: "MODEL_ASSUMPTION" },
    { id: "GROWTH_PLAUSIBILITY", label: "Required ÷ current starting growth", value: `≤${a.growthPlausibility.PLAUSIBLE} plausible, ≤${a.growthPlausibility.DEMANDING} demanding, ≤${a.growthPlausibility.HEROIC} heroic, above implausible`, kind: "MODEL_ASSUMPTION" },
    { id: "CAC_PAYBACK", label: "CAC payback threshold", value: `${a.cacPaybackThresholdMonths} months (gross-margin adjusted)`, kind: "MODEL_ASSUMPTION" },
    { id: "NRR", label: "NRR threshold", value: `${a.nrrThresholdPct}%`, kind: "MODEL_ASSUMPTION" },
    { id: "BRIDGE", label: "Bridge when the next round slips", value: `post-money SAFE at ${a.bridgeValuationFactor}× the entry post-money; size = cash shortfall from the financing map, else ${a.bridgeFallbackPctOfRaise}% of the round`, kind: "MODEL_ASSUMPTION" },
    { id: "NET_DEBT", label: "Exit value", value: "exit equity value distributed through the waterfall (net debt assumed zero)", kind: "MODEL_ASSUMPTION" },
  ];
}
