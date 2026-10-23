// Growth & insights: KPIs, forecast, month-end projection, break-even, outlook and patterns.
// Each block is a small function; `insights()` only composes them.
import { all, get, getSettings } from '../../db/index.js';
import { r2 } from '../../../shared/calc.js';
import { ORDER_TYPES } from '../../../shared/domain.js';
import { config } from '../../config.js';
import { addDays, addMonths, daysBetween, monthEnd, monthStart, weekday, WEEKDAYS } from './calendar.js';
import { pnl, W, type PnL } from './pnl.js';
import { recurringMonthly, scheduledBetween } from './recurring.js';
import { dailySeries, fair, growth, isComparable, coverage, sum, type DayPoint } from './series.js';
import { buildForecast, forecastBetween, type Forecast } from './forecast.js';
import { advice } from './advice.js';

const F = config.forecast;

/** Ratios from the last 90 days that drive every projection */
interface Ratios {
  p90: PnL;
  foodPct: number;
  netToGross: number;
  variableDaily: number;
}
function ratios(today: string, yesterday: string): Ratios {
  const p90 = pnl(addDays(today, -90), yesterday);
  return {
    p90,
    foodPct: p90.net_sales ? p90.cogs / p90.net_sales : F.fallbackFoodCostRatio,
    netToGross: p90.total_revenue && p90.net_sales ? p90.total_revenue / (p90.total_revenue + p90.tax_collected) : F.fallbackNetToGross,
    variableDaily: r2(get('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE recurring_id IS NULL AND date BETWEEN ? AND ?', addDays(today, -90), yesterday)!.v / 90),
  };
}

/** Rolling 7/30-day windows over complete days */
function rolling(hist: DayPoint[]) {
  const window = (n: number, offset = 0) => hist.slice(hist.length - n - offset, hist.length - offset);
  const [last7, prev7, last30, prev30] = [window(7), window(7, 7), window(30), window(30, 30)];
  const total = (pts: DayPoint[], k: 'sales' | 'orders') => sum(pts.map((p) => p[k]));
  return {
    prev7, prev30,
    s7: total(last7, 'sales'), sPrev7: total(prev7, 'sales'),
    s30: total(last30, 'sales'), sPrev30: total(prev30, 'sales'),
    o30: total(last30, 'orders'), oPrev30: total(prev30, 'orders'),
  };
}

/** This month so far vs the same days last month */
function monthToDate(today: string) {
  const mStart = monthStart(today);
  const lmStart = addMonths(mStart, -1);
  const lmSameDay = addMonths(today, -1);
  const lmTo = lmSameDay < monthEnd(lmStart) ? lmSameDay : monthEnd(lmStart);
  return {
    mStart, lmStart, lmTo,
    mtd: pnl(mStart, today),
    lastMtd: pnl(lmStart, lmTo),
    lastMonthFull: pnl(lmStart, monthEnd(lmStart)),
    lastMonthComparable: isComparable(lmStart, monthEnd(lmStart)),
    mtdSales: get(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, mStart, today)!.v as number,
  };
}

/** Actual so far + forecast for the rest of the month */
function monthEndProjection(today: string, m: ReturnType<typeof monthToDate>, forecast: Forecast | null, s30: number, r: Ratios) {
  const mEnd = monthEnd(today);
  const remaining = daysBetween(today, mEnd);
  const restForecast = forecast ? sum(forecast.points.filter((p) => p.day > today && p.day <= mEnd).map((p) => p.value)) : (s30 / 30) * remaining;
  const projectedSales = r2(m.mtdSales + restForecast);
  const scheduledRest = r2(scheduledBetween(addDays(today, 1), mEnd));
  const projectedExpenses = r2(m.mtd.total_expenses + scheduledRest + r.variableDaily * remaining);
  const projectedRevenue = r2(projectedSales * r.netToGross);
  return {
    remaining,
    projectedSales,
    block: {
      month: today.slice(0, 7), days_left: remaining, mtd_sales: r2(m.mtdSales), projected_sales: projectedSales,
      last_month_sales: r2(m.lastMonthFull.total_revenue + m.lastMonthFull.tax_collected),
      last_month_comparable: m.lastMonthComparable ? 1 : 0,
      projected_revenue: projectedRevenue, projected_food_cost: r2(projectedRevenue * r.foodPct), projected_expenses: projectedExpenses,
      scheduled_expenses_left: scheduledRest, projected_profit: r2(projectedRevenue - projectedRevenue * r.foodPct - projectedExpenses),
    },
  };
}

