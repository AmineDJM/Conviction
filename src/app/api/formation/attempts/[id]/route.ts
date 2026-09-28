/** GET /api/formation/attempts/:id — the reveal of one of the user's own past attempts. */
import { apiSession } from "@/server/session";
import { getReveal } from "@/formation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const r = getReveal(s, (await params).id);
  return r ? Response.json(r, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Not found" }, { status: 404 });
}
