/** GET /api/formation/profile — the user's skill profile, mastery metrics, weaknesses, mistakes and tendencies. */
import { apiSession } from "@/server/session";
import { overview } from "@/formation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const o = overview(s);
  const { attempts, ...rest } = o;
  return Response.json({ ...rest, attempts: attempts.length }, { headers: { "Cache-Control": "no-store" } });
}
