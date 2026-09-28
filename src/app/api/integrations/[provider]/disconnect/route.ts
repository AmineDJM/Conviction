/** POST /api/integrations/:provider/disconnect — revoke at the provider (best effort) and delete your stored tokens. Audited. */
import { disconnect } from "@/server/connectors/oauth";
import { crossSite, currentActor, errorResponse, providerParam } from "../../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerParam((await params).provider);
  if (!provider) return Response.json({ error: "Unknown integration" }, { status: 404 });
  if (crossSite(req)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await disconnect(provider, actor));
  } catch (e) {
    return errorResponse(e, "disconnect");
  }
}
