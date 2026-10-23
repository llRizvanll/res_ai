// Restaurant benchmarks behind the advice on Growth & insights and the highlights on Profit & Loss.
// Tune them here; server advice and browser colouring both read this file.
export const BENCHMARKS = Object.freeze({
  /** Healthy food cost as % of net sales */
  foodCostPct: { low: 28, high: 35 },
  /** Healthy net margin as % of revenue */
  netMarginPct: { low: 10, high: 20 },
  /** Operating expenses above this % of revenue get flagged */
  expenseRatioWarnPct: 45,
  /** Monthly sales trend (±%) that counts as clearly up or down */
  trendSignificantPct: 3,
  /** Average-bill change (±%) worth mentioning */
  aovChangePct: 5,
  /** Revenue within this multiple of break-even is "only just above" */
  breakEvenCushion: 1.15,
  /** Below this % of bills with a customer attached, suggest capturing phone numbers */
  taggedShareMinPct: 40,
  /** Repeat-customer rate worth celebrating */
  repeatRateGoodPct: 40,
  /** Channel growth (%) worth a suggestion */
  channelGrowthPct: 15,
});
