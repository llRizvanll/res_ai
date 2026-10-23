// Money views built from orders, stock and expenses: recurring expenses, profit & loss, growth projections.
// All functions act on the current restaurant (see withTenant) and take/return dates as YYYY-MM-DD.
import { all, get, run } from './db.js';
import { r2 } from '../shared/calc.js';

// ---------------------------------------------------------------- calendar helpers (UTC, so time zones never shift a day)
const toDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd!));
};
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => {
  const dt = toDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt);
};
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** Same day-of-month `n` months later, clamped (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(d: string, n: number, anchorDay = Number(d.slice(8))): string {
  const dt = toDate(d);
  const total = dt.getUTCFullYear() * 12 + dt.getUTCMonth() + n;
  const y = Math.floor(total / 12);
  const m0 = total % 12;
  return iso(new Date(Date.UTC(y, m0, Math.min(anchorDay, daysInMonth(y, m0)))));
}
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400_000);
export const monthStart = (d: string) => d.slice(0, 8) + '01';
export const monthEnd = (d: string) => {
  const dt = toDate(d);
  return iso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
};
const weekday = (d: string) => toDate(d).getUTCDay(); // 0 = Sunday

// ---------------------------------------------------------------- recurring expenses
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
/** How many times a year each frequency happens, for monthly-equivalent maths */
const PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52.143, monthly: 12, quarterly: 4, yearly: 1 };

export function nextOccurrence(freq: Frequency, current: string, anchorDay: number): string {
  switch (freq) {
    case 'daily':
      return addDays(current, 1);
    case 'weekly':
      return addDays(current, 7);
    case 'monthly':
      return addMonths(current, 1, anchorDay);
    case 'quarterly':
      return addMonths(current, 3, anchorDay);
    case 'yearly':
      return addMonths(current, 12, anchorDay);
  }
}

/** Dates a template falls on within [from, to], without writing anything (used for projections) */
export function occurrences(r: { frequency: Frequency; start_date: string; next_date: string; end_date: string | null }, from: string, to: string): string[] {
  const out: string[] = [];
  const anchor = Number(r.start_date.slice(8));
  let d = r.next_date;
  for (let guard = 0; d <= to && guard < 2000; guard++) {
    if (r.end_date && d > r.end_date) break;
    if (d >= from) out.push(d);
    d = nextOccurrence(r.frequency, d, anchor);
  }
  return out;
}

/** Writes every due occurrence (up to `today`) as a real expense. Safe to call often; returns how many were added. */
export function materializeRecurring(today: string): number {
  let added = 0;
  for (const r of all('SELECT * FROM recurring_expenses WHERE active=1 AND next_date <= ?', today)) {
    const anchor = Number(r.start_date.slice(8));
    let d: string = r.next_date;
    for (let guard = 0; d <= today && guard < 2000; guard++) {
      if (r.end_date && d > r.end_date) break;
      run(
        'INSERT INTO expenses (date, category, amount, paid_to, note, user_id, recurring_id) VALUES (?,?,?,?,?,?,?)',
        d, r.category, r.amount, r.paid_to, r.note || `Recurring (${r.frequency})`, r.created_by, r.id,
      );
      added++;
      d = nextOccurrence(r.frequency, d, anchor);
    }
    const finished = r.end_date && d > r.end_date;
    run('UPDATE recurring_expenses SET next_date=?, active=? WHERE id=?', d, finished ? 0 : 1, r.id);
  }
  return added;
}

/** Fixed costs per month from active recurring templates */
export function recurringMonthly(): number {
  return r2(all('SELECT frequency, amount FROM recurring_expenses WHERE active=1').reduce((a, r) => a + (r.amount * PER_YEAR[r.frequency as Frequency]) / 12, 0));
}

// ---------------------------------------------------------------- profit & loss
const W = "o.status='completed' AND date(o.closed_at) BETWEEN ? AND ?";
// Cost recorded at the time of the movement; older rows without it fall back to today's unit cost
const COST = 'COALESCE(NULLIF(m.cost, 0), i.cost)';

