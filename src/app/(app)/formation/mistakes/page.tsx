import Link from "next/link";
import { requireSession } from "@/server/session";
import { overview } from "@/formation/service";
import { Badge, Button, Empty } from "@/components/ui";
import { MISTAKE_DRILL, RECURRING_AT } from "@/formation/mistakes";
import { CONCEPT_LABEL, KIND_LABEL } from "@/formation/labels";

export const metadata = { title: "Mistake library · Formation" };

export default async function MistakesPage() {
  const s = await requireSession();
  const o = overview(s);
  if (!o.mistakes.length)
    return (
      <Empty title="No mistakes recorded" action={<Button href="/formation/practice" variant="primary">Practice</Button>}>
        Mistakes are classified automatically from your graded answers — overvalued TAM, ignored churn, pedigree over capability, growth mistaken for PMF and more — each with the evidence. This library is private to you.
      </Empty>
    );
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[13px] text-ink-2">
        Private to you. Classified automatically from graded answers, each with its evidence. A mistake becomes recurring at {RECURRING_AT} occurrences and then drives targeted drills — one in every four exercises, or on demand.
      </p>
      <div className="space-y-5">
        {o.mistakes.map((m) => {
          const drill = MISTAKE_DRILL[m.kind];
          return (
            <section key={m.kind} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-medium text-ink">{m.label}</h3>
                <Badge tone={m.recurring ? "risk" : "neutral"}>{m.recurring ? `Recurring · ${m.count}×` : `${m.count}×`}</Badge>
                <span className="text-[12px] text-ink-3">{m.cases.join(", ")}</span>
                <Button href={`/formation/practice?drill=${m.kind}`} size="sm" className="ml-auto">
                  Drill this
                </Button>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-3">
                Drill practises {drill.concepts.length ? drill.concepts.map((c) => CONCEPT_LABEL[c]).join(", ") : "the underlying skill"} through {drill.kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(", ")}.
              </p>
              <ul className="mt-2 divide-y divide-line border-t border-line">
                {m.occurrences.slice(0, 6).map((x) => (
                  <li key={x.attemptId + x.kind} className="py-2 text-[12.5px]">
                    <div className="flex flex-wrap gap-x-3 text-ink-3">
                      <span className="text-ink-2">{x.caseName}</span>
                      <span>{x.exerciseTitle}</span>
                      <span className="num ml-auto">{x.at.slice(0, 10)}</span>
                    </div>
                    <p className="mt-0.5 text-ink-2">{x.evidence}</p>
                    <Link href={`/formation/review/${x.attemptId}`} className="text-[12px] text-accent-text hover:underline">
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
