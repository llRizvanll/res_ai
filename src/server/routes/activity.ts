// Activity log queries: per-entry history and per-account daily summaries.
import { ADMIN, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { num, dateOpt } from '../core/validate.js';
import { all } from '../db/index.js';
import { config } from '../config.js';

api.get('/api/activity', ADMIN, ({ query }) => {
  const from = dateOpt(query.from, 'From date') || todayStr();
  const to = dateOpt(query.to, 'To date') || from;
  const w = ['date(at) BETWEEN ? AND ?'];
  const p: unknown[] = [from, to];
  if (query.user_id) w.push('user_id=?') && p.push(Number(query.user_id));
  if (query.action) w.push('action LIKE ?') && p.push(`${String(query.action).replace(/[%_]/g, '')}%`);
  if (query.q) w.push('(summary LIKE ? OR user_name LIKE ?)') && p.push(`%${query.q}%`, `%${query.q}%`);
  return all(
    `SELECT id, at, user_id, user_name, role, action, entity, entity_id, summary, amount, ip FROM activity_log
     WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${Math.min(num(query.limit, 1000), config.limits.listMax)}`,
    ...p,
  );
});


/** Per-account totals for one day: what each login did */
api.get('/api/activity/summary', ADMIN, ({ query }) => {
  const day = dateOpt(query.date, 'Date') || todayStr();
  return all(
    `SELECT COALESCE(user_name,'(unknown)') AS user_name, role, user_id,
      MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*) AS actions,
      SUM(action='auth.login') AS logins, SUM(action='auth.login_failed') AS failed_logins,
      SUM(action='order.kot') AS kots, SUM(action='order.settle') AS bills, COALESCE(SUM(CASE WHEN action='order.settle' THEN amount END),0) AS sales,
      SUM(action='order.void') AS voids, COALESCE(SUM(CASE WHEN action='order.void' THEN amount END),0) AS void_value,
      SUM(action='order.discount') AS discounts, SUM(action='order.cancel') AS cancels,
      SUM(action LIKE '%delete%') AS deletes
     FROM activity_log WHERE date(at)=? GROUP BY user_id, user_name ORDER BY sales DESC, actions DESC`,
    day,
  );
});
