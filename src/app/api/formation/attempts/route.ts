/**
 * POST /api/formation/attempts — submit an answer with stated confidence.
 * The answer is stored immutably BEFORE grading; the response is the reveal
 * (grade, answer key, AI analysis, evidence, alternative reasoning).
 */
import { apiSession } from "@/server/session";
import { SubmitSchema } from "@/formation/answer-schema";
import { FormationError, submitAnswer } from "@/formation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const parsed = SubmitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  try {
    return Response.json(await submitAnswer(s, parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof FormationError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
