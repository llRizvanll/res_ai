// Raw materials, stock movements (purchase, wastage, counts) and their history.
import { fail, type Body, MGR, api } from '../core/http.js';
import { num, text, numIn, unique, requireRow } from '../core/validate.js';
import { onAudit, row } from '../core/audit.js';
import { all, get, run, tx } from '../db/index.js';
import { safeguard } from '../services/backup.js';
import { STOCK_UNITS } from '../../shared/domain.js';

function invValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Name', 80, true);
  unique('inventory', 'name', name, 'Raw material', exceptId);
  const unit = text(b.unit, 'Unit', 10) || 'kg';
  if (!STOCK_UNITS.includes(unit)) fail(400, `Unit must be one of ${STOCK_UNITS.join(', ')}`);
  return [name, unit, numIn(b.min_stock, 'Minimum level', 0, 1_000_000, 0), numIn(b.cost, 'Cost per unit', 0, 1_000_000, 0)];
}

api.get('/api/inventory', MGR, () =>
  all(
    `SELECT i.*, (SELECT COUNT(*) FROM recipes r WHERE r.inventory_id=i.id) AS used_in,
      (SELECT COALESCE(SUM(-m.qty),0) FROM stock_moves m WHERE m.inventory_id=i.id AND m.type='consumption'
        AND m.created_at >= datetime('now','localtime','-7 day')) AS used_7d
     FROM inventory i ORDER BY i.name`,
  ),
);

api.post('/api/inventory', MGR, ({ body, user }) => {
  const id = tx(() => {
    const stock = numIn(body.stock, 'Opening stock', 0, 1_000_000, 0);
    const id = run('INSERT INTO inventory (name, unit, min_stock, cost, stock) VALUES (?,?,?,?,?)', ...invValues(body), stock).id;
    if (stock > 0) {
      run("INSERT INTO stock_moves (inventory_id, type, qty, cost, note, user_id) VALUES (?, 'adjust', ?, ?, 'Opening stock', ?)", id, stock, num(body.cost), user.id);
    }
    return id;
  });
  return get('SELECT * FROM inventory WHERE id=?', id);
});

api.put('/api/inventory/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM inventory WHERE id=?', params.id), 'Raw material');
  run('UPDATE inventory SET name=?, unit=?, min_stock=?, cost=? WHERE id=?', ...invValues(body, params.id), params.id);
  return get('SELECT * FROM inventory WHERE id=?', params.id);
});

api.del('/api/inventory/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM inventory WHERE id=?', params.id), 'Raw material');
  safeguard();
  run('DELETE FROM inventory WHERE id=?', params.id);
});

api.post('/api/inventory/:id/move', MGR, ({ params, body, user }) => {
  const inv = requireRow(get('SELECT * FROM inventory WHERE id=?', params.id), 'Inventory item');
  const qty = numIn(body.qty, 'Quantity', 0, 1_000_000);
  const cost = numIn(body.cost, 'Cost per unit', 0, 1_000_000, 0);
  const supplier = text(body.supplier, 'Supplier', 80);
  const note = text(body.note, 'Note', 200);
  if (body.type === 'wastage' && qty > inv.stock + 1e-9) fail(400, `Wastage (${qty}) is more than the stock in hand (${inv.stock} ${inv.unit})`);
  let change: number;
  if (body.type === 'purchase') change = qty;
  else if (body.type === 'wastage') change = -qty;
  else if (body.type === 'adjust') change = qty - inv.stock;
  else return fail(400, 'Invalid movement type');
  if (body.type !== 'adjust' && qty === 0) fail(400, 'Quantity must be more than zero');
  const unitCost = cost > 0 ? cost : inv.cost;
  tx(() => {
    run('UPDATE inventory SET stock=stock+? WHERE id=?', change, inv.id);
    if (body.type === 'purchase' && cost > 0) run('UPDATE inventory SET cost=? WHERE id=?', unitCost, inv.id);
    run(
      'INSERT INTO stock_moves (inventory_id, type, qty, cost, supplier, note, user_id) VALUES (?,?,?,?,?,?,?)',
      inv.id, body.type, change, unitCost, supplier, note, user.id,
    );
  });
  return get('SELECT * FROM inventory WHERE id=?', inv.id);
});

api.get('/api/stock-moves', MGR, ({ query }) => {
  const w = [];
  const p = [];
  if (query.inventory_id) w.push('m.inventory_id=?') && p.push(query.inventory_id);
  if (query.type) w.push('m.type=?') && p.push(query.type);
  if (query.from) w.push('date(m.created_at)>=?') && p.push(query.from);
  if (query.to) w.push('date(m.created_at)<=?') && p.push(query.to);
  return all(
    `SELECT m.*, i.name, i.unit, u.name AS user_name, o.order_no FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
     LEFT JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ${Math.min(num(query.limit, 300), 3000)}`,
    ...p,
  );
});


onAudit('POST /api/inventory', { after: (_c, r) => ['inventory.create', `Added raw material ${r.name} (${r.stock} ${r.unit})`, { id: r.id }] });

onAudit('PUT /api/inventory/:id', { after: (_c, r) => ['inventory.update', `Edited raw material ${r.name}`, { id: r.id }] });

onAudit('DELETE /api/inventory/:id', { before: row('inventory'), after: (c, _r, b) => ['inventory.delete', `Deleted raw material ${b?.name} (had ${b?.stock} ${b?.unit})`, { id: c.params.id, details: b }] });

onAudit('POST /api/inventory/:id/move', {
  before: row('inventory'),
  after: (c, r, b) => {
    const t = String(c.body.type);
    const what = t === 'purchase' ? `Purchased ${c.body.qty} ${r.unit}` : t === 'wastage' ? `Wastage ${c.body.qty} ${r.unit}` : `Stock count ${b?.stock} → ${r.stock} ${r.unit}`;
    return [`inventory.${t}`, `${what} of ${r.name}${c.body.supplier ? ` from ${c.body.supplier}` : ''}`, { id: r.id, amount: t === 'purchase' ? num(c.body.qty) * r.cost : null }];
  },
});
