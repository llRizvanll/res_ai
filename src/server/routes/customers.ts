// Customer records (CRM) with order history and favourites.
import { fail, type Body, MGR, FRONT, SERVICE, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { num, text, numIn, dateOpt, emailOpt, phoneOpt, unique, requireRow, bulkIds } from '../core/validate.js';
import { onAudit, row } from '../core/audit.js';
import { all, get, run } from '../db/index.js';
import { safeguard } from '../services/backup.js';

function customerValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Customer name', 80, true);
  const phone = phoneOpt(b.phone) || fail(400, 'Phone number is required');
  unique('customers', 'phone', phone, 'A customer with phone', exceptId);
  const birthday = dateOpt(b.birthday, 'Birthday');
  if (birthday && birthday > todayStr()) fail(400, 'Birthday cannot be in the future');
  return [name, phone, emailOpt(b.email), text(b.address, 'Address', 300), birthday, text(b.notes, 'Notes', 500)];
}

api.get('/api/customers', SERVICE, ({ query }) => {
  const s = `%${query.q || ''}%`;
  return all(
    'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY last_visit IS NULL, last_visit DESC, name LIMIT ?',
    s, s, s, Math.min(num(query.limit, 300), 2000),
  );
});

api.get('/api/customers/:id', SERVICE, ({ params }) => {
  const c = requireRow(get('SELECT * FROM customers WHERE id=?', params.id), 'Customer');
  c.orders = all(
    "SELECT id, order_no, type, total, status, created_at FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 50", params.id,
  );
  c.favourites = all(
    `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.customer_id=? AND o.status='completed' AND oi.cancelled=0 GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
    params.id,
  );
  return c;
});

api.post('/api/customers', SERVICE, ({ body }) => {
  const id = run('INSERT INTO customers (name, phone, email, address, birthday, notes) VALUES (?,?,?,?,?,?)', ...customerValues(body)).id;
  return get('SELECT * FROM customers WHERE id=?', id);
});

api.put('/api/customers/:id', FRONT, ({ params, body }) => {
  requireRow(get('SELECT id FROM customers WHERE id=?', params.id), 'Customer');
  run('UPDATE customers SET name=?, phone=?, email=?, address=?, birthday=?, notes=? WHERE id=?', ...customerValues(body, params.id), params.id);
  if ('points' in body && body.points !== null) run('UPDATE customers SET points=? WHERE id=?', Math.round(numIn(body.points, 'Loyalty points', 0, 10_000_000)), params.id);
  return get('SELECT * FROM customers WHERE id=?', params.id);
});

api.del('/api/customers/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM customers WHERE id=?', params.id), 'Customer');
  safeguard();
  run('DELETE FROM customers WHERE id=?', params.id);
});


api.post('/api/customers/bulk-delete', MGR, ({ body }) => {
  const ids = bulkIds(body);
  safeguard();
  run(`DELETE FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return { deleted: ids.length };
});


onAudit('POST /api/customers', { after: (_c, r) => ['customer.create', `Added customer ${r.name} (${r.phone})`, { id: r.id }] });

onAudit('PUT /api/customers/:id', { after: (c, r) => ['customer.update', `Edited customer ${r.name}${'points' in c.body ? `, points set to ${r.points}` : ''}`, { id: r.id }] });

onAudit('DELETE /api/customers/:id', { before: row('customers'), after: (c, _r, b) => ['customer.delete', `Deleted customer ${b?.name} (${b?.phone})`, { id: c.params.id, details: b }] });

onAudit('POST /api/customers/bulk-delete', { after: (c, r) => ['customer.delete', `Deleted ${r.deleted} customers`, { details: c.body.ids }] });
