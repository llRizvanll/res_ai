// Orders: list, open, update (customer, guests, discount), move, cancel and delete.
import { fail, ADMIN, FRONT, SERVICE, api } from '../../core/http.js';
import { broadcast } from '../../core/events.js';
import { str, num, text, numIn, dateOpt, refOpt, requireRow } from '../../core/validate.js';
import { onAudit, cur$, orderOf } from '../../core/audit.js';
import { all, get, run, tx, getSettings } from '../../db/index.js';
import { safeguard } from '../../services/backup.js';
import { loadOrder, openOrder, recalc, discountFields } from '../../services/orders.js';
import { config } from '../../config.js';

api.get('/api/orders', SERVICE, ({ query }) => {
  const w = [];
  const p = [];
  if (query.status) w.push('o.status=?') && p.push(query.status);
  if (query.type) w.push('o.type=?') && p.push(query.type);
  if (query.from) w.push('date(o.created_at)>=?') && p.push(dateOpt(query.from, 'From date'));
  if (query.to) w.push('date(o.created_at)<=?') && p.push(dateOpt(query.to, 'To date'));
  if (query.customer_id) w.push('o.customer_id=?') && p.push(query.customer_id);
  if (query.q) {
    w.push('(o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR t.name LIKE ?)');
    const s = `%${query.q}%`;
    p.push(s, s, s, s);
  }
  const limit = Math.min(num(query.limit, 500), config.limits.listMax);
  return all(
    `SELECT o.id, o.order_no, o.type, o.status, o.subtotal, o.discount, o.tax, o.total, o.payment_mode, o.created_at, o.closed_at,
      o.bill_printed, o.guests, t.name AS table_name, c.name AS customer_name, c.phone AS customer_phone, u.name AS created_by_name,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id
     LEFT JOIN users u ON u.id=o.created_by ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ${limit}`,
    ...p,
  );
});

api.get('/api/orders/:id', SERVICE, ({ params }) => loadOrder(params.id));

api.post('/api/orders', SERVICE, ({ body, user }) => {
  const type = body.type;
  if (!['dine_in', 'takeaway', 'delivery'].includes(type)) fail(400, 'Invalid order type');
  refOpt(body.customer_id, 'customers', 'Customer');
  numIn(body.guests, 'Guests', 0, 200, 0);
  text(body.notes, 'Order note', 300);
  text(body.delivery_address, 'Delivery address', 300);
  if (type === 'dine_in') {
    if (!body.table_id) fail(400, 'Select a table for dine-in orders');
    refOpt(body.table_id, 'dining_tables', 'Table');
    const existing = get("SELECT id FROM orders WHERE table_id=? AND status='open'", body.table_id);
    if (existing) return loadOrder(existing.id);
  }
  const ref = str(body.client_ref);
  const dup = ref && get('SELECT id FROM orders WHERE client_ref=?', ref);
  if (dup) return loadOrder(dup.id); // same request retried after a dropped connection
  const disc = discountFields(body, user) || { type: 'flat', value: 0 };
  const s = getSettings();
  const id = tx(() => {
    const id = run(
      'INSERT INTO orders (type, table_id, customer_id, guests, notes, delivery_address, discount_type, discount_value, created_by, client_ref) VALUES (?,?,?,?,?,?,?,?,?,?)',
      type, type === 'dine_in' ? body.table_id : null, body.customer_id || null, num(body.guests), str(body.notes),
      type === 'delivery' ? str(body.delivery_address) : null, disc.type, disc.value, user.id, ref,
    ).id;
    run('UPDATE orders SET order_no=? WHERE id=?', `${s.invoice_prefix || 'INV'}-${String(id).padStart(5, '0')}`, id);
    return id;
  });
  broadcast('tables', 'orders');
  return loadOrder(id);
});

