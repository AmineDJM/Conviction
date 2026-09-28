import { getDb } from "@/db/client";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Render health check (render.yaml healthCheckPath): the process is up and the database (on the persistent disk) is reachable. Status only — details go to the server log. */
export async function GET() {
  try {
    getDb().$client.prepare("select 1").get();
    return Response.json({ ok: true, openaiConfigured: !!process.env.OPENAI_API_KEY });
  } catch (e) {
    logger.error({ err: (e as Error).message }, "health check: database unavailable");
    return Response.json({ ok: false, error: "Database unavailable" }, { status: 503 });
  }
}
