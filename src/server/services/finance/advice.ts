// Plain-language suggestions from the numbers; each one says why. Thresholds live in shared/benchmarks.ts.
import { BENCHMARKS as B } from '../../../shared/benchmarks.js';
import { config } from '../../config.js';

export type Tone = 'good' | 'warn' | 'bad' | 'info';
export interface Advice {
  tone: Tone;
  text: string;
}
export interface AdviceInput {
  kpis: Record<string, number | null>;
  weekdays: { day: string; avg_sales: number }[];
  falling: { name: string; change: number | null }[];
  trendPct: number | null;
  breakEven: { breakEvenDaily: number; avgDailyRevenue30: number };
  channels: { type: string; change: number | null }[];
  currency: string;
}

export function advice({ kpis: k, weekdays, falling, trendPct, breakEven: be, channels, currency }: AdviceInput): Advice[] {
  const out: Advice[] = [];
  const amt = (n: number) => `${currency}${Math.round(n).toLocaleString(config.locale)}`;
  if (trendPct !== null) {
    if (trendPct >= B.trendSignificantPct) out.push({ tone: 'good', text: `Sales are trending up about ${trendPct}% a month. Make sure stock and staff keep pace on busy days.` });
    else if (trendPct <= -B.trendSignificantPct) out.push({ tone: 'bad', text: `Sales are trending down about ${Math.abs(trendPct)}% a month. Review menu prices, offers and online listings.` });
    else out.push({ tone: 'info', text: 'Sales are steady month to month.' });
  }
  if (be.breakEvenDaily > 0) {
    if (be.avgDailyRevenue30 < be.breakEvenDaily) out.push({ tone: 'bad', text: `Average daily revenue (${amt(be.avgDailyRevenue30)}) is below break-even (${amt(be.breakEvenDaily)}). Cut fixed costs or lift sales.` });
    else if (be.avgDailyRevenue30 < be.breakEvenDaily * B.breakEvenCushion) out.push({ tone: 'warn', text: 'You are only just above break-even — a slow week could mean a loss.' });
  }
  const food = B.foodCostPct;
  if (k.food_cost_pct !== null && k.food_cost_pct! > food.high) out.push({ tone: 'warn', text: `Food cost is ${k.food_cost_pct}% of sales (healthy is ${food.low}–${food.high}%). Check recipes, portions, wastage and supplier prices.` });
  else if (k.food_cost_pct && k.food_cost_pct > 0 && k.food_cost_pct < food.low) out.push({ tone: 'good', text: `Food cost is a healthy ${k.food_cost_pct}% of sales.` });
  if (k.aov_growth !== null && k.aov_growth! < -B.aovChangePct) out.push({ tone: 'warn', text: `Average bill dropped ${Math.abs(k.aov_growth!)}% vs the previous 30 days. Try combos, add-ons and suggesting desserts/drinks.` });
  if (k.aov_growth !== null && k.aov_growth! > B.aovChangePct) out.push({ tone: 'good', text: `Average bill is up ${k.aov_growth}% — upselling is working.` });
  const ranked = [...weekdays].filter((w) => w.avg_sales > 0).sort((a, b) => a.avg_sales - b.avg_sales);
  if (ranked.length >= 5) {
    const slow = ranked[0]!;
    const best = ranked.at(-1)!;
    out.push({ tone: 'info', text: `${slow.day} is your slowest day (≈${amt(slow.avg_sales)}) vs ${best.day} (≈${amt(best.avg_sales)}). A ${slow.day} offer or event could fill tables.` });
  }
  if (falling.length) out.push({ tone: 'warn', text: `Losing popularity: ${falling.slice(0, 3).map((f) => `${f.name} (${f.change}%)`).join(', ')}. Check quality, price or visibility on the menu.` });
  if (k.tagged_share !== null && k.tagged_share! < B.taggedShareMinPct) out.push({ tone: 'info', text: `Only ${k.tagged_share}% of bills have a customer attached. Capture phone numbers at billing to grow repeat business.` });
  if (k.repeat_rate !== null && k.repeat_rate! >= B.repeatRateGoodPct) out.push({ tone: 'good', text: `${k.repeat_rate}% of known customers came back more than once in 90 days.` });
  const delivery = channels.find((c) => c.type === 'delivery');
  if (delivery?.change !== null && delivery?.change !== undefined && delivery.change > B.channelGrowthPct) out.push({ tone: 'info', text: `Delivery sales grew ${delivery.change}% — consider a delivery-only menu or packaging upgrades.` });
  if (k.expense_ratio_pct !== null && k.expense_ratio_pct! > B.expenseRatioWarnPct) out.push({ tone: 'warn', text: `Operating expenses are ${k.expense_ratio_pct}% of revenue. Review rent, salaries and utilities.` });
  return out;
}
