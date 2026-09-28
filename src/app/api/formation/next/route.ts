/**
 * GET /api/formation/next — the next exercise for the signed-in user.
 * Returns ONLY the pre-answer payload (publicExercise): deck facts, prompt and
 * answer input. Nothing from the analysis or the answer key.
 *   ?case=<companyId|slug>  ?kind=<ExerciseKind>  ?drill=<MistakeKind>  ?expert=1|0
 */
import { apiSession } from "@/server/session";
import { nextExercise } from "@/formation/service";
import { EXERCISE_KINDS, type ExerciseKind } from "@/formation/types";
import { MISTAKE_KINDS, type MistakeKind } from "@/formation/mistakes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  const drill = q.get("drill");
  const expert = q.get("expert");
  const res = nextExercise(s, {
    caseId: q.get("case")?.slice(0, 64) || null,
    kind: kind && (EXERCISE_KINDS as readonly string[]).includes(kind) ? (kind as ExerciseKind) : null,
    drill: drill && (MISTAKE_KINDS as readonly string[]).includes(drill) ? (drill as MistakeKind) : null,
    expert: expert === "1" ? true : expert === "0" ? false : null,
  });
  if (!res) return Response.json({ error: "No exercise available. Analyse a deal first — every analysed deal becomes a training case." }, { status: 404 });
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