/** Fixed monthly costs ÷ what's left of each sale after food cost */
function breakEven(s30: number, r: Ratios) {
  const fixedMonthly = r2(recurringMonthly() + r.variableDaily * F.daysPerMonth);
  const contribution = Math.max(0.05, 1 - r.foodPct);
  const monthly = r2(fixedMonthly / contribution);
  const daily = r2(monthly / F.daysPerMonth);
  const currentDaily = r2((s30 / 30) * r.netToGross);
  return {
    fixed_monthly: fixedMonthly, recurring_monthly: recurringMonthly(), variable_daily: r.variableDaily, contribution_pct: r2(contribution * 100),
    monthly, daily, current_daily: currentDaily,
    safety_margin_pct: daily ? r2(((currentDaily - daily) / daily) * 100) : null,
  };
}

/** The next three calendar months */
function outlook(mStart: string, forecast: Forecast | null, s30: number, r: Ratios) {
  return [1, 2, 3].map((k) => {
    const start = addMonths(mStart, k);
    const end = monthEnd(start);
    const days = daysBetween(start, end) + 1;
    const sales = forecast ? forecastBetween(forecast, start, end) : (s30 / 30) * days;
    const rev = sales * r.netToGross;
    const exp = scheduledBetween(start, end) + r.variableDaily * days;
    return { month: start.slice(0, 7), sales: r2(sales), revenue: r2(rev), expenses: r2(exp), profit: r2(rev - rev * r.foodPct - exp), partial: forecast ? end > forecast.points.at(-1)!.day : false };
  });
}

function last12Months(mStart: string, today: string) {
  return Array.from({ length: 12 }, (_, i) => 11 - i).map((k) => {
    const start = addMonths(mStart, -k);
    const p = pnl(start, k === 0 ? today : monthEnd(start));
    return { month: start.slice(0, 7), sales: r2(p.total_revenue + p.tax_collected), revenue: p.total_revenue, expenses: p.total_expenses, cogs: p.cogs, profit: p.operating_profit, orders: p.orders };
  });
}

/** Average sales per weekday (90 days) and per hour (30 days) */
function patterns(hist: DayPoint[], today: string, yesterday: string) {
  const weekdays = WEEKDAYS.map((name, i) => {
    const pts = hist.slice(-90).filter((p) => weekday(p.day) === i);
    return { day: name, avg_sales: r2(pts.length ? sum(pts.map((p) => p.sales)) / pts.length : 0) };
  });
  const hours = all(
    `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS sales FROM orders
     WHERE status='completed' AND date(closed_at) BETWEEN ? AND ? GROUP BY hour ORDER BY hour`,
    addDays(today, -30), yesterday,
  );
  return { weekdays, hours };
}

/** Dishes rising or falling: last 30 days vs the 30 before */
function itemMomentum(today: string, yesterday: string) {
  const itemQty = (from: string, to: string) =>
    new Map(
      all(
        `SELECT oi.name, SUM(oi.qty) AS q, SUM(oi.qty*oi.price) AS a FROM order_items oi JOIN orders o ON o.id=oi.order_id
         WHERE ${W} AND oi.cancelled=0 GROUP BY oi.name`,
        from, to,
      ).map((r) => [r.name as string, r]),
    );
  const nowItems = itemQty(addDays(today, -30), yesterday);
  const beforeItems = itemQty(addDays(today, -60), addDays(today, -31));
  const momentum = [...new Set([...nowItems.keys(), ...beforeItems.keys()])]
    .map((name) => {
      const a = nowItems.get(name)?.q || 0;
      const b = beforeItems.get(name)?.q || 0;
      return { name, now: a, before: b, change: b ? r2(((a - b) / b) * 100) : null, revenue: r2(nowItems.get(name)?.a || 0) };
    })
    .filter((x) => x.now + x.before >= F.minItemVolume);
  if (!coverage(addDays(today, -60), addDays(today, -31))) momentum.length = 0; // nothing to compare against yet
  return {
    rising: momentum.filter((x) => x.change !== null && x.change > 0).sort((a, b) => b.change! - a.change!).slice(0, 5),
    falling: momentum.filter((x) => x.change !== null && x.change < 0).sort((a, b) => a.change! - b.change!).slice(0, 5),
  };
}

