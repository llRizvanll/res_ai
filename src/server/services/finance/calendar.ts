// Calendar maths on YYYY-MM-DD strings, in UTC so the server's time zone never shifts a day.

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
export const weekday = (d: string) => toDate(d).getUTCDay(); // 0 = Sunday
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
