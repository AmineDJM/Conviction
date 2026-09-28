/**
 * GET /api/integrations/:provider/connect?returnTo=/path — start the OAuth
 * authorization-code flow (PKCE + state bound to this session) and redirect to
 * the provider's consent screen. Errors return to Settings with a message.
 */
import { headers } from "next/headers";
import { IntegrationError, integrationErrorCode } from "@/server/connectors/http";
import { appOrigin } from "@/server/connectors/meeting-connectors";
import { beginAuthorization, safeReturnTo } from "@/server/connectors/oauth";
import { currentActor, providerParam, redirectTo, withParams } from "../../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerParam((await params).provider);
  if (!provider) return Response.json({ error: "Unknown integration" }, { status: 404 });
  const actor = await currentActor();
  if (!actor) return redirectTo("/login");
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  try {
    const { url } = beginAuthorization(provider, actor, { origin: appOrigin(await headers()), returnTo });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (e) {
    return redirectTo(withParams("/settings?tab=integrations", { integration: provider, integration_error: integrationErrorCode(e) }));
  }
}
