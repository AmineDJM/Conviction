/**
 * §45 Deterministic cap table engine.
 *
 * Supports common, preferred, option pools, warrants, SAFEs (pre- and
 * post-money), convertible notes, secondary transfers and debt. Priced rounds
 * are solved by fixed-point iteration so that pool top-ups and SAFE/note
 * conversions are all inside the pre-money, as is market standard.
 *
 * Model conventions (documented, not hidden):
 * - "Fully diluted" = all issued shares + all options (granted and unallocated) + warrants.
 * - Post-money SAFE capitalization = all FD shares before the round + all converting
 *   SAFE/notes shares, EXCLUDING the round's new pool top-up and new money.
 * - Pre-money SAFE / note capitalization = FD shares before the round (excl. conversions).
 */

export type ShareClassType = "COMMON" | "PREFERRED" | "OPTION_POOL" | "WARRANT";

export interface ShareClass {
  name: string;
  type: ShareClassType;
  /** Price paid per share (preferred) — used for liquidation preference. */
  originalIssuePrice: number;
  liquidationPrefMultiple: number;
  participating: boolean;
  /** Higher number = more senior. */
  seniority: number;
}

export interface Holding {
  holder: string;
  className: string;
  shares: number;
}

export interface Convertible {
  holder: string;
  kind: "SAFE_POST_MONEY" | "SAFE_PRE_MONEY" | "CONVERTIBLE_NOTE";
  principal: number;
  valuationCap: number | null;
  discountPct: number | null;
  /** Notes only. Simple interest. */
  interestRatePct?: number;
  yearsOutstanding?: number;
}

export interface Debt {
  holder: string;
  principal: number;
}

export interface CapTable {
  classes: ShareClass[];
  holdings: Holding[];
  convertibles: Convertible[];
  debt: Debt[];
}

