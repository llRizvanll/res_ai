// Display formatting: money, numbers, dates and times, and labels for coded values.
import { UI_CONFIG } from '../config.js';
import { ORDER_TYPE_LABELS, PAYMENT_MODE_LABELS } from '../../shared/domain.js';
import { isRtl } from './i18n.js';

let currency = '₹';
export const setCurrency = (c: string) => (currency = c || '₹');
export const money = (n: number | null | undefined): string => {
  const v = Number(n || 0);
  return (v < 0 ? '−' : '') + currency + Math.abs(v).toLocaleString(UI_CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const money0 = (n: number | null | undefined): string => {
  const v = Math.round(Number(n || 0));
  return (v < 0 ? '−' : '') + currency + Math.abs(v).toLocaleString(UI_CONFIG.locale);
};
export const compact = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 100000 ? (a / 100000).toFixed(1) + 'L' : a >= 1000 ? (a / 1000).toFixed(1) + 'k' : String(Math.round(a));
  return (n < 0 && s !== '0' ? '−' : '') + s;
};
export const qtyFmt = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Dates and times read naturally in the screen language (Arabic month names, Latin digits); amounts keep one format */
export const dateLocale = () => (isRtl() ? 'ar-u-nu-latn' : UI_CONFIG.locale);
export const parseDate = (s: string): Date => new Date(s.includes('T') || s.length <= 10 ? s : s.replace(' ', 'T'));
export const fmtDate = (s: string | null | undefined): string =>
  s ? parseDate(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtTime = (s: string | null | undefined): string =>
  s ? parseDate(s).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDateTime = (s: string | null | undefined): string => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');

export function minutesSince(s: string): number {
  return Math.max(0, Math.floor((Date.now() - parseDate(s).getTime()) / 60000));
}
export function elapsed(s: string): string {
  const m = minutesSince(s);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Labels for coded values (order types, payment modes), from the shared domain */
export { ORDER_TYPE_LABELS, PAYMENT_MODE_LABELS };
export const label = (map: Record<string, string>, k: string | null | undefined) => (k ? map[k] || k : '—');

export const pctChange = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);