export interface PnL {
  from: string;
  to: string;
  days: number;
  orders: number;
  covers: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  service_charge: number;
  packaging: number;
  round_off: number;
  other_income: number;
  total_revenue: number;
  tax_collected: number;
  food_cost: number;
  wastage: number;
  cogs: number;
  gross_profit: number;
  gross_margin: number;
  expenses: { category: string; amount: number }[];
  total_expenses: number;
  operating_profit: number;
  net_margin: number;
  avg_order_value: number;
  food_cost_pct: number;
  cancelled_value: number;
  void_value: number;
}

const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);

export function pnl(from: string, to: string): PnL {
  const s = get(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(guests),0) AS covers, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount,
      COALESCE(SUM(service_charge),0) AS sc, COALESCE(SUM(packaging),0) AS pk, COALESCE(SUM(round_off),0) AS ro,
      COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(total),0) AS total
     FROM orders o WHERE ${W}`,
    from, to,
  )!;
  const cost = (type: string) =>
    get(
      `SELECT COALESCE(SUM(-m.qty * ${COST}),0) AS v FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
       WHERE m.type=? AND date(m.created_at) BETWEEN ? AND ?`,
      type, from, to,
    )!.v;
  const expenses = all('SELECT COALESCE(category,\'Other\') AS category, SUM(amount) AS amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to)
    .map((e) => ({ category: e.category as string, amount: r2(e.amount) }));
  const net = r2(s.gross - s.discount);
  const other = r2(s.sc + s.pk + s.ro);
  const revenue = r2(net + other);
  const food = r2(cost('consumption'));
  const wastage = r2(cost('wastage'));
  const cogs = r2(food + wastage);
  const gp = r2(revenue - cogs);
  const totalExp = r2(expenses.reduce((a, e) => a + e.amount, 0));
  const op = r2(gp - totalExp);
  return {
    from, to, days: daysBetween(from, to) + 1, orders: s.orders, covers: s.covers,
    gross_sales: r2(s.gross), discounts: r2(s.discount), net_sales: net, service_charge: r2(s.sc), packaging: r2(s.pk), round_off: r2(s.ro),
    other_income: other, total_revenue: revenue, tax_collected: r2(s.tax),
    food_cost: food, wastage, cogs, gross_profit: gp, gross_margin: pct(gp, revenue),
    expenses, total_expenses: totalExp, operating_profit: op, net_margin: pct(op, revenue),
    avg_order_value: s.orders ? r2(s.total / s.orders) : 0, food_cost_pct: pct(food, net),
    cancelled_value: r2(get(`SELECT COALESCE(SUM(total),0) AS v FROM orders o WHERE status='cancelled' AND date(created_at) BETWEEN ? AND ?`, from, to)!.v),
    void_value: r2(get(`SELECT COALESCE(SUM(oi.qty*oi.price),0) AS v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.cancelled=1 AND date(o.created_at) BETWEEN ? AND ?`, from, to)!.v),
  };
}

/** P&L for each month of a year (months after `today` are left empty) */
export function pnlByMonth(year: number, today: string) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, '0')}-01`;
    if (start > today) {
      months.push(null);
      continue;
    }
    const end = monthEnd(start);
    months.push(pnl(start, end < today ? end : today));
  }
  return months;
}

// ---------------------------------------------------------------- growth & projections
interface DayPoint {
  day: string;
  sales: number;
  orders: number;
  expenses: number;
}

