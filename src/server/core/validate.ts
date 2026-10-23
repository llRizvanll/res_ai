// Every user-supplied value goes through one of these. Each throws a 400 with a message staff can act on.
import { get } from '../db/index.js';
import { config } from '../config.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../shared/domain.js';
import { fail, type Body } from './http.js';

/** Trimmed string, or null when blank (no length check — prefer `text` for user input) */
export const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
/** Lenient number with a default, for values that are already range-checked elsewhere */
export const num = (v: unknown, d = 0): number => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));

/** Trimmed text with a length limit; null when empty, or an error when required */
export function text(v: unknown, label: string, max = 100, required = false): string | null {
  const t = v === undefined || v === null ? '' : String(v).trim();
  if (!t) {
    if (required) fail(400, `${label} is required`);
    return null;
  }
  if (t.length > max) fail(400, `${label} is too long (max ${max} characters)`);
  return t;
}

/** A number within [min, max]; `def` is used when the value is blank */
export function numIn(v: unknown, label: string, min: number, max: number, def?: number): number {
  if (v === '' || v === null || v === undefined) {
    if (def !== undefined) return def;
    fail(400, `${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(400, `${label} must be a number`);
  if (n < min || n > max) fail(400, `${label} must be between ${min} and ${max}`);
  return n;
}

/** Real calendar date in YYYY-MM-DD (rejects 2020-02-31). Checked in UTC so the server's time zone can't shift the day. */
export function isDayStr(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo && dt.getUTCDate() === d;
}
export function dateOpt(v: unknown, label: string): string | null {
  const t = text(v, label, 10);
  if (t && !isDayStr(t)) fail(400, `${label} must be a valid date (YYYY-MM-DD)`);
  return t;
}
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function timeOpt(v: unknown, label: string): string | null {
  const t = text(v, label, 5);
  if (t && !TIME_RE.test(t)) fail(400, `${label} must be a time like 19:30`);
  return t;
}

export function checkPassword(v: unknown) {
  const pw = String(v ?? '');
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) fail(400, `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`);
  if (/^(.)\1+$/.test(pw) || config.security.weakPasswords.includes(pw.toLowerCase())) {
    fail(400, 'That password is too easy to guess — choose another');
  }
}
export function emailOpt(v: unknown): string | null {
  const t = text(v, 'Email', 120);
  if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail(400, 'Enter a valid email address');
  return t;
}
export function phoneOpt(v: unknown, label = 'Phone'): string | null {
  const t = text(v, label, 20);
  if (t && !/^\+?[0-9][0-9\s-]{5,18}$/.test(t)) fail(400, `Enter a valid ${label.toLowerCase()} number`);
  return t ? t.replace(/[\s-]/g, '') : null;
}

/** Optional reference to another row that must exist */
export function refOpt(v: unknown, table: string, label: string): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const id = Number(v);
  if (!Number.isInteger(id) || !get(`SELECT 1 FROM ${table} WHERE id=?`, id)) fail(400, `${label} not found`);
  return id;
}
/** Case-insensitive uniqueness within a table (excluding the row being edited) */
export function unique(table: string, col: string, value: string | null, label: string, exceptId?: unknown) {
  if (!value) return;
  if (get(`SELECT 1 FROM ${table} WHERE lower(${col})=lower(?) AND id != ?`, value, Number(exceptId) || 0)) fail(400, `${label} “${value}” already exists`);
}
export const requireRow = <T>(row: T, what: string): NonNullable<T> => row ?? fail(404, `${what} not found`);

/** Ids for bulk actions: positive integers, at least one */
export function bulkIds(body: Body): number[] {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) fail(400, 'Nothing selected');
  return ids;
}
