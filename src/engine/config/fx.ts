/**
 * Static FX table used to normalize currency amounts to USD.
 * Type: MODEL_ASSUMPTION. Versioned with the benchmark registry; every
 * conversion records the rate and date in the metric's quality flags.
 */
export const FX_TABLE = {
  asOf: "2026-09-01",
  note: "Approximate spot rates, USD per unit of currency. Model assumption; replace with a rates feed in production.",
  rates: {
    EUR: 1.1,
    GBP: 1.3,
    CHF: 1.15,
    CAD: 0.73,
    AUD: 0.66,
    JPY: 0.0068,
    SEK: 0.095,
    NOK: 0.093,
    DKK: 0.147,
    INR: 0.012,
    SGD: 0.77,
    ILS: 0.27,
    BRL: 0.18,
    CNY: 0.14,
    HKD: 0.128,
    AED: 0.272,
    PLN: 0.255,
  } as Record<string, number>,
};