function customerStats(today: string, yesterday: string, mStart: string) {
  const from = addDays(today, -90);
  const tagged = get(
    `SELECT COUNT(*) AS orders, COUNT(DISTINCT customer_id) AS customers FROM orders WHERE status='completed' AND customer_id IS NOT NULL AND date(closed_at) BETWEEN ? AND ?`,
    from, yesterday,
  )!;
  const repeat = get(
    `SELECT COUNT(*) AS n FROM (SELECT customer_id FROM orders WHERE status='completed' AND customer_id IS NOT NULL AND date(closed_at) BETWEEN ? AND ? GROUP BY customer_id HAVING COUNT(*) > 1)`,
    from, yesterday,
  )!.n;
  const total = get(`SELECT COUNT(*) AS n FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, from, yesterday)!.n;
  return {
    repeat_rate: tagged.customers ? r2((repeat / tagged.customers) * 100) : null,
    tagged_share: total ? r2((tagged.orders / total) * 100) : null,
    new_customers_mtd: get('SELECT COUNT(*) AS n FROM customers WHERE date(created_at) BETWEEN ? AND ?', mStart, today)!.n as number,
  };
}

/** Dine-in / takeaway / delivery: last 30 days vs the 30 before */
function channelMix(today: string, yesterday: string) {
  const channel = (from: string, to: string) =>
    Object.fromEntries(all(`SELECT type, SUM(total) AS s FROM orders o WHERE ${W} GROUP BY type`, from, to).map((r) => [r.type, r.s]));
  const now = channel(addDays(today, -30), yesterday);
  const before = channel(addDays(today, -60), addDays(today, -31));
  const comparable = isComparable(addDays(today, -60), addDays(today, -31));
  return ORDER_TYPES.map((t) => ({ type: t, now: r2(now[t] || 0), before: r2(before[t] || 0), change: comparable ? growth(now[t] || 0, before[t] || 0) : null }));
}

export function insights(today: string) {
  const yesterday = addDays(today, -1);
  const hist = dailySeries(addDays(today, -(F.historyDays - 1)), yesterday); // complete days only
  const forecast = buildForecast(hist.slice(-F.modelDays), today, F.horizonDays);
  const roll = rolling(hist);
  const m = monthToDate(today);
  const r = ratios(today, yesterday);
  const monthEndBlock = monthEndProjection(today, m, forecast, roll.s30, r);
  const be = breakEven(roll.s30, r);
  const { weekdays, hours } = patterns(hist, today, yesterday);
  const { rising, falling } = itemMomentum(today, yesterday);
  const channels = channelMix(today, yesterday);
  const p30 = [roll.prev30[0]?.day ?? today, roll.prev30.at(-1)?.day ?? today] as const;
  const aov30 = roll.o30 ? roll.s30 / roll.o30 : 0;
  const aovPrev = roll.oPrev30 ? roll.sPrev30 / roll.oPrev30 : 0;

  const kpis = {
    sales_7d: r2(roll.s7),
    growth_7d: fair(roll.s7, roll.sPrev7, roll.prev7[0]?.day ?? today, roll.prev7.at(-1)?.day ?? today),
    sales_30d: r2(roll.s30),
    growth_30d: fair(roll.s30, roll.sPrev30, ...p30),
    orders_30d: roll.o30,
    orders_growth_30d: fair(roll.o30, roll.oPrev30, ...p30),
    aov_30d: r2(aov30),
    aov_growth: fair(aov30, aovPrev, ...p30),
    mtd_sales: r2(m.mtdSales),
    mtd_vs_last_month: fair(m.mtd.total_revenue, m.lastMtd.total_revenue, m.lmStart, m.lmTo),
    last_month_sales: monthEndBlock.block.last_month_sales,
    food_cost_pct: r2(r.foodPct * 100),
    expense_ratio_pct: r.p90.total_revenue ? r2((r.p90.total_expenses / r.p90.total_revenue) * 100) : null,
    profit_margin_90d: r.p90.net_margin,
    ...customerStats(today, yesterday, m.mStart),
  };

  return {
    today,
    kpis,
    history: hist.slice(-60),
    forecast,
    month_end: monthEndBlock.block,
    break_even: be,
    outlook: outlook(m.mStart, forecast, roll.s30, r),
    months: last12Months(m.mStart, today),
    weekdays,
    hours,
    rising,
    falling,
    channels,
    advice: advice({
      kpis, weekdays, falling, channels,
      trendPct: forecast?.monthly_trend_pct ?? null,
      breakEven: { breakEvenDaily: be.daily, avgDailyRevenue30: be.current_daily },
      currency: getSettings().currency || '₹',
    }),
  };
}
