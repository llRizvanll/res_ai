// Activity log: who did what, per staff account. Kept across backup restores.
// Feature modules declare what to record per route with `onAudit`; the dispatcher applies the rules.
import { get, getSettings, run, type Row } from '../db/index.js';
import { r2 } from '../../shared/calc.js';
import { log } from './log.js';
import { config } from '../config.js';
import { clientIp, type Ctx, type User } from './http.js';

export interface AuditOpts {
  as?: User | null; // when there is no signed-in user yet (sign-in attempts)
  entity?: string;
  id?: string | number | null;
  amount?: number | null;
  details?: unknown;
}

export function audit(c: Pick<Ctx, 'req'> & { user?: User | null }, action: string, summary: string, o: AuditOpts = {}) {
  const u = o.as !== undefined ? o.as : c.user || null;
  try {
    run(
      'INSERT INTO activity_log (user_id, user_name, role, action, entity, entity_id, summary, amount, details, ip) VALUES (?,?,?,?,?,?,?,?,?,?)',
      u?.id ?? null, u?.name ?? null, u?.role ?? null, action, o.entity ?? action.split('.')[0], o.id == null ? null : String(o.id),
      summary.slice(0, 300), o.amount ?? null, o.details === undefined ? null : JSON.stringify(o.details).slice(0, 4000),
      clientIp(c.req),
    );
  } catch (e) {
    log.error('Could not write activity log', e); // never block the actual work
  }
}

export interface AuditSpec {
  /** Runs before the handler, e.g. to remember the name of something about to be deleted */
  before?: (c: Ctx) => unknown;
  after: (c: Ctx, result: Row, before: Row) => [string, string, AuditOpts?] | null;
}
const AUDITS = new Map<string, AuditSpec>();
/** Registers what to record for a route, keyed like "POST /api/orders/:id/settle" */
export const onAudit = (key: string, spec: AuditSpec) => AUDITS.set(key, spec);
export const auditSpecFor = (method: string, pattern: string) => AUDITS.get(`${method} ${pattern}`);

// ---- helpers for writing rules
export const cur$ = (n: unknown) => `${getSettings().currency || '₹'}${r2(Number(n) || 0).toLocaleString(config.locale)}`;
/** `before` hook that loads the row named by :id from a table */
export const row = (table: string) => (c: Ctx) => get(`SELECT * FROM ${table} WHERE id=?`, c.params.id);
export const orderOf = (c: Ctx) => get('SELECT * FROM orders WHERE id=?', c.params.id);
