import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "./session";
import * as repo from "./repo";
import { getRegistry } from "@/engine/benchmarks";

/** Loads everything a deal page needs, once per request. */
export const loadDeal = cache(async (slug: string) => {
  const session = await requireSession();
  const company = repo.getCompany(session.workspaceId, decodeURIComponent(slug));
  if (!company) notFound();
  const version = repo.getCurrentVersion(company);
  const run = repo.latestRun(company.id);
  const fund = repo.getDefaultFund(session.workspaceId);
  const registry = getRegistry(version?.row.registryId);
  return { session, company, version, run, fund, registry };
});

export type LoadedDeal = Awaited<ReturnType<typeof loadDeal>>;
