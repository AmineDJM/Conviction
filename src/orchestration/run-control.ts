/**
 * In-process run control: cancellation and a bounded analysis queue.
 * One AbortController per run; every model call and phase boundary observes it.
 * The queue bounds concurrent analyses so a batch of 100 decks degrades into
 * a queue instead of hammering the model API or SQLite.
 */
const controllers = new Map<string, AbortController>();

export function registerRun(runId: string): AbortSignal {
  const c = new AbortController();
  controllers.set(runId, c);
  return c.signal;
}

export function cancelRun(runId: string): boolean {
  const c = controllers.get(runId);
  if (!c) return false;
  c.abort(new Error("Cancelled by user"));
  return true;
}

export function releaseRun(runId: string) {
  controllers.delete(runId);
}

export function isRunLive(runId: string) {
  return controllers.has(runId);
}

export class CancelledError extends Error {
  constructor() {
    super("Analysis cancelled");
  }
}

export function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new CancelledError();
}

/* ------------------------------ Queue ------------------------------ */

const MAX = Math.max(1, Number(process.env.MAX_CONCURRENT_ANALYSES ?? 4));
let active = 0;
const waiting: { resolve: () => void; reject: (e: Error) => void; signal: AbortSignal }[] = [];

export function queueStats() {
  return { active, waiting: waiting.length, max: MAX };
}

export async function acquireSlot(signal: AbortSignal): Promise<void> {
  if (active < MAX) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const entry = { resolve, reject, signal };
    waiting.push(entry);
    signal.addEventListener(
      "abort",
      () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new CancelledError());
      },
      { once: true },
    );
  });
  active++;
}

export function releaseSlot() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) next.resolve();
}
