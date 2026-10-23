// Dining areas and tables.
import { fail, type Body, MGR, ALL, api } from '../core/http.js';
import { broadcast } from '../core/events.js';
import { text, numIn, refOpt, unique, requireRow } from '../core/validate.js';
import { onAudit, row } from '../core/audit.js';
import { all, get, run } from '../db/index.js';
import { safeguard } from '../services/backup.js';

function tableValues(body: Body, exceptId?: unknown): unknown[] {
  const area = refOpt(body.area_id, 'areas', 'Area') ?? fail(400, 'Choose an area for the table');
  const name = text(body.name, 'Table name', 20, true);
  unique('dining_tables', 'name', name, 'Table', exceptId);
  return [area, name, Math.round(numIn(body.seats, 'Seats', 1, 100, 4)), numIn(body.sort, 'Order', 0, 9999, 0)];
}

api.get('/api/tables', ALL, () => ({
  areas: all('SELECT * FROM areas ORDER BY sort, id'),
  tables: all(
    `SELECT t.*, o.id AS order_id, o.order_no, o.total, o.guests, o.bill_printed, o.created_at AS order_time,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM dining_tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status='open' ORDER BY t.sort, t.id`,
  ),
  open: all(
    `SELECT o.id, o.order_no, o.type, o.total, o.created_at, o.bill_printed, c.name AS customer_name, c.phone AS customer_phone,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='open' AND o.type!='dine_in' ORDER BY o.id`,
  ),
}));


api.post('/api/areas', MGR, ({ body }) => {
  const name = text(body.name, 'Area name', 40, true);
  unique('areas', 'name', name, 'Area');
  const id = run('INSERT INTO areas (name, sort) VALUES (?, ?)', name, numIn(body.sort, 'Order', 0, 9999, 0)).id;
  broadcast('tables');
  return get('SELECT * FROM areas WHERE id=?', id);
});

api.put('/api/areas/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM areas WHERE id=?', params.id), 'Area');
  const name = text(body.name, 'Area name', 40, true);
  unique('areas', 'name', name, 'Area', params.id);
  run('UPDATE areas SET name=?, sort=? WHERE id=?', name, numIn(body.sort, 'Order', 0, 9999, 0), params.id);
  broadcast('tables');
});

api.del('/api/areas/:id', MGR, ({ params }) => {
  if (get("SELECT 1 FROM orders o JOIN dining_tables t ON t.id=o.table_id WHERE t.area_id=? AND o.status='open'", params.id)) {
    fail(400, 'This area has tables with running orders');
  }
  safeguard();
  run('DELETE FROM areas WHERE id=?', params.id);
  broadcast('tables');
});


api.post('/api/tables', MGR, ({ body }) => {
  const id = run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', ...tableValues(body)).id;
  broadcast('tables');
  return get('SELECT * FROM dining_tables WHERE id=?', id);
});

api.put('/api/tables/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', params.id), 'Table');
  run('UPDATE dining_tables SET area_id=?, name=?, seats=?, sort=? WHERE id=?', ...tableValues(body, params.id), params.id);
  broadcast('tables');
});

api.del('/api/tables/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', params.id), 'Table');
  if (get("SELECT 1 FROM orders WHERE table_id=? AND status='open'", params.id)) fail(400, 'Table has a running order');
  safeguard();
  run('DELETE FROM dining_tables WHERE id=?', params.id);
  broadcast('tables');
});


// (named backup downloads are logged inside their handler, together with the download record)
onAudit('POST /api/areas', { after: (_c, r) => ['floor.area_create', `Added area “${r.name}”`, { id: r.id }] });

onAudit('PUT /api/areas/:id', { before: row('areas'), after: (c, _r, b) => ['floor.area_update', `Renamed area “${b?.name}” to “${c.body.name}”`, { id: c.params.id }] });

onAudit('DELETE /api/areas/:id', { before: row('areas'), after: (c, _r, b) => ['floor.area_delete', `Deleted area “${b?.name}” and its tables`, { id: c.params.id }] });

onAudit('POST /api/tables', { after: (_c, r) => ['floor.table_create', `Added table ${r.name} (${r.seats} seats)`, { id: r.id }] });

onAudit('PUT /api/tables/:id', { before: row('dining_tables'), after: (c, _r, b) => ['floor.table_update', `Edited table ${b?.name} → ${c.body.name}, ${c.body.seats} seats`, { id: c.params.id }] });

onAudit('DELETE /api/tables/:id', { before: row('dining_tables'), after: (c, _r, b) => ['floor.table_delete', `Deleted table ${b?.name}`, { id: c.params.id }] });
