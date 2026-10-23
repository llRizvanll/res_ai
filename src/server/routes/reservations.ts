// Table reservations.
import { fail, type Body, SERVICE, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { text, numIn, dateOpt, timeOpt, phoneOpt, refOpt, requireRow } from '../core/validate.js';
import { onAudit, row } from '../core/audit.js';
import { all, get, run } from '../db/index.js';
import { RESERVATION_STATUSES } from '../../shared/domain.js';

function resValues(b: Body, isNew: boolean): unknown[] {
  const date = dateOpt(b.date, 'Date') || fail(400, 'Date is required');
  if (isNew && date < todayStr()) fail(400, 'Reservation date cannot be in the past');
  return [
    text(b.name, 'Guest name', 80, true), phoneOpt(b.phone), Math.round(numIn(b.guests, 'Number of guests', 1, 100, 2)),
    date, timeOpt(b.time, 'Time') || fail(400, 'Time is required'), refOpt(b.table_id, 'dining_tables', 'Table'), text(b.notes, 'Notes', 300),
  ];
}

api.get('/api/reservations', SERVICE, ({ query }) => {
  const from = query.from || todayStr();
  const to = query.to || '9999-12-31';
  return all(
    `SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id=r.table_id
     WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.time`,
    from, to,
  );
});

api.post('/api/reservations', SERVICE, ({ body }) => {
  const id = run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', ...resValues(body, true)).id;
  return get('SELECT * FROM reservations WHERE id=?', id);
});

api.put('/api/reservations/:id', SERVICE, ({ params, body }) => {
  requireRow(get('SELECT id FROM reservations WHERE id=?', params.id), 'Reservation');
  if (body.status && Object.keys(body).length === 1) {
    if (!(RESERVATION_STATUSES as readonly string[]).includes(body.status)) fail(400, 'Invalid status');
    run('UPDATE reservations SET status=? WHERE id=?', body.status, params.id);
  } else {
    run('UPDATE reservations SET name=?, phone=?, guests=?, date=?, time=?, table_id=?, notes=? WHERE id=?', ...resValues(body, false), params.id);
  }
});

api.del('/api/reservations/:id', SERVICE, ({ params }) => {
  run('DELETE FROM reservations WHERE id=?', params.id);
});


onAudit('POST /api/reservations', { after: (_c, r) => ['reservation.create', `Booked ${r.name} for ${r.guests} on ${r.date} ${r.time || ''}`, { id: r.id }] });

onAudit('PUT /api/reservations/:id', {
  before: row('reservations'),
  after: (c, _r, b) => ['reservation.update', c.body.status && Object.keys(c.body).length === 1 ? `Reservation ${b?.name} marked ${c.body.status}` : `Edited reservation of ${c.body.name}`, { id: c.params.id }],
});

onAudit('DELETE /api/reservations/:id', { before: row('reservations'), after: (c, _r, b) => ['reservation.delete', `Deleted reservation of ${b?.name} (${b?.date})`, { id: c.params.id }] });
