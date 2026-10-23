// Sales forecast = linear trend over recent days × day-of-week pattern.
// Simple and explainable on purpose: a restaurant owner can sanity-check it against their own sense of the week.
import { r2 } from '../../../shared/calc.js';
import { config } from '../../config.js';
import { addDays, daysBetween, weekday, WEEKDAYS } from './calendar.js';
import { sum, type DayPoint } from './series.js';

export interface ForecastPoint {
  day: string;
  value: number;
  low: number;
  high: number;
}
export interface Forecast {
  points: ForecastPoint[];
  daily_trend: number;
  monthly_trend_pct: number;
  weekday_index: { day: string; index: number }[];
  based_on_days: number;
}

export function buildForecast(history: DayPoint[], from: string, days: number): Forecast | null {
  // Start the model at the first day that had any sales, so a new restaurant isn't dragged down by empty days
  const firstSale = history.findIndex((p) => p.sales > 0);
  const h = firstSale < 0 ? [] : history.slice(firstSale);
  if (h.length < config.forecast.minDays) return null;
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
  const z = config.forecast.bandZ;
  const points: ForecastPoint[] = [];
  for (let k = 0; k < days; k++) {
    const day = addDays(from, k);
    const y = Math.max(0, trend(n + daysBetween(addDays(h[n - 1]!.day, 1), day)) * dow[weekday(day)]!);
    points.push({ day, value: r2(y), low: r2(Math.max(0, y - z * sd)), high: r2(y + z * sd) });
  }
  return {
    points,
    daily_trend: r2(slope), // currency change in daily sales per day
    monthly_trend_pct: my ? r2(((slope * 30) / my) * 100) : 0,
    weekday_index: dow.map((v, i) => ({ day: WEEKDAYS[i]!, index: r2(v) })),
    based_on_days: n,
  };
}

/** Sum of forecast values for days in [from, to] */
export const forecastBetween = (f: Forecast, from: string, to: string) => sum(f.points.filter((p) => p.day >= from && p.day <= to).map((p) => p.value));
