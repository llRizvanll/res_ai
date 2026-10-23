// Demo restaurant: open it for reference, or reset it to fresh sample data.
import crypto from 'node:crypto';
import { api, fail, addGuard, ADMIN } from '../core/http.js';
import { onAudit } from '../core/audit.js';
import { closeTenantClients } from '../core/events.js';
import { current, isDemoSlug } from '../db/index.js';
import { ensureDemo, demoSession } from '../services/demo.js';
import { config } from '../config.js';

const newToken = () => `${config.demo.slug}.${crypto.randomBytes(24).toString('hex')}`;

/** Any restaurant's admin can open the demo; they get a demo-only session for a separate tab */
api.post('/api/demo/open', ADMIN, () => {
  if (isDemoSlug(current().slug)) fail(400, 'You are already in the demo');
  const t = ensureDemo();
  const token = newToken();
  demoSession(t, token);
  return { token, name: config.demo.name };
});

/** Fresh sample data (only from inside the demo) */
api.post('/api/demo/reset', ADMIN, () => {
  if (!isDemoSlug(current().slug)) fail(400, 'Only the demo restaurant can be reset this way');
  closeTenantClients(config.demo.slug);
  const t = ensureDemo(true);
  const token = newToken();
  demoSession(t, token);
  return { token };
});

// The demo is a sandbox: nothing done inside it may reach real restaurants, backups or the file system
const BLOCKED_IN_DEMO = new Set([
  'POST /api/restaurants',
  'POST /api/restaurants/current/archive',
  'POST /api/admin/backups/:name/restore',
  'DELETE /api/admin/backups/:name',
  'GET /api/backup',
]);
addGuard((c, r) => {
  if (!isDemoSlug(current().slug)) return;
  if (BLOCKED_IN_DEMO.has(`${r.method} ${r.pattern}`) || (r.pattern === '/api/settings' && 'backup_mirror_dir' in c.body)) {
    fail(403, 'Not available in the demo restaurant');
  }
});

onAudit('POST /api/demo/open', { after: () => ['demo.open', 'Opened the demo restaurant for reference'] });
