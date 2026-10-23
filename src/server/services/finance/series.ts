// Daily figures and fair period-over-period comparisons used by the insights.
import { all, get } from '../../db/index.js';
import { r2 } from '../../../shared/calc.js';
import { config } from '../../config.js';
import { addDays, daysBetween } from './calendar.js';

export interface DayPoint {
  day: string;
  sales: number;
  orders: number;
  expenses: number;
}

/** One point per calendar day in [from, to], zero-filled */
export function dailySeries(from: string, to: string): DayPoint[] {
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

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const growth = (now: number, before: number) => (before > 0 ? r2(((now - before) / before) * 100) : null);

/** Share of days in a range that had any sales — comparisons against a mostly-empty period would mislead */
export function coverage(from: string, to: string): number {
  const days = daysBetween(from, to) + 1;
  const withSales = get(`SELECT COUNT(DISTINCT date(closed_at)) AS n FROM orders WHERE status='completed' AND date(closed_at) BETWEEN ? AND ?`, from, to)!.n;
  return days > 0 ? withSales / days : 0;
}
export const isComparable = (from: string, to: string) => coverage(from, to) >= config.forecast.minComparableCoverage;
/** Growth %, or null when the earlier period had too little data to compare against */
export const fair = (now: number, before: number, from: string, to: string) => (isComparable(from, to) ? growth(now, before) : null);