function dailySeries(from: string, to: string): DayPoint[] {
  const sales = new Map(
    all(`SELECT date(closed_at) AS d, SUM(total) AS s, COUNT(*) AS n FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ? GROUP BY d`, from, to).map((r) => [r.d, r]),
  );
  const exp = new Map(all('SELECT date AS d, SUM(amount) AS a FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date', from, to).map((r) => [r.d, r.a]));
  const out: DayPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = sales.get(d);
    out.push({ day: d, sales: r2(s?.s || 0), orders: s?.n || 0, expenses: r2(exp.get(d) || 0) });
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const growth = (now: number, before: number) => (before > 0 ? r2(((now - before) / before) * 100) : null);
/** Share of days in a range that had any sales — comparisons against a mostly-empty period would mislead */
function coverage(from: string, to: string): number {
  const days = daysBetween(from, to) + 1;
  const withSales = get(`SELECT COUNT(DISTINCT date(closed_at)) AS n FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, from, to)!.n;
  return days > 0 ? withSales / days : 0;
}
const fair = (now: number, before: number, from: string, to: string) => (coverage(from, to) >= 0.6 ? growth(now, before) : null);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Forecast = linear trend over recent days × day-of-week pattern.
 * Simple and explainable on purpose: a restaurant owner can sanity-check it against their own sense of the week.
 */
function buildForecast(history: DayPoint[], from: string, days: number) {
  // Start the model at the first day that had any sales, so a new restaurant isn't dragged down by empty days
  const firstSale = history.findIndex((p) => p.sales > 0);
  const h = firstSale < 0 ? [] : history.slice(firstSale);
  if (h.length < 14) return null;
  const n = h.length;
  const xs = h.map((_, i) => i);
  const ys = h.map((p) => p.sales);
  const mx = sum(xs) / n;
  const my = sum(ys) / n;
  const sxx = sum(xs.map((x) => (x - mx) ** 2));
  const slope = sxx ? sum(xs.map((x, i) => (x - mx) * (ys[i]! - my))) / sxx : 0;
  const intercept = my - slope * mx;
  const trend = (x: number) => Math.max(0, intercept + slope * x);

  // Day-of-week index: how each weekday performs relative to the trend line
  const ratios: number[][] = [[], [], [], [], [], [], []];
  h.forEach((p, i) => {
    const t = trend(i);
    if (t > 0) ratios[weekday(p.day)]!.push(p.sales / t);
  });
  const raw = ratios.map((r) => (r.length ? sum(r) / r.length : 1));
  const mean = sum(raw) / 7 || 1;
  const dow = raw.map((v) => v / mean);

  const residuals = h.map((p, i) => p.sales - trend(i) * dow[weekday(p.day)]!);
  const sd = Math.sqrt(sum(residuals.map((r) => r * r)) / Math.max(1, n - 2));
  const points = [];
  for (let k = 0; k < days; k++) {
    const day = addDays(from, k);
    const y = Math.max(0, trend(n + daysBetween(addDays(h[n - 1]!.day, 1), day)) * dow[weekday(day)]!);
    points.push({ day, value: r2(y), low: r2(Math.max(0, y - 1.28 * sd)), high: r2(y + 1.28 * sd) });
  }
  return {
    points,
    daily_trend: r2(slope), // ₹ change in daily sales per day
    monthly_trend_pct: my ? r2(((slope * 30) / my) * 100) : 0,
    weekday_index: dow.map((v, i) => ({ day: WEEKDAYS[i]!, index: r2(v) })),
    based_on_days: n,
  };
}

export function insights(today: string) {
  const yesterday = addDays(today, -1);
  const hist = dailySeries(addDays(today, -119), yesterday); // complete days only
  const forecast = buildForecast(hist.slice(-90), today, 90);

  // Rolling comparisons (complete days)
  const window = (n: number, offset = 0) => hist.slice(hist.length - n - offset, hist.length - offset);
  const last7 = window(7);
  const prev7 = window(7, 7);
  const last30 = window(30);
  const prev30 = window(30, 30);
  const s7 = sum(last7.map((p) => p.sales));
  const s30 = sum(last30.map((p) => p.sales));
  const sPrev30 = sum(prev30.map((p) => p.sales));
  const o30 = sum(last30.map((p) => p.orders));
  const oPrev30 = sum(prev30.map((p) => p.orders));

  // Month to date vs the same days last month
  const mStart = monthStart(today);
  const mtd = pnl(mStart, today);
  const lmStart = addMonths(mStart, -1);
  const lmSameDay = addMonths(today, -1);
  const lmTo = lmSameDay < monthEnd(lmStart) ? lmSameDay : monthEnd(lmStart);
  const lastMtd = pnl(lmStart, lmTo);
  const lastMonthFull = pnl(lmStart, monthEnd(lmStart));
  const lastMonthComparable = coverage(lmStart, monthEnd(lmStart)) >= 0.6;

  // Ratios from the last 90 days drive the projections
  const p90 = pnl(addDays(today, -90), yesterday);
  const foodPct = p90.net_sales ? p90.cogs / p90.net_sales : 0.3;
  const netToGross = p90.total_revenue && p90.net_sales ? p90.total_revenue / (p90.total_revenue + p90.tax_collected) : 0.95;
  const variableDaily = r2(
    get('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE recurring_id IS NULL AND date BETWEEN ? AND ?', addDays(today, -90), yesterday)!.v / 90,
  );

  // Month-end projection: actual so far + forecast for the rest of the month
  const mEnd = monthEnd(today);
  const remaining = daysBetween(today, mEnd);
  const restForecast = forecast ? sum(forecast.points.filter((p) => p.day > today && p.day <= mEnd).map((p) => p.value)) : (s30 / 30) * remaining;
  const mtdSales = get(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, mStart, today)!.v;
  const projectedSales = r2(mtdSales + restForecast);
  const templates = all('SELECT * FROM recurring_expenses WHERE active=1');
  const scheduledRest = r2(sum(templates.map((t) => occurrences(t as never, addDays(today, 1), mEnd).length * t.amount)));
  const projectedExpenses = r2(mtd.total_expenses + scheduledRest + variableDaily * remaining);
  const projectedRevenue = r2(projectedSales * netToGross);
  const projectedProfit = r2(projectedRevenue - projectedRevenue * foodPct - projectedExpenses);

  // Break-even: fixed monthly costs ÷ what's left of each rupee after food cost
  const fixedMonthly = r2(recurringMonthly() + variableDaily * 30.4);
  const contribution = Math.max(0.05, 1 - foodPct);
  const breakEvenMonthly = r2(fixedMonthly / contribution);
  const avgDailyRevenue30 = r2((s30 / 30) * netToGross);
  const breakEvenDaily = r2(breakEvenMonthly / 30.4);

  // Next 3 months outlook
  const outlook = [];
  for (let k = 1; k <= 3; k++) {
    const start = addMonths(mStart, k);
    const end = monthEnd(start);
    const sales = forecast ? sum(forecast.points.filter((p) => p.day >= start && p.day <= end).map((p) => p.value)) : (s30 / 30) * (daysBetween(start, end) + 1);
    const days = daysBetween(start, end) + 1;
    const rev = sales * netToGross;
    const exp = sum(templates.map((t) => occurrences(t as never, start, end).length * t.amount)) + variableDaily * days;
    outlook.push({ month: start.slice(0, 7), sales: r2(sales), revenue: r2(rev), expenses: r2(exp), profit: r2(rev - rev * foodPct - exp), partial: forecast ? end > forecast.points.at(-1)!.day : false });
  }

  // Last 12 months, for the trend chart
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const start = addMonths(mStart, -k);
    const p = pnl(start, k === 0 ? today : monthEnd(start));
    months.push({ month: start.slice(0, 7), sales: r2(p.total_revenue + p.tax_collected), revenue: p.total_revenue, expenses: p.total_expenses, cogs: p.cogs, profit: p.operating_profit, orders: p.orders });
  }

  // Weekday & hour patterns (last 90 / 30 days)
  const weekdays = WEEKDAYS.map((name, i) => {
    const pts = hist.slice(-90).filter((p) => weekday(p.day) === i);
    return { day: name, avg_sales: r2(pts.length ? sum(pts.map((p) => p.sales)) / pts.length : 0) };
  });
  const hours = all(
    `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS sales FROM orders
     WHERE status='completed' AND date(closed_at) BETWEEN ? AND ? GROUP BY hour ORDER BY hour`,
    addDays(today, -30), yesterday,
  );

  // Item momentum: last 30 days vs the 30 before
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
    .filter((x) => x.now + x.before >= 5);
  if (!coverage(addDays(today, -60), addDays(today, -31))) momentum.length = 0; // nothing to compare against yet
  const rising = momentum.filter((x) => x.change !== null && x.change > 0).sort((a, b) => b.change! - a.change!).slice(0, 5);
  const falling = momentum.filter((x) => x.change !== null && x.change < 0).sort((a, b) => a.change! - b.change!).slice(0, 5);

  // Customers
  const tagged = get(
    `SELECT COUNT(*) AS orders, COUNT(DISTINCT customer_id) AS customers FROM orders WHERE status='completed' AND customer_id IS NOT NULL AND date(closed_at) BETWEEN ? AND ?`,
    addDays(today, -90), yesterday,
  )!;
  const repeat = get(
    `SELECT COUNT(*) AS n FROM (SELECT customer_id FROM orders WHERE status='completed' AND customer_id IS NOT NULL AND date(closed_at) BETWEEN ? AND ? GROUP BY customer_id HAVING COUNT(*) > 1)`,
    addDays(today, -90), yesterday,
  )!.n;
  const newCustomers = get('SELECT COUNT(*) AS n FROM customers WHERE date(created_at) BETWEEN ? AND ?', mStart, today)!.n;
  const totalOrders90 = get(`SELECT COUNT(*) AS n FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, addDays(today, -90), yesterday)!.n;

  // Channel mix change
  const channel = (from: string, to: string) =>
    Object.fromEntries(all(`SELECT type, SUM(total) AS s FROM orders o WHERE ${W} GROUP BY type`, from, to).map((r) => [r.type, r.s]));
  const chNow = channel(addDays(today, -30), yesterday);
  const chBefore = channel(addDays(today, -60), addDays(today, -31));
  const prevFair = coverage(addDays(today, -60), addDays(today, -31)) >= 0.6;
  const channels = ['dine_in', 'takeaway', 'delivery'].map((t) => ({ type: t, now: r2(chNow[t] || 0), before: r2(chBefore[t] || 0), change: prevFair ? growth(chNow[t] || 0, chBefore[t] || 0) : null }));

  const aov30 = o30 ? s30 / o30 : 0;
  const aovPrev = oPrev30 ? sPrev30 / oPrev30 : 0;

  const kpis = {
    sales_7d: r2(s7),
    growth_7d: fair(s7, sum(prev7.map((p) => p.sales)), prev7[0]?.day ?? today, prev7.at(-1)?.day ?? today),
    sales_30d: r2(s30),
    growth_30d: fair(s30, sPrev30, prev30[0]?.day ?? today, prev30.at(-1)?.day ?? today),
    orders_30d: o30,
    orders_growth_30d: fair(o30, oPrev30, prev30[0]?.day ?? today, prev30.at(-1)?.day ?? today),
    aov_30d: r2(aov30),
    aov_growth: fair(aov30, aovPrev, prev30[0]?.day ?? today, prev30.at(-1)?.day ?? today),
    mtd_sales: r2(mtdSales),
    mtd_vs_last_month: fair(mtd.total_revenue, lastMtd.total_revenue, lmStart, lmTo),
    last_month_sales: r2(lastMonthFull.total_revenue + lastMonthFull.tax_collected),
    food_cost_pct: r2(foodPct * 100),
    expense_ratio_pct: p90.total_revenue ? r2((p90.total_expenses / p90.total_revenue) * 100) : null,
    profit_margin_90d: p90.net_margin,
    repeat_rate: tagged.customers ? r2((repeat / tagged.customers) * 100) : null,
    tagged_share: totalOrders90 ? r2((tagged.orders / totalOrders90) * 100) : null,
    new_customers_mtd: newCustomers,
  };

  return {
    today,
    kpis,
    history: hist.slice(-60),
    forecast,
    month_end: {
      month: today.slice(0, 7), days_left: remaining, mtd_sales: r2(mtdSales), projected_sales: projectedSales, last_month_sales: kpis.last_month_sales,
      last_month_comparable: lastMonthComparable ? 1 : 0,
      projected_revenue: projectedRevenue, projected_food_cost: r2(projectedRevenue * foodPct), projected_expenses: projectedExpenses,
      scheduled_expenses_left: scheduledRest, projected_profit: projectedProfit,
    },
    break_even: {
      fixed_monthly: fixedMonthly, recurring_monthly: recurringMonthly(), variable_daily: variableDaily, contribution_pct: r2(contribution * 100),
      monthly: breakEvenMonthly, daily: breakEvenDaily, current_daily: avgDailyRevenue30,
      safety_margin_pct: breakEvenDaily ? r2(((avgDailyRevenue30 - breakEvenDaily) / breakEvenDaily) * 100) : null,
    },
    outlook,
    months,
    weekdays,
    hours,
    rising,
    falling,
    channels,
    advice: advice(kpis, weekdays, falling, forecast?.monthly_trend_pct ?? null, { breakEvenDaily, avgDailyRevenue30 }, channels),
  };
}

/** Plain-language suggestions from the numbers; each one says why */
function advice(
  k: Record<string, number | null>,
  weekdays: { day: string; avg_sales: number }[],
  falling: { name: string; change: number | null }[],
  trendPct: number | null,
  be: { breakEvenDaily: number; avgDailyRevenue30: number },
  channels: { type: string; change: number | null }[],
): { tone: 'good' | 'warn' | 'bad' | 'info'; text: string }[] {
  const out: { tone: 'good' | 'warn' | 'bad' | 'info'; text: string }[] = [];
  if (trendPct !== null) {
    if (trendPct >= 3) out.push({ tone: 'good', text: `Sales are trending up about ${trendPct}% a month. Make sure stock and staff keep pace on busy days.` });
    else if (trendPct <= -3) out.push({ tone: 'bad', text: `Sales are trending down about ${Math.abs(trendPct)}% a month. Review menu prices, offers and online listings.` });
    else out.push({ tone: 'info', text: 'Sales are steady month to month.' });
  }
  if (be.breakEvenDaily > 0) {
    if (be.avgDailyRevenue30 < be.breakEvenDaily) out.push({ tone: 'bad', text: `Average daily revenue (₹${Math.round(be.avgDailyRevenue30).toLocaleString('en-IN')}) is below break-even (₹${Math.round(be.breakEvenDaily).toLocaleString('en-IN')}). Cut fixed costs or lift sales.` });
    else if (be.avgDailyRevenue30 < be.breakEvenDaily * 1.15) out.push({ tone: 'warn', text: 'You are only just above break-even — a slow week could mean a loss.' });
  }
  if (k.food_cost_pct !== null && k.food_cost_pct! > 35) out.push({ tone: 'warn', text: `Food cost is ${k.food_cost_pct}% of sales (healthy is 28–35%). Check recipes, portions, wastage and supplier prices.` });
  else if (k.food_cost_pct && k.food_cost_pct > 0 && k.food_cost_pct < 28) out.push({ tone: 'good', text: `Food cost is a healthy ${k.food_cost_pct}% of sales.` });
  if (k.aov_growth !== null && k.aov_growth! < -5) out.push({ tone: 'warn', text: `Average bill dropped ${Math.abs(k.aov_growth!)}% vs the previous 30 days. Try combos, add-ons and suggesting desserts/drinks.` });
  if (k.aov_growth !== null && k.aov_growth! > 5) out.push({ tone: 'good', text: `Average bill is up ${k.aov_growth}% — upselling is working.` });
  const ranked = [...weekdays].filter((w) => w.avg_sales > 0).sort((a, b) => a.avg_sales - b.avg_sales);
  if (ranked.length >= 5) {
    const slow = ranked[0]!;
    const best = ranked.at(-1)!;
    out.push({ tone: 'info', text: `${slow.day} is your slowest day (≈₹${Math.round(slow.avg_sales).toLocaleString('en-IN')}) vs ${best.day} (≈₹${Math.round(best.avg_sales).toLocaleString('en-IN')}). A ${slow.day} offer or event could fill tables.` });
  }
  if (falling.length) out.push({ tone: 'warn', text: `Losing popularity: ${falling.slice(0, 3).map((f) => `${f.name} (${f.change}%)`).join(', ')}. Check quality, price or visibility on the menu.` });
  if (k.tagged_share !== null && k.tagged_share! < 40) out.push({ tone: 'info', text: `Only ${k.tagged_share}% of bills have a customer attached. Capture phone numbers at billing to grow repeat business.` });
  if (k.repeat_rate !== null && k.repeat_rate! >= 40) out.push({ tone: 'good', text: `${k.repeat_rate}% of known customers came back more than once in 90 days.` });
  const delivery = channels.find((c) => c.type === 'delivery');
  if (delivery?.change !== null && delivery?.change !== undefined && delivery.change > 15) out.push({ tone: 'info', text: `Delivery sales grew ${delivery.change}% — consider a delivery-only menu or packaging upgrades.` });
  if (k.expense_ratio_pct !== null && k.expense_ratio_pct! > 45) out.push({ tone: 'warn', text: `Operating expenses are ${k.expense_ratio_pct}% of revenue. Review rent, salaries and utilities.` });
  return out;
}
