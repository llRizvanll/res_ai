// Daily closing report and the owner's download reminder.
import { ADMIN, api } from '../../core/http.js';
import { todayStr } from '../../core/util.js';
import { num } from '../../core/validate.js';
import { all, get } from '../../db/index.js';
import { listBackups, closingTime, kindOf } from '../../services/backup.js';

api.get('/api/admin/daily', ADMIN, ({ query }) => {
  const days = Math.min(Math.max(num(query.days, 30), 1), 366);
  const backups = listBackups();
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = get<{ d: string }>("SELECT date('now','localtime',?) AS d", `-${i} day`)!.d;
    const sales = get('SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales FROM orders WHERE status=\'completed\' AND date(closed_at)=?', day)!;
    const pick = (kind: string) => backups.find((b) => kindOf(b.name) === kind && b.name.startsWith(`${kind}-${day}`));
    const backup = pick('closing') || pick('daily') || null;
    const dl = backup ? get('SELECT at, user_name FROM backup_downloads WHERE name=? ORDER BY id DESC LIMIT 1', backup.name) : null;
    const accounts = all('SELECT DISTINCT user_name FROM activity_log WHERE date(at)=? AND user_name IS NOT NULL ORDER BY user_name', day).map((r) => r.user_name);
    out.push({ day, orders: sales.orders, sales: sales.sales, backup, downloaded: dl || null, accounts });
  }
  return { closing_time: closingTime(), days: out };
});

/** What the owner should do today about backups (shown on the dashboard after closing time) */
api.get('/api/admin/backup-reminder', ADMIN, () => {
  const today = todayStr();
  const closing = listBackups().find((b) => b.name.startsWith(`closing-${today}`)) || null;
  const downloaded = closing ? get('SELECT at, user_name FROM backup_downloads WHERE name=? ORDER BY id DESC LIMIT 1', closing.name) : null;
  const lastDl = get<{ at: string | null }>('SELECT MAX(at) AS at FROM backup_downloads')!.at;
  return { closing_time: closingTime(), closing, downloaded: downloaded || null, last_download: lastDl };
});
