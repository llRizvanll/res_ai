// Kitchen display: running KOTs and their status.
import { fail, ALL, api } from '../core/http.js';
import { broadcast } from '../core/events.js';
import { requireRow } from '../core/validate.js';
import { onAudit } from '../core/audit.js';
import { all, get, run } from '../db/index.js';
import { loadKot } from '../services/orders.js';
import { KOT_STATUSES } from '../../shared/domain.js';

api.get('/api/kots', ALL, () => {
  const kots = all(
    `SELECT k.*, o.order_no, o.type, o.notes AS order_notes, t.name AS table_name, u.name AS created_by_name
     FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=k.created_by
     WHERE o.status!='cancelled' AND k.status IN ('new','preparing','ready') AND k.created_at >= datetime('now','localtime','-1 day')
     ORDER BY k.id`,
  );
  if (!kots.length) return [];
  const items = all(`SELECT * FROM order_items WHERE kot_id IN (${kots.map(() => '?').join(',')}) ORDER BY id`, ...kots.map((k) => k.id));
  for (const k of kots) k.items = items.filter((i) => i.kot_id === k.id);
  return kots;
});

api.get('/api/kots/:id', ALL, ({ params }) => loadKot(params.id));

api.patch('/api/kots/:id', ALL, ({ params, body }) => {
  if (!(KOT_STATUSES as readonly string[]).includes(body.status)) fail(400, 'Invalid status');
  requireRow(get('SELECT id FROM kots WHERE id=?', params.id), 'KOT');
  run("UPDATE kots SET status=?, updated_at=datetime('now','localtime') WHERE id=?", body.status, params.id);
  broadcast('kot', 'orders');
  return loadKot(params.id);
});


onAudit('PATCH /api/kots/:id', { after: (_c, k) => ['kot.status', `KOT #${k.kot_no} (${k.order_no}) → ${k.status}`, { id: k.id }] });