api.put('/api/orders/:id', SERVICE, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const disc = discountFields(body, user);
  tx(() => {
    if ('customer_id' in body) run('UPDATE orders SET customer_id=? WHERE id=?', refOpt(body.customer_id, 'customers', 'Customer'), o.id);
    if ('guests' in body) run('UPDATE orders SET guests=? WHERE id=?', Math.round(numIn(body.guests, 'Guests', 0, 200, 0)), o.id);
    if ('notes' in body) run('UPDATE orders SET notes=? WHERE id=?', text(body.notes, 'Order note', 300), o.id);
    if ('delivery_address' in body) run('UPDATE orders SET delivery_address=? WHERE id=?', text(body.delivery_address, 'Delivery address', 300), o.id);
    if (disc) run('UPDATE orders SET discount_type=?, discount_value=? WHERE id=?', disc.type, disc.value, o.id);
    recalc(o.id);
  });
  broadcast('tables', 'orders');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/cancel', FRONT, ({ params, body }) => {
  const o = openOrder(params.id);
  const reason = text(body.reason, 'Reason for cancelling', 200) || fail(400, 'Please give a reason for cancelling');
  run("UPDATE orders SET status='cancelled', cancel_reason=?, closed_at=datetime('now','localtime') WHERE id=?", reason, o.id);
  broadcast('tables', 'orders', 'kot');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/move', SERVICE, ({ params, body }) => {
  const o = openOrder(params.id);
  if (o.type !== 'dine_in') fail(400, 'Only dine-in orders can be moved');
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', body.table_id), 'Table');
  if (get("SELECT 1 FROM orders WHERE table_id=? AND status='open' AND id!=?", body.table_id, o.id)) fail(400, 'That table is occupied');
  run('UPDATE orders SET table_id=? WHERE id=?', body.table_id, o.id);
  broadcast('tables', 'kot');
  return loadOrder(o.id);
});

api.del('/api/orders/:id', ADMIN, ({ params }) => {
  const o = requireRow(get('SELECT * FROM orders WHERE id=?', params.id), 'Order');
  safeguard();
  const s = getSettings();
  tx(() => {
    // Put back raw material consumed by this bill (generated demo history never touched stock)
    for (const m of all("SELECT * FROM stock_moves WHERE order_id=? AND type='consumption' AND COALESCE(note,'') != 'Demo history'", o.id)) {
      run('UPDATE inventory SET stock=stock-? WHERE id=?', m.qty, m.inventory_id);
    }
    run('DELETE FROM stock_moves WHERE order_id=?', o.id);
    if (o.status === 'completed' && o.customer_id) {
      const pts = Math.floor((o.total / 100) * num(s.loyalty_rate));
      run(
        'UPDATE customers SET total_spent=MAX(0, total_spent-?), visits=MAX(0, visits-1), points=MAX(0, points-?) WHERE id=?',
        o.total, pts, o.customer_id,
      );
    }
    run('DELETE FROM orders WHERE id=?', o.id);
  });
  broadcast('tables', 'orders', 'kot');
});

onAudit('POST /api/orders', { after: (_c, o) => ['order.create', `Opened ${o.order_no} · ${o.type.replace('_', '-')}${o.table_name ? ` · ${o.table_name}` : ''}`, { id: o.id }] });

onAudit('PUT /api/orders/:id', {
  after: (c, o) => {
    if ('discount_value' in c.body) {
      return ['order.discount', `Discount on ${o.order_no}: ${o.discount_type === 'percent' ? `${o.discount_value}%` : 'flat'} = ${cur$(o.discount)}`, { id: o.id, amount: o.discount }];
    }
    if ('customer_id' in c.body) return ['order.customer', `${o.order_no} customer: ${o.customer_name || 'removed'}`, { id: o.id }];
    return null;
  },
});

onAudit('POST /api/orders/:id/cancel', { after: (_c, o) => ['order.cancel', `Cancelled ${o.order_no} (${cur$(o.total)}) — ${o.cancel_reason}`, { id: o.id, amount: o.total }] });

onAudit('POST /api/orders/:id/move', { before: orderOf, after: (_c, o) => ['order.move', `Moved ${o.order_no} to table ${o.table_name}`, { id: o.id }] });

onAudit('DELETE /api/orders/:id', {
  before: orderOf,
  after: (c, _r, b) => ['order.delete', `Permanently deleted ${b?.order_no} (${b?.status}, ${cur$(b?.total)})`, { id: c.params.id, amount: b?.total, details: b }],
});
