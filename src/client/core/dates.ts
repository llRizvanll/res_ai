// Calendar helpers on YYYY-MM-DD strings in the device's local time, and reporting periods
// (day / week / month / quarter / year) used by Expenses and Profit & Loss.
import { UI_CONFIG } from '../config.js';
import { fmtDate } from './format.js';

/** A reporting period; 'custom' means an explicit from/to range */
export type PeriodUnit = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
type FixedUnit = Exclude<PeriodUnit, 'custom'>;

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): string => isoDay(new Date());
export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** YYYY-MM-DD → Date at local midnight */
export const parseDay = (d: string) => new Date(d + 'T00:00:00');
export function periodRange(unit: FixedUnit, anchor: string): [string, string] {
  const d = parseDay(anchor);
  if (unit === 'day') return [anchor, anchor];
  if (unit === 'week') {
    const start = addDays(anchor, -((d.getDay() + 6) % 7)); // weeks start on Monday
    return [start, addDays(start, 6)];
  }
  if (unit === 'month') return [isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (unit === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) * 3;
    return [isoDay(new Date(d.getFullYear(), q, 1)), isoDay(new Date(d.getFullYear(), q + 3, 0))];
  }
  return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
}
export function shiftAnchor(unit: FixedUnit, anchor: string, n: number): string {
  const d = parseDay(anchor);
  if (unit === 'day') return addDays(anchor, n);
  if (unit === 'week') return addDays(anchor, 7 * n);
  if (unit === 'month') return isoDay(new Date(d.getFullYear(), d.getMonth() + n, 1));
  if (unit === 'quarter') return isoDay(new Date(d.getFullYear(), d.getMonth() + 3 * n, 1));
  return isoDay(new Date(d.getFullYear() + n, 0, 1));
}
export function periodLabel(unit: PeriodUnit, from: string, to: string): string {
  const f = parseDay(from);
  if (unit === 'day') return f.toLocaleDateString(UI_CONFIG.locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  if (unit === 'month') return `${MONTH_NAMES[f.getMonth()]} ${f.getFullYear()}`;
  if (unit === 'quarter') return `Q${Math.floor(f.getMonth() / 3) + 1} ${f.getFullYear()} (${MONTH_NAMES[f.getMonth()]}–${MONTH_NAMES[parseDay(to).getMonth()]})`;
  if (unit === 'year') return String(f.getFullYear());
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}
