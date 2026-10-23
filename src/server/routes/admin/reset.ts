// Reset centre: clear chosen data (or everything) after a safety backup.
import { fail, ADMIN, api } from '../../core/http.js';
import { requirePassword } from '../../core/session.js';
import { ALL_EVENTS, broadcast } from '../../core/events.js';
import { count } from '../../core/util.js';
import { onAudit } from '../../core/audit.js';
import { run, tx, getSettings } from '../../db/index.js';
import { FRESH_SETTINGS, BRANDING_KEYS } from '../../db/seed/index.js';
import { snapshot } from '../../services/backup.js';

const RESET_SCOPES = [
  'orders', 'customers', 'reservations', 'expenses', 'stock_history', 'stock_levels', 'inventory', 'menu', 'floor', 'staff',
  'settings', 'branding', 'activity',
] as const;

type Scope = (typeof RESET_SCOPES)[number];

api.post('/api/admin/reset', ADMIN, ({ body, user }) => {
  const scopes = new Set<Scope>(
    body.everything ? RESET_SCOPES : (Array.isArray(body.scopes) ? body.scopes : []).filter((x: string) => RESET_SCOPES.includes(x as Scope)),
  );
  if (!scopes.size) fail(400, 'Choose at least one thing to reset');
  if (String(body.confirm || '').trim().toUpperCase() !== 'RESET') fail(400, 'Type RESET to confirm');
  requirePassword(user, body.password);
  const open = count("SELECT COUNT(*) AS n FROM orders WHERE status='open'");
  if (open && !scopes.has('orders') && (scopes.has('menu') || scopes.has('floor'))) {
    fail(400, `There are ${open} running orders. Settle or cancel them first, or also clear "Orders & sales".`);
  }
  const backup = snapshot('before-reset');
  const has = (x: Scope) => scopes.has(x);
  tx(() => {
    if (has('orders')) {
      run('DELETE FROM orders'); // KOTs and order items cascade
      run("DELETE FROM stock_moves WHERE type='consumption'");
      run('UPDATE customers SET visits=0, total_spent=0, points=0, last_visit=NULL');
    }
    if (has('customers')) run('DELETE FROM customers');
    if (has('reservations')) run('DELETE FROM reservations');
    if (has('expenses')) {
      run('DELETE FROM expenses');
      run('DELETE FROM recurring_expenses');
    }
    if (has('stock_history')) run('DELETE FROM stock_moves');
    if (has('stock_levels')) run('UPDATE inventory SET stock=0');
    if (has('inventory')) run('DELETE FROM inventory'); // recipes & movements cascade
    if (has('menu')) {
      run('DELETE FROM items');
      run('DELETE FROM categories');
    }
    if (has('floor')) {
      run('DELETE FROM dining_tables');
      run('DELETE FROM areas');
    }
    if (has('staff')) run('DELETE FROM users WHERE id != ?', user.id);
    const put = (k: string) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, FRESH_SETTINGS[k]);
    if (has('settings')) for (const k of Object.keys(FRESH_SETTINGS)) if (!BRANDING_KEYS.includes(k)) put(k);
    if (has('branding')) for (const k of BRANDING_KEYS) put(k);
    if (has('activity')) {
      run('DELETE FROM activity_log');
      run('DELETE FROM backup_downloads');
    }
    if (body.everything) {
      put('demo_data');
      put('setup_billing');
    }
  });
  broadcast(...ALL_EVENTS);
  return { backup, settings: getSettings() };
});

onAudit('POST /api/admin/reset', { after: (c) => ['data.reset', c.body.everything ? 'Erased everything (start fresh)' : `Cleared: ${(c.body.scopes || []).join(', ')}`] });
