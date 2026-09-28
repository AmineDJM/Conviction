/** Human text for engine quality flags. Client- and server-safe. */
import { titleCase, type Tone } from "@/lib/format";

/** Human text for engine quality flags (normalize.ts / metrics/derive.ts). */
export function flagText(flag: string): { text: string; tone: Tone } {
  const code = flag.match(/^[A-Z0-9_]+/)?.[0] ?? flag;
  let rest = flag.slice(code.length).replace(/^[:\s]+/, "").trim();
  if (rest.startsWith("(") && rest.endsWith(")")) rest = rest.slice(1, -1);
  switch (code) {
    case "ANALYST_OVERRIDE":
      return { text: `Analyst override — ${rest || "value replaced by an analyst"} (raw extraction kept)`, tone: "neutral" };
    case "DEFINITION_NOT_STATED":
      return { text: "Definition not stated by the company", tone: "warn" };
    case "NO_AS_OF_DATE":
      return { text: "No as-of date disclosed", tone: "warn" };
    case "STALE":
      return { text: `Stale — ${rest.replace(/\(max (\d+)\)/, "(dictionary maximum $1)")}`, tone: "warn" };
    case "SAMPLE_SIZE_UNKNOWN":
      return { text: `Sample size not disclosed${rest ? ` — ${rest.replace("min", "minimum")} required` : ""}`, tone: "warn" };
    case "SMALL_SAMPLE":
      return { text: `Small sample — ${rest.replace("<", "below minimum")}`, tone: "warn" };
    case "CAC_LOADING_UNVERIFIED":
      return { text: "CAC loading unverified — not shown to be fully loaded (salaries, commissions, founder selling time)", tone: "warn" };
    case "COGS_COMPOSITION_UNVERIFIED":
      return { text: "COGS composition unverified — hosting, inference, support and delivery costs not confirmed", tone: "warn" };
    case "EXTRACTION_MISMATCH":
      return { text: `Extraction mismatch — ${rest}`, tone: "risk" };
    case "VALUE_FROM_RAW_TEXT":
      return { text: "Value parsed deterministically from the raw text", tone: "neutral" };
    case "FRACTION_CONVERTED_TO_PERCENT":
      return { text: "Fraction converted to percent", tone: "neutral" };
    case "UNSUPPORTED_CURRENCY":
      return { text: `Unsupported currency — ${rest}; value not normalized`, tone: "risk" };
    case "MONTHLY_FIGURE_LABELLED_ARR":
      return { text: "Monthly figure labelled ARR — annualized ×12; treat as run-rate", tone: "warn" };
    case "INCONSISTENT_WITH_INPUTS":
      return { text: `Inconsistent with its own inputs — ${rest}`, tone: "risk" };
    case "BURN_ASSUMED_CONSTANT_OVER_PERIOD":
      return { text: "Burn assumed constant over the period", tone: "neutral" };
    case "RUN_RATE_FROM_MRR":
      return { text: "Run-rate derived from MRR × 12", tone: "neutral" };
    case "MEAN_NOT_MEDIAN":
      return { text: "Mean, not median — skewed by large accounts", tone: "neutral" };
    default:
      if (code === "FX_CONVERTED") return { text: `Currency converted: ${rest}`, tone: "neutral" };
      return { text: titleCase(code) + (rest ? ` — ${rest}` : ""), tone: "warn" };
  }
}

