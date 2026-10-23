// Order items: sending KOTs (retry-safe) and voiding or changing lines.
import { fail, FRONT, SERVICE, api } from '../../core/http.js';
import { broadcast } from '../../core/events.js';
import { str, text, numIn, requireRow } from '../../core/validate.js';
import { onAudit } from '../../core/audit.js';
import { get, run, tx, type Row } from '../../db/index.js';
import { loadOrder, openOrder, recalc, loadKot } from '../../services/orders.js';
import { config } from '../../config.js';

api.post('/api/orders/:id/kot', SERVICE, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const ref = str(body.client_ref);
  const dup = ref && get('SELECT id FROM kots WHERE client_ref=?', ref);
  if (dup) return { order: loadOrder(o.id), kot: loadKot(dup.id), duplicate: true };
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length > config.limits.kotLines) fail(400, `Too many lines in one KOT (max ${config.limits.kotLines})`);
  const lines: Row[] = raw.map((l: Row) => ({ ...l, qty: numIn(l?.qty, 'Quantity', 0.001, 999), notes: text(l?.notes, 'Item note', 200) }));
  if (!lines.length) fail(400, 'Add at least one item');
  const kotId = tx(() => {
    const kotNo = get("SELECT COALESCE(MAX(kot_no),0)+1 AS n FROM kots WHERE date(created_at)=date('now','localtime')")!.n;
    const kid = run('INSERT INTO kots (order_id, kot_no, created_by, client_ref) VALUES (?,?,?,?)', o.id, kotNo, user.id, ref).id;
    for (const l of lines) {
      const it = requireRow(get('SELECT * FROM items WHERE id=?', l.item_id), 'Menu item');
      if (!it.available) fail(400, `${it.name} is currently unavailable`);
      let price = it.price;
      let variant = null;
      if (!l.variant && JSON.parse(it.variants || '[]').length) fail(400, `Choose a portion/variant for ${it.name}`);
      if (l.variant) {
        const v = (JSON.parse(it.variants || '[]') as Row[]).find((v) => v.name === l.variant);
        if (!v) return fail(400, `Unknown variant ${l.variant} for ${it.name}`);
        price = v.price;
        variant = v.name;
      }
      run(
        'INSERT INTO order_items (order_id, kot_id, item_id, name, variant, price, qty, tax_rate, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        o.id, kid, it.id, it.name, variant, price, l.qty, it.tax_rate, l.notes,
      );
    }
    run('UPDATE orders SET bill_printed=0 WHERE id=?', o.id);
    recalc(o.id);
    return kid;
  });
  broadcast('kot', 'tables', 'orders');
  return { order: loadOrder(o.id), kot: loadKot(kotId) };
});

api.patch('/api/order-items/:id', FRONT, ({ params, body }) => {
  const it = requireRow(get('SELECT * FROM order_items WHERE id=?', params.id), 'Item');
  openOrder(it.order_id);
  if (body.cancelled && it.cancelled) fail(400, 'This item is already voided');
  if (!body.cancelled && !('qty' in body)) fail(400, 'Nothing to change');
  const reason = text(body.reason, 'Reason', 200);
  const q = 'qty' in body && !body.cancelled ? numIn(body.qty, 'Quantity', 0.001, 999) : null;
  tx(() => {
    if (body.cancelled) run('UPDATE order_items SET cancelled=1, cancel_reason=? WHERE id=?', reason, it.id);
    else run('UPDATE order_items SET qty=? WHERE id=?', q, it.id);
    recalc(it.order_id);
  });
  broadcast('kot', 'tables', 'orders');
  return loadOrder(it.order_id);
});

onAudit('POST /api/orders/:id/kot', {
  after: (_c, r) =>
    r.duplicate
      ? null
      : ['order.kot', `KOT #${r.kot.kot_no} for ${r.order.order_no}: ${r.kot.items.map((i: Row) => `${i.qty}× ${i.name}`).join(', ').slice(0, 200)}`, { id: r.order.id }],
});

onAudit('PATCH /api/order-items/:id', {
  before: (c) => get('SELECT oi.*, o.order_no FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=?', c.params.id),
  after: (c, _r, b) =>
    c.body.cancelled
      ? ['order.void', `Voided ${b.qty}× ${b.name} on ${b.order_no}${c.body.reason ? ` — ${c.body.reason}` : ''}`, { id: b.order_id, amount: b.qty * b.price }]
      : ['order.qty', `Changed ${b.name} on ${b.order_no}: qty ${b.qty} → ${c.body.qty}`, { id: b.order_id }],
});
