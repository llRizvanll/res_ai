// Billing: printing the bill and settling it (payments, stock deduction, loyalty).
import { fail, FRONT, SERVICE, api } from '../../core/http.js';
import { broadcast } from '../../core/events.js';
import { num, numIn } from '../../core/validate.js';
import { onAudit, cur$ } from '../../core/audit.js';
import { all, get, run, tx, getSettings, type Row } from '../../db/index.js';
import { loadOrder, openOrder, recalc } from '../../services/orders.js';
import { r2 } from '../../../shared/calc.js';
import { PAYMENT_MODES } from '../../../shared/domain.js';

api.post('/api/orders/:id/bill', SERVICE, ({ params }) => {
  const o = openOrder(params.id);
  if (!get('SELECT 1 FROM order_items WHERE order_id=? AND cancelled=0', o.id)) fail(400, 'No items on this order');
  run('UPDATE orders SET bill_printed=1 WHERE id=?', o.id);
  broadcast('tables');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/settle', FRONT, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const items = all('SELECT * FROM order_items WHERE order_id=? AND cancelled=0', o.id);
  if (!items.length) fail(400, 'Cannot settle an order without items');
  const s = getSettings();
  tx(() => {
    recalc(o.id);
    const fresh = get('SELECT * FROM orders WHERE id=?', o.id)!;
    const MODES: readonly string[] = PAYMENT_MODES;
    const raw = Array.isArray(body.payments) ? body.payments : [];
    if (raw.length > 10) fail(400, 'Too many payment parts');
    let payments = raw
      .map((p: Row) => {
        if (!MODES.includes(String(p?.mode))) fail(400, `Unknown payment mode “${p?.mode}”`);
        return { mode: String(p.mode), amount: r2(numIn(p.amount, 'Payment amount', 0, 10_000_000)) };
      })
      .filter((p: { amount: number }) => p.amount > 0);
    const single = String(body.payment_mode || 'cash');
    if (!MODES.includes(single)) fail(400, `Unknown payment mode “${single}”`);
    if (!payments.length) payments = [{ mode: single, amount: fresh.total }];
    const paid = r2(payments.reduce((a, p) => a + p.amount, 0));
    if (Math.abs(paid - fresh.total) > 0.5) fail(400, `Payments (${paid}) do not match bill total (${fresh.total})`);
    const mode = payments.length > 1 ? 'split' : payments[0].mode;
    run(
      "UPDATE orders SET status='completed', bill_printed=1, payment_mode=?, payments=?, settled_by=?, closed_at=datetime('now','localtime') WHERE id=?",
      mode, JSON.stringify(payments), user.id, o.id,
    );

    // Auto-deduct raw materials using each item's recipe
    for (const it of items) {
      for (const rec of all('SELECT * FROM recipes WHERE item_id=?', it.item_id)) {
        const q = rec.qty * it.qty;
        run('UPDATE inventory SET stock=stock-? WHERE id=?', q, rec.inventory_id);
        // Cost at the time of sale, so later price changes don't rewrite past food-cost figures
        run(
          "INSERT INTO stock_moves (inventory_id, type, qty, cost, order_id, note, user_id) VALUES (?, 'consumption', ?, (SELECT cost FROM inventory WHERE id=?), ?, ?, ?)",
          rec.inventory_id, -q, rec.inventory_id, o.id, fresh.order_no, user.id,
        );
      }
    }

    if (fresh.customer_id) {
      const points = Math.floor((fresh.total / 100) * num(s.loyalty_rate));
      run(
        "UPDATE customers SET total_spent=total_spent+?, visits=visits+1, points=points+?, last_visit=datetime('now','localtime') WHERE id=?",
        fresh.total, points, fresh.customer_id,
      );
    }
  });
  broadcast('tables', 'orders', 'kot');
  return loadOrder(o.id);
});

onAudit('POST /api/orders/:id/bill', { after: (_c, o) => ['order.bill', `Printed bill ${o.order_no} for ${cur$(o.total)}`, { id: o.id, amount: o.total }] });

onAudit('POST /api/orders/:id/settle', {
  after: (_c, o) => ['order.settle', `Settled ${o.order_no} for ${cur$(o.total)} — ${o.payments.map((p: Row) => `${p.mode} ${cur$(p.amount)}`).join(' + ')}`, { id: o.id, amount: o.total }],
});
