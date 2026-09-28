/**
 * Markers an analyst override leaves on a metric, and the single predicate
 * every view uses to say "this value was corrected by a person". Dependency
 * free so client components can import it.
 *
 * One correction model: analyst overrides (engine/overrides.ts). Legacy
 * USER_CORRECTED instances are upgraded to overrides on read
 * (engine/override-carry.ts#upgradeLegacyCorrections); the few that cannot be
 * upgraded (no identifiable original) keep their method and still count here.
 */
import type { MetricInstance } from "@/domain/canonical";

export const OVERRIDE_FLAG = "ANALYST_OVERRIDE";
export const OVERRIDE_STEP = "OVERRIDE";
export const OVERRIDE_PROPAGATED_STEP = "OVERRIDE_PROPAGATED";

/** True when the metric's current value comes from an analyst override. */
export function isOverridden(m: Pick<MetricInstance, "lineage" | "qualityFlags">): boolean {
  return (m.qualityFlags ?? []).some((f) => f.startsWith(OVERRIDE_FLAG)) || (m.lineage ?? []).some((l) => l.step === OVERRIDE_STEP);
}

/** True when a person set this value: an analyst override, or a legacy correction that could not be upgraded. */
export function isAnalystCorrected(m: Pick<MetricInstance, "lineage" | "qualityFlags" | "calculationMethod">): boolean {
  return m.calculationMethod === "USER_CORRECTED" || isOverridden(m);
}

/** True when a derived metric was recomputed from an overridden input. */
export function isOverridePropagated(m: Pick<MetricInstance, "lineage">): boolean {
  return (m.lineage ?? []).some((l) => l.step === OVERRIDE_PROPAGATED_STEP);
}
