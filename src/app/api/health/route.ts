import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

/** Render health check: the process is up and the database (on the persistent disk) is reachable. */
export async function GET() {
  try {
    getDb().$client.prepare("select 1").get();
    return Response.json({ ok: true, openaiConfigured: !!process.env.OPENAI_API_KEY });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
