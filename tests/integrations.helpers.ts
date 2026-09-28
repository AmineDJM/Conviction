/** Shared setup for tests/integrations.*.test.ts (mock provider server, a deal with a version, a signed-in actor). */
import { vi } from "vitest";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import { createSession, createWorkspaceWithOwner, unsignSession } from "@/server/auth";
import * as repo from "@/server/repo";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import type { Actor } from "@/server/connectors/oauth";
import { makeDeal } from "./fixtures";

/** A valid, empty post-meeting extraction: the workflow completes without changing the record. */
export function emptyExtraction(): FounderCallOutput {
  return {
    discussed: [],
    questionUpdates: [],
    claimUpdates: [],
    metricClarifications: [],
    newClaims: [],
    newMetrics: [],
    contradictions: [],
    gapUpdates: [],
    rubricUpdates: [],
    capabilityUpdates: [],
    conditionUpdates: [],
    riskUpdates: [],
    recommendation: { suggestedStatus: "NEEDS_TARGETED_DILIGENCE", rationale: "Verify CAC with references.", watch: null },
    nextAction: { action: "Call two enterprise customers", rationale: "Tests the sales motion", type: "REFERENCE_CALLS" },
    summary: "Imported meeting processed.",
  };
}

export function stubStructured(mocked: ReturnType<typeof vi.fn>) {
  mocked.mockImplementation(async (call: { schemaName: string }) => {
    if (call.schemaName === "founder_call_update") return { data: emptyExtraction(), usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, searchSources: [], searchQueries: [], latencyMs: 1, attempts: 1, cached: false };
    throw new Error(`unexpected schema ${call.schemaName}`);
  });
}

export function setupWorkspace() {
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
  const company = repo.createCompany(workspaceId, "Acme AI");
  const deal = makeDeal();
  const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE);
  repo.saveVersion({ company, canonical: deal, derived, reason: "DECK_ANALYSIS", summary: "deck" });
  return { workspaceId, userId, company: repo.getCompany(workspaceId, company.id)! };
}

/** A new server session for the user → the actor the route handlers would build. */
export function actorFor(ctx: { workspaceId: string; userId: string }, role: Actor["role"] = "OWNER"): Actor {
  const { cookie } = createSession(ctx.userId, ctx.workspaceId);
  return { workspaceId: ctx.workspaceId, userId: ctx.userId, role, sessionId: unsignSession(cookie)! };
}

/** Follow the mock's auto-consent redirect: returns the code and state the provider sends back to redirect_uri. */
export async function consent(authorizeUrl: string): Promise<{ code: string; state: string; redirect: URL }> {
  const res = await fetch(authorizeUrl, { redirect: "manual" });
  if (res.status !== 302) throw new Error(`authorize returned ${res.status}: ${await res.text()}`);
  const redirect = new URL(res.headers.get("location")!);
  return { code: redirect.searchParams.get("code")!, state: redirect.searchParams.get("state")!, redirect };
}
