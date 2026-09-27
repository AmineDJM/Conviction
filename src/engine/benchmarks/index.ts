/**
 * Registry lookup. All published versions are listed here; the active
 * version is the default for new analyses. Historical analyses keep theirs.
 */
import type { BenchmarkRegistry } from "./types";
import { VC_BENCHMARK_V1_0 } from "./registry-v1_0";

export const REGISTRY_VERSIONS: Record<string, BenchmarkRegistry> = {
  [VC_BENCHMARK_V1_0.id]: VC_BENCHMARK_V1_0,
};

export const ACTIVE_REGISTRY_ID = VC_BENCHMARK_V1_0.id;

export function getRegistry(id: string = ACTIVE_REGISTRY_ID): BenchmarkRegistry {
  const r = REGISTRY_VERSIONS[id];
  if (!r) throw new Error(`Unknown benchmark registry version: ${id}`);
  return r;
}

export function listRegistries(): BenchmarkRegistry[] {
  return Object.values(REGISTRY_VERSIONS);
}

export type { BenchmarkRegistry } from "./types";
