/**
 * POST /api/analyze/match { name?, url?, filenames[] } → { matches }
 * Before an upload starts: does it look like a company already on record? Deterministic
 * (engine/company-match.ts). The upload form ASKS the user; nothing is merged here.
 */
import { z } from "zod";
import { apiSession } from "@/server/session";
import { uploadMatches } from "@/server/company-merge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ name: z.string().max(200).nullish(), url: z.string().max(500).nullish(), filenames: z.array(z.string().max(300)).max(20).default([]) });

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  return Response.json({ matches: uploadMatches(s.workspaceId, parsed.data) });
}
