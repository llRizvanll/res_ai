// Order domain logic shared by billing, kitchen, reports and the owner tools.
import { all, get, getSettings, run, type Row } from '../db/index.js';
import { computeTotals, r2, type CalcLine, type CalcOrder } from '../../shared/calc.js';
import { fail, FRONT, type Body, type User } from '../core/http.js';
import { num, requireRow } from '../core/validate.js';
import type { Id } from '../core/util.js';

/** An order with its table, customer, staff names, items and parsed payments */
export function loadOrder(id: Id): Row {
  const o = requireRow(
    get(
      `SELECT o.*, t.name AS table_name, c.name AS customer_name, c.phone AS customer_phone, c.points AS customer_points,
        u.name AS created_by_name, su.name AS settled_by_name
       FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN users u ON u.id=o.created_by LEFT JOIN users su ON su.id=o.settled_by WHERE o.id=?`,
      id,
    ),
    'Order',
  );
  o.items = all(
    'SELECT oi.*, k.kot_no, k.status AS kot_status FROM order_items oi LEFT JOIN kots k ON k.id=oi.kot_id WHERE oi.order_id=? ORDER BY oi.id',
    id,
  );
  o.payments = o.payments ? JSON.parse(o.payments) : [];
  return o;
}

/** The order row, or a 400 when it is no longer open for changes */
export function openOrder(id: Id): Row {
  const o = requireRow(get('SELECT * FROM orders WHERE id=?', id), 'Order');
  if (o.status !== 'open') fail(400, `Order ${o.order_no} is already ${o.status}`);
  return o;
}

/** Recomputes and stores the order totals from its items (same maths as the till screen) */
export function recalc(id: Id) {
  const o = get('SELECT * FROM orders WHERE id=?', id)!;
  const t = computeTotals(all<CalcLine>('SELECT * FROM order_items WHERE order_id=?', id), o as CalcOrder, getSettings());
  run(
    'UPDATE orders SET subtotal=?, discount=?, tax=?, service_charge=?, packaging=?, round_off=?, total=? WHERE id=?',
    t.subtotal, t.discount, t.tax, t.service_charge, t.packaging, t.round_off, t.total, id,
  );
}

export function loadKot(id: Id): Row {
  const k = requireRow(
    get(
      `SELECT k.*, o.order_no, o.type, o.notes AS order_notes, o.guests, t.name AS table_name, u.name AS created_by_name
       FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=k.created_by
       WHERE k.id=?`,
      id,
    ),
    'KOT',
  );
  k.items = all('SELECT * FROM order_items WHERE kot_id=? ORDER BY id', id);
  return k;
}

/** Totals per payment mode; split bills count each part under its own mode */
export function paymentSplit(rows: Row[]) {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const ps: { mode: string; amount: number }[] = r.payments ? JSON.parse(r.payments) : [{ mode: r.payment_mode || 'cash', amount: r.total }];
    for (const p of ps) m[p.mode] = (m[p.mode] || 0) + Number(p.amount);
  }
  return Object.entries(m)
    .map(([mode, amount]) => ({ mode, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/** Discount fields from a request, if any; only front-desk roles may set them */
export function discountFields(body: Body, user: User): { type: string; value: number } | null {
  if (!('discount_value' in body) && !('discount_type' in body)) return null;
  if (!FRONT.includes(user.role)) fail(403, 'Only cashier or manager can apply discounts');
  const type = body.discount_type === 'percent' ? 'percent' : 'flat';
  const value = Math.max(0, num(body.discount_value));
  if (type === 'percent' && value > 100) fail(400, 'Discount cannot exceed 100%');
  return { type, value };
}