export function emptyCapTable(): CapTable {
  return {
    classes: [
      { name: "Common", type: "COMMON", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
      { name: "Option Pool", type: "OPTION_POOL", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
    ],
    holdings: [],
    convertibles: [],
    debt: [],
  };
}

export function totalFdShares(ct: CapTable): number {
  return ct.holdings.reduce((a, h) => a + h.shares, 0);
}

export function ownershipByHolder(ct: CapTable): Record<string, number> {
  const total = totalFdShares(ct);
  const out: Record<string, number> = {};
  for (const h of ct.holdings) out[h.holder] = (out[h.holder] ?? 0) + h.shares / total;
  return out;
}

export function sharesOf(ct: CapTable, holder: string): number {
  return ct.holdings.filter((h) => h.holder === holder).reduce((a, h) => a + h.shares, 0);
}

function poolShares(ct: CapTable): number {
  const poolClasses = new Set(ct.classes.filter((c) => c.type === "OPTION_POOL").map((c) => c.name));
  return ct.holdings.filter((h) => poolClasses.has(h.className)).reduce((a, h) => a + h.shares, 0);
}

function convertibleAmount(c: Convertible): number {
  if (c.kind === "CONVERTIBLE_NOTE") {
    return c.principal * (1 + ((c.interestRatePct ?? 0) / 100) * (c.yearsOutstanding ?? 0));
  }
  return c.principal;
}

export interface PricedRoundInput {
  className: string;
  preMoney: number;
  investments: { holder: string; amount: number }[];
  /** Target unallocated+allocated pool as % of post-money FD, topped up in the pre-money. */
  targetPoolPostPct?: number;
  liquidationPrefMultiple?: number;
  participating?: boolean;
  seniority?: number;
}

export interface PricedRoundResult {
  capTable: CapTable;
  pricePerShare: number;
  newMoneyShares: number;
  poolTopUpShares: number;
  conversionShares: { holder: string; shares: number; conversionPrice: number }[];
  postMoney: number;
  iterations: number;
}

/**
 * Apply a priced equity round. All outstanding convertibles convert.
 * Solves P = preMoney / (S0 + poolTopUp + conversionShares) by fixed point.
 */
export function applyPricedRound(ct: CapTable, input: PricedRoundInput): PricedRoundResult {
  const S0 = totalFdShares(ct);
  if (S0 <= 0) throw new Error("Cap table has no shares");
  const newMoney = input.investments.reduce((a, i) => a + i.amount, 0);
  const existingPool = poolShares(ct);
  const poolPct = (input.targetPoolPostPct ?? 0) / 100;

  let P = input.preMoney / S0;
  let X = 0;
  let conv: { holder: string; shares: number; conversionPrice: number }[] = [];
  let iterations = 0;

  for (; iterations < 500; iterations++) {
    const N = newMoney / P;
    // SAFE / note conversions at this price.
    const convSharesPre = conv.reduce((a, c) => a + c.shares, 0);
    const nextConv = ct.convertibles.map((c) => {
      const amount = convertibleAmount(c);
      const discountPrice = c.discountPct ? P * (1 - c.discountPct / 100) : P;
      let capPrice = Number.POSITIVE_INFINITY;
      if (c.valuationCap) {
        const capBase = c.kind === "SAFE_POST_MONEY" ? S0 + convSharesPre : S0;
        capPrice = c.valuationCap / capBase;
      }
      const price = Math.min(P, discountPrice, capPrice);
      return { holder: c.holder, shares: amount / price, conversionPrice: price };
    });
    const C = nextConv.reduce((a, c) => a + c.shares, 0);
    // Pool top-up so that (existingPool + X) = poolPct × post FD.
    const postWithoutX = S0 + C + N;
    const nextX = poolPct > 0 ? Math.max(0, (poolPct * postWithoutX - existingPool) / (1 - poolPct)) : 0;
    const nextP = input.preMoney / (S0 + nextX + C);
    const converged = Math.abs(nextP - P) / P < 1e-12 && Math.abs(nextX - X) < 1e-6;
    P = nextP;
    X = nextX;
    conv = nextConv;
    if (converged) break;
  }

  const N = newMoney / P;
  const classes = [...ct.classes];
  if (!classes.some((c) => c.name === input.className)) {
    classes.push({
      name: input.className,
      type: "PREFERRED",
      originalIssuePrice: P,
      liquidationPrefMultiple: input.liquidationPrefMultiple ?? 1,
      participating: input.participating ?? false,
      seniority: input.seniority ?? 0,
    });
  }
  const holdings: Holding[] = ct.holdings.map((h) => ({ ...h }));
  const poolClass = ct.classes.find((c) => c.type === "OPTION_POOL")?.name ?? "Option Pool";
  if (!classes.some((c) => c.name === poolClass)) {
    classes.push({ name: poolClass, type: "OPTION_POOL", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 });
  }
  if (X > 0) holdings.push({ holder: "Option Pool", className: poolClass, shares: X });
  // Converting holders get shares in the new series (shadow series collapsed for simplicity).
  for (const c of conv) holdings.push({ holder: c.holder, className: input.className, shares: c.shares });
  for (const inv of input.investments) holdings.push({ holder: inv.holder, className: input.className, shares: inv.amount / P });

  const postShares = S0 + X + conv.reduce((a, c) => a + c.shares, 0) + N;
  return {
    capTable: { classes, holdings: mergeHoldings(holdings), convertibles: [], debt: ct.debt },
    pricePerShare: P,
    newMoneyShares: N,
    poolTopUpShares: X,
    conversionShares: conv,
    postMoney: P * postShares,
    iterations,
  };
}

function mergeHoldings(hs: Holding[]): Holding[] {
  const map = new Map<string, Holding>();
  for (const h of hs) {
    const k = `${h.holder}::${h.className}`;
    const prev = map.get(k);
    if (prev) prev.shares += h.shares;
    else map.set(k, { ...h });
  }
  return [...map.values()];
}

/** Secondary sale: shares move between holders; FD count unchanged. */
export function applySecondary(ct: CapTable, from: string, to: string, className: string, shares: number): CapTable {
  const src = ct.holdings.find((h) => h.holder === from && h.className === className);
  if (!src || src.shares < shares) throw new Error("Insufficient shares for secondary");
  const holdings = ct.holdings.map((h) => (h === src ? { ...h, shares: h.shares - shares } : { ...h }));
  holdings.push({ holder: to, className, shares });
  return { ...ct, holdings: mergeHoldings(holdings).filter((h) => h.shares > 0) };
}

/** Add a SAFE / note to be converted at the next priced round. */
export function addConvertible(ct: CapTable, c: Convertible): CapTable {
  return { ...ct, convertibles: [...ct.convertibles, c] };
}

export function addWarrant(ct: CapTable, holder: string, shares: number): CapTable {
  const classes = ct.classes.some((c) => c.type === "WARRANT")
    ? ct.classes
    : [...ct.classes, { name: "Warrants", type: "WARRANT" as const, originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 }];
  const warrantClass = classes.find((c) => c.type === "WARRANT")!.name;
  return { ...ct, classes, holdings: mergeHoldings([...ct.holdings, { holder, className: warrantClass, shares }]) };
}

export function addDebt(ct: CapTable, d: Debt): CapTable {
  return { ...ct, debt: [...ct.debt, d] };
}
