/**
 * Model and tool pricing (USD). Source: OpenAI published API pricing as of
 * 2026-09 (GPT-5.6 Luna: $0.20 / 1M input, $0.02 / 1M cached input,
 * $1.20 / 1M output; web search $10 / 1k calls + search content tokens at the
 * model input rate). Verify when upgrading models — the cost controller is
 * only as accurate as this table.
 */
export interface ModelPrice {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-luna": { inputPerM: 0.2, cachedInputPerM: 0.02, outputPerM: 1.2 },
  "gpt-5.6-terra": { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 12 },
  "text-embedding-3-small": { inputPerM: 0.02, cachedInputPerM: 0.02, outputPerM: 0 },
};

export const WEB_SEARCH_PER_CALL_USD = 0.01;
/** Conservative allowance for search-result tokens injected per web search call. */
export const WEB_SEARCH_CONTENT_TOKENS_ESTIMATE = 12_000;

export function priceFor(model: string): ModelPrice {
  const p = MODEL_PRICES[model];
  if (!p) throw new Error(`No pricing configured for model ${model}; refusing to run without cost control.`);
  return p;
}

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearches: number;
}

export function costOf(model: string, u: Usage): number {
  const p = priceFor(model);
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens);
  return (
    (uncached * p.inputPerM + u.cachedTokens * p.cachedInputPerM + u.outputTokens * p.outputPerM) / 1e6 +
    u.webSearches * WEB_SEARCH_PER_CALL_USD
  );
}

/** Rough token estimate for budgeting (conservative: 3.2 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/** Worst-case cost of a call before it runs. */
export function worstCaseCost(model: string, inputChars: number, maxOutputTokens: number, maxWebSearches = 0): number {
  const p = priceFor(model);
  const inputTokens = Math.ceil(inputChars / 3.2) + maxWebSearches * WEB_SEARCH_CONTENT_TOKENS_ESTIMATE;
  return (inputTokens * p.inputPerM + maxOutputTokens * p.outputPerM) / 1e6 + maxWebSearches * WEB_SEARCH_PER_CALL_USD;
}
