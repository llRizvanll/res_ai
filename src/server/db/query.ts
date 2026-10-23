// Small typed helpers over node:sqlite for the current restaurant's database.
import { currentDb as cur } from './tenants.js';


// Rows come back as loosely-typed records; callers narrow them where it matters
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Bind = string | number | bigint | null | Uint8Array;

// node:sqlite rejects undefined and booleans as bind values
const clean = (p: unknown[]): Bind[] =>
  p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Bind)));

export const all = <T = Row>(sql: string, ...p: unknown[]): T[] => cur().prepare(sql).all(...clean(p)) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]): T | undefined =>
  cur().prepare(sql).get(...clean(p)) as T | undefined;
export function run(sql: string, ...p: unknown[]): { changes: number; id: number } {
  const r = cur().prepare(sql).run(...clean(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  const d = cur();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Raw SQL on the current restaurant's database (pragmas, VACUUM INTO, ATTACH) */
export const exec = (sql: string) => cur().exec(sql);

export type Settings = Record<string, string>;

export function getSettings(): Settings {
  const o: Settings = {};
  for (const r of all('SELECT key, value FROM settings')) o[r.key] = r.value;
  return o;
}

