/** Runs once when the Node.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverInterruptedRuns } = await import("./server/recovery");
  try {
    recoverInterruptedRuns();
  } catch (e) {
    console.error("startup recovery failed", e);
  }
}
