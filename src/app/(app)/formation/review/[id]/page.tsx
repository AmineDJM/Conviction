import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { getReveal } from "@/formation/service";
import { RevealView } from "@/components/formation/reveal-view";
import { KIND_LABEL } from "@/formation/labels";
import { Button } from "@/components/ui";

export const metadata = { title: "Review · Formation" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const r = getReveal(s, (await params).id);
  if (!r) notFound();
  return (
    <div className="space-y-5">
      <div>
        <div className="t-eyebrow">
          {KIND_LABEL[r.exercise.kind]} · {r.exercise.case.name}
        </div>
        <h2 className="t-section mt-1 text-[17px]">{r.exercise.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{r.exercise.prompt}</p>
      </div>
      <RevealView reveal={r} />
      <div className="flex gap-2 border-t border-line pt-4">
        <Button href="/formation/practice" variant="primary">
          Continue practice
        </Button>
        <Button href="/formation/journal" variant="ghost">
          Journal
        </Button>
      </div>
    </div>
  );
}
