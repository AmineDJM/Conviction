/**
 * GET /api/integrations/:provider/callback?code&state (or ?error) — the OAuth
 * redirect URI registered with Zoom / Google. Validates the state (single-use,
 * unexpired, issued to this session), exchanges the code, stores the tokens
 * encrypted and returns to the page that started the flow. Tokens never reach
 * the browser; the URL with the code is not echoed anywhere.
 */
import { IntegrationError, integrationErrorCode } from "@/server/connectors/http";
import { SPECS } from "@/server/connectors/meeting-connectors";
import { completeAuthorization } from "@/server/connectors/oauth";
import { logger } from "@/lib/log";
import { currentActor, providerParam, redirectTo, withParams } from "../../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerParam((await params).provider);
  if (!provider) return Response.json({ error: "Unknown integration" }, { status: 404 });
  const actor = await currentActor();
  if (!actor) return redirectTo("/login");
  const q = new URL(req.url).searchParams;
  try {
    const { returnTo } = await completeAuthorization(provider, actor, { state: q.get("state"), code: q.get("code"), error: q.get("error") });
    return redirectTo(withParams(returnTo, { integration: provider, integration_result: "connected" }));
  } catch (e) {
    const back = (e as { returnTo?: string }).returnTo ?? "/settings?tab=integrations";
    if (!(e instanceof IntegrationError)) logger.error({ provider, err: (e as Error)?.name }, "integration callback failed");
    return redirectTo(withParams(back, { integration: provider, integration_error: integrationErrorCode(e) }));
  }
}
