/**
 * Deterministic root finding for monotone functions. Every breakpoint in the
 * economics engine goes through `bisect`: a bracketing solver (Illinois
 * regula falsi with a bisection safeguard) — as robust as bisection, but
 * superlinear on the smooth, kinked functions of a cap-table model, which
 * keeps counterfactuals interactive.
 */

export interface BisectOptions {
  iterations?: number;
  /** Solve in log space (for strictly positive, scale-free variables such as valuations). */
  log?: boolean;
  /** Stop when the bracket is narrower than this, relative to the root. */
  relTol?: number;
}

/**
 * Root of `f` on [lo, hi], given f(lo) and f(hi) of opposite signs (or zero).
 * Returns null when the root is not bracketed or `f` is not finite at the ends.
 */
export function bisect(f: (x: number) => number, lo: number, hi: number, opts: BisectOptions = {}): number | null {
  const iterations = opts.iterations ?? 100;
  const relTol = opts.relTol ?? 1e-9;
  const log = opts.log ?? false;
  if (log && !(lo > 0 && hi > 0)) return null;
  const X = (u: number) => (log ? Math.exp(u) : u);
  let a = log ? Math.log(lo) : lo;
  let b = log ? Math.log(hi) : hi;
  let fa = f(X(a));
  let fb = f(X(b));
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return X(a);
  if (fb === 0) return X(b);
  if (fa * fb > 0) return null;
  let width = Math.abs(b - a);
  let slow = 0;
  for (let i = 0; i < iterations; i++) {
    // Illinois step, or plain bisection when the bracket is not shrinking fast enough.
    let c = slow >= 2 ? (a + b) / 2 : b - (fb * (b - a)) / (fb - fa);
    if (!Number.isFinite(c) || c <= Math.min(a, b) || c >= Math.max(a, b)) c = (a + b) / 2;
    const fc = f(X(c));
    if (fc === 0 || !Number.isFinite(fc)) return Number.isFinite(fc) ? X(c) : null;
    if (fc * fb < 0) {
      a = b;
      fa = fb;
    } else fa /= 2;
    b = c;
    fb = fc;
    const w = Math.abs(b - a);
    slow = w > 0.5 * width ? slow + 1 : 0;
    width = w;
    const xa = X(a);
    const xb = X(b);
    if (Math.abs(xb - xa) <= relTol * Math.max(Math.abs(xb), 1e-12)) break;
  }
  return X(b);
}

/** Smallest x in [lo, ∞) with g(x) ≥ target for a non-decreasing g (doubling, then bracketed solve). */
export function solveIncreasing(g: (x: number) => number, target: number, lo: number, hint: number, opts: BisectOptions = {}): number | null {
  if (g(lo) >= target) return lo;
  let prev = lo;
  let hi = Math.max(hint, lo + 1);
  let k = 0;
  while (g(hi) < target && k < 200) {
    prev = hi;
    hi *= 2;
    k++;
  }
  if (g(hi) < target) return null;
  return bisect((x) => g(x) - target, prev, hi, { iterations: opts.iterations ?? 100, relTol: opts.relTol ?? 1e-10 });
}

export interface MonotoneSolution {
  root: number | null;
  /** Set when no root exists in [lo, hi]: the sign never changes. */
  outOfRange: "BELOW_LO" | "ABOVE_HI" | null;
}

/**
 * Root of a monotone `f` on [lo, hi], bracketed by expanding geometrically
 * from a good initial guess (cheap when the guess is close), then solved with
 * `bisect`. For an increasing f: outOfRange "BELOW_LO" means f(lo) > 0 (root
 * would lie below lo); "ABOVE_HI" means f(hi) < 0. Mirrored for decreasing f.
 */
export function solveMonotone(
  f: (x: number) => number,
  guess: number,
  lo: number,
  hi: number,
  opts: BisectOptions & { increasing: boolean },
): MonotoneSolution {
  const g = opts.increasing ? f : (x: number) => -f(x);
  const log = opts.log ?? false;
  if (log && !(lo > 0)) return { root: null, outOfRange: null };
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
  let x0 = clamp(Number.isFinite(guess) ? guess : (lo + hi) / 2);
  const g0 = g(x0);
  if (!Number.isFinite(g0)) return { root: null, outOfRange: null };
  if (g0 === 0) return { root: x0, outOfRange: null };
  const up = g0 < 0; // increasing g below zero → root is above x0
  let factor = 1.25;
  let delta = (hi - lo) * 0.02;
  for (let k = 0; k < 200; k++) {
    const x1 = clamp(log ? (up ? x0 * factor : x0 / factor) : up ? x0 + delta : x0 - delta);
    const g1 = g(x1);
    if (!Number.isFinite(g1)) return { root: null, outOfRange: null };
    if ((up && g1 >= 0) || (!up && g1 <= 0)) {
      const root = bisect(g, Math.min(x0, x1), Math.max(x0, x1), opts);
      return { root, outOfRange: null };
    }
    if (x1 === (up ? hi : lo)) return { root: null, outOfRange: up ? "ABOVE_HI" : "BELOW_LO" };
    x0 = x1;
    factor *= factor;
    delta *= 2;
  }
  return { root: null, outOfRange: up ? "ABOVE_HI" : "BELOW_LO" };
}
