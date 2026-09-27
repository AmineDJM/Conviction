/** CLI: ask the Fund Brain a question.  npx tsx scripts/ask.ts "question" [contextCompanySlug] */
import { ensureDevWorkspace } from "./seed-lib";
import { askBrain } from "../src/brain/chat";
import { getCompany } from "../src/server/repo";

async function main() {
  const { workspaceId, userId } = ensureDevWorkspace();
  const ctx = process.argv[3] ? getCompany(workspaceId, process.argv[3])?.id : null;
  const t0 = Date.now();
  for await (const ev of askBrain({ workspaceId, userId, question: process.argv[2]!, contextCompanyId: ctx })) {
    if (ev.type === "delta") process.stdout.write(ev.text);
    else if (ev.type === "plan") console.log(`[plan ${ev.ms}ms] ${ev.plan.intent} ${ev.plan.complexity} companies=${ev.plan.companyIds.length} filters=${JSON.stringify(ev.plan.metricFilters)} rank=${JSON.stringify(ev.plan.rank)}`);
    else if (ev.type === "citations") console.log(`[context] ${ev.items.map((i) => `[${i.n}] ${i.title.slice(0, 60)}`).join(" | ")}`);
    else if (ev.type === "done") console.log(`\n[done] first token ${ev.firstTokenMs}ms, total ${ev.latencyMs}ms, $${ev.costUsd.toFixed(4)}`);
    else if (ev.type === "error") console.log(`\n[error] ${ev.message}`);
  }
  void t0;
}
main();
