/**
 * Freshness of a source, from the integrity engine's computed source age
 * (months between publication and the deal's reference date; STALE above 18
 * months, UNKNOWN_DATE when undated). Client- and server-safe.
 */
import { Badge } from "@/components/ui";

/** Freshness from the integrity engine's source age (months before the deal's reference date; stale above 18). */
export function FreshnessBadge({ ageMonths, flags }: { ageMonths: number | null; flags: string[] }) {
  if (flags.includes("UNKNOWN_DATE") || ageMonths === null)
    return (
      <Badge tone="unknown" title="No publication date: freshness cannot be established">
        Undated
      </Badge>
    );
  if (flags.includes("STALE"))
    return (
      <Badge tone="risk" title="Older than 18 months before the analysis date">
        Stale · {Math.round(ageMonths)} mo
      </Badge>
    );
  return (
    <Badge tone="ok" title="Within 18 months of the analysis date (months between publication and the analysis date)">
      Current · {Math.round(ageMonths)} mo
    </Badge>
  );
}

