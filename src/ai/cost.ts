/**
 * §8 COST CONTROLLER — enforced by software, not by prompting.
 *
 * Every model call must be authorized with a worst-case estimate before it
 * runs. If the projected total would exceed the hard cap the call is refused
 * and the caller must degrade to a PARTIAL analysis.
 */
import { costOf, worstCaseCost, type Usage } from "./pricing";

export interface CostEntry {
  step: string;
  model: string;
  promptVersion: string | null;
  usage: Usage;
  estimatedUsd: number;
  actualUsd: number;
  latencyMs: number;
  toolCalls: number;
}

export interface Reservation {
  amount: number;
  open: boolean;
}

export class BudgetExceededError extends Error {
  constructor(
    public step: string,
    public projectedUsd: number,
    public capUsd: number,
  ) {
    super(`Budget: step "${step}" would bring projected cost to $${projectedUsd.toFixed(4)} (cap $${capUsd.toFixed(2)})`);
  }
}

export const MODE_BUDGETS = {
  FAST_SCREEN: { targetUsd: 0.08, hardCapUsd: 0.1 },
  STANDARD: { targetUsd: 0.25, hardCapUsd: 0.5 },
  /** Deep DD is launched intentionally; it has a larger, explicit cap. */
  DEEP_DD: { targetUsd: 1.5, hardCapUsd: 3 },
} as const;

export const ABSOLUTE_STANDARD_CAP_USD = 0.5;

export class CostController {
  readonly entries: CostEntry[] = [];
  private reservedUsd = 0;
  /** Worst-case estimates of calls currently in flight (parallel calls cannot jointly exceed the cap). */
  private inflightUsd = 0;

  constructor(
    readonly hardCapUsd: number,
    readonly targetUsd: number,
    private onRecord?: (e: CostEntry) => void | Promise<void>,
  ) {
    if (!(hardCapUsd > 0)) throw new Error("Hard cap must be positive");
  }

  get spentUsd() {
    return this.entries.reduce((a, e) => a + e.actualUsd, 0);
  }

  get remainingUsd() {
    return Math.max(0, this.hardCapUsd - this.spentUsd - this.reservedUsd - this.inflightUsd);
  }

  /** Remaining room under the soft target (used for planning optional research). */
  get remainingTargetUsd() {
    return Math.max(0, this.targetUsd - this.spentUsd - this.reservedUsd - this.inflightUsd);
  }

  /** Reserve budget for mandatory later steps so optional steps cannot starve them. */
  reserve(usd: number): Reservation {
    this.reservedUsd += usd;
    return { amount: usd, open: true };
  }

  /** Release a reservation that was not used. Idempotent. */
  release(r: Reservation | null | undefined) {
    if (!r || !r.open) return;
    r.open = false;
    this.reservedUsd = Math.max(0, this.reservedUsd - r.amount);
  }

  canAfford(worstCaseUsd: number, reservation?: Reservation | null) {
    const credit = reservation?.open ? reservation.amount : 0;
    return this.spentUsd + this.reservedUsd + this.inflightUsd - credit + worstCaseUsd <= this.hardCapUsd + 1e-12;
  }

  /**
   * Throws BudgetExceededError if the worst case does not fit. On success the
   * worst case is held in flight until `record()` is called with the same estimate.
   * A step-level reservation made earlier is converted into the in-flight hold.
   */
  authorize(step: string, model: string, inputChars: number, maxOutputTokens: number, maxWebSearches = 0, reservation?: Reservation | null): number {
    return this.authorizeAmount(step, worstCaseCost(model, inputChars, maxOutputTokens, maxWebSearches), reservation);
  }

  /**
   * Same contract as `authorize` for calls priced outside the token table
   * (audio transcription): the caller supplies the worst-case amount; `record`
   * must then pass an explicit `actualUsd`.
   */
  authorizeAmount(step: string, est: number, reservation?: Reservation | null): number {
    if (!this.canAfford(est, reservation)) {
      const credit = reservation?.open ? reservation.amount : 0;
      throw new BudgetExceededError(step, this.spentUsd + this.reservedUsd + this.inflightUsd - credit + est, this.hardCapUsd);
    }
    this.release(reservation);
    this.inflightUsd += est;
    return est;
  }

  /** How many web searches fit in `allowanceUsd` alongside a call of the given size. */
  maxSearchesWithin(model: string, allowanceUsd: number, inputChars: number, maxOutputTokens: number, ceiling: number): number {
    let n = ceiling;
    while (n > 0 && worstCaseCost(model, inputChars, maxOutputTokens, n) > allowanceUsd) n--;
    return n;
  }

  async record(e: Omit<CostEntry, "actualUsd"> & { actualUsd?: number }) {
    const entry: CostEntry = { ...e, actualUsd: e.actualUsd ?? costOf(e.model, e.usage) };
    this.inflightUsd = Math.max(0, this.inflightUsd - e.estimatedUsd);
    this.entries.push(entry);
    await this.onRecord?.(entry);
    return entry;
  }
}
