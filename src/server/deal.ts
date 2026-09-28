import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "./session";
import * as repo from "./repo";
import { getRegistry } from "@/engine/benchmarks";
import { applyOverrides } from "@/engine/overrides";

/** Loads everything a deal page needs, once per request. */
export const loadDeal = cache(async (slug: string) => {
  const session = await requireSession();
  const company = repo.getCompany(session.workspaceId, safeDecode(slug));
  if (!company) {
    // A dossier merged into another company (as a new deck version) redirects there.
    const target = repo.mergedTarget(session.workspaceId, safeDecode(slug));
    if (target) redirect(`/deals/${target.slug}?merged=1`);
    notFound();
  }
  const stored = repo.getCurrentVersion(company);
  // Pages display the effective deal (raw extraction + analyst overrides) — the same object derive() scored.
  // `rawCanonical` keeps the untouched extraction for "company reported X · override Y". Display only: never persist it back.
  const version = stored ? { ...stored, canonical: applyOverrides(stored.canonical), rawCanonical: stored.canonical } : null;
  const run = repo.latestRun(company.id);
  const fund = repo.getDefaultFund(session.workspaceId);
  const registry = getRegistry(version?.row.registryId);
  return { session, company, version, run, fund, registry };
});

export type LoadedDeal = Awaited<ReturnType<typeof loadDeal>>;

/** Route params arrive decoded; a slug that still contains "%" must not throw. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
