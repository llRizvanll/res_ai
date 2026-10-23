// Backups: list, save, download (tracked per account), delete and restore.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fail, type Ctx, ADMIN, api } from '../../core/http.js';
import { requirePassword } from '../../core/session.js';
import { ALL_EVENTS, broadcast } from '../../core/events.js';
import { todayStr, sqlPath } from '../../core/util.js';
import { audit, onAudit } from '../../core/audit.js';
import { all, get, run, tx, exec, current } from '../../db/index.js';
import { ensureSettings } from '../../db/seed/index.js';
import { snapshot, verifyBackup, listBackups } from '../../services/backup.js';

function backupPath(name: string): string {
  if (!/^[\w.-]+\.db$/.test(name)) fail(400, 'Invalid backup name');
  const p = path.join(current().backupDir, name);
  if (!fs.existsSync(p)) fail(404, 'Backup not found');
  return p;
}

// Tables copied back on restore, parents before children (FKs are off during restore anyway)
const DATA_TABLES = [
  'settings', 'users', 'areas', 'dining_tables', 'categories', 'items', 'customers', 'orders', 'kots', 'order_items',
  'inventory', 'recipes', 'stock_moves', 'reservations', 'expenses', 'recurring_expenses',
];

function recordDownload(c: Ctx, name: string) {
  run('INSERT INTO backup_downloads (name, user_id, user_name) VALUES (?,?,?)', name, c.user.id, c.user.name);
  audit(c, 'backup.download', `Downloaded backup ${name}`);
}

api.get('/api/backup', ADMIN, (c) => {
  const { res } = c;
  run('INSERT INTO backup_downloads (name, user_id, user_name) VALUES (?,?,?)', `current-${todayStr()}`, c.user.id, c.user.name);
  const file = path.join(os.tmpdir(), `myretailcare-backup-${Date.now()}.db`);
  exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="myretailcare-backup-${todayStr()}.db"`,
  });
  fs.createReadStream(file).on('close', () => fs.rm(file, () => {})).pipe(res);
});

api.get('/api/admin/backups', ADMIN, () => listBackups());

api.post('/api/admin/backups', ADMIN, ({ body }) => {
  const label = String(body.label || 'manual').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'manual';
  return { name: snapshot(label) };
});

api.get('/api/admin/backups/:name', ADMIN, (c) => {
  const { params, res } = c;
  const file = backupPath(params.name);
  recordDownload(c, params.name);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${params.name}"` });
  fs.createReadStream(file).pipe(res);
});

api.del('/api/admin/backups/:name', ADMIN, ({ params }) => {
  fs.rmSync(backupPath(params.name));
});

api.post('/api/admin/backups/:name/restore', ADMIN, ({ params, body, user }) => {
  requirePassword(user, body.password);
  const file = backupPath(params.name);
  if (!verifyBackup(file)) fail(400, 'This backup file is damaged and cannot be restored. Choose another one.');
  const safety = snapshot('before-restore');
  exec('PRAGMA foreign_keys = OFF');
  try {
    exec(`ATTACH DATABASE ${sqlPath(file)} AS b`);
    try {
      tx(() => {
        for (const t of DATA_TABLES) {
          if (!get("SELECT 1 FROM b.sqlite_master WHERE type='table' AND name=?", t)) continue;
          // Only copy columns both sides know, so backups from older versions still restore
          const mine = new Set(all<{ name: string }>(`PRAGMA main.table_info(${t})`).map((c) => c.name));
          const cols = all<{ name: string }>(`PRAGMA b.table_info(${t})`).map((c) => c.name).filter((c) => mine.has(c)).join(', ');
          run(`DELETE FROM main.${t}`);
          exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM b.${t}`);
        }
        run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users WHERE active=1)');
      });
    } finally {
      exec('DETACH DATABASE b');
    }
  } finally {
    exec('PRAGMA foreign_keys = ON');
  }
  ensureSettings();
  broadcast(...ALL_EVENTS);
  return { safety };
});

onAudit('GET /api/backup', { after: () => ['backup.download', 'Downloaded a copy of the current data'] });

onAudit('POST /api/admin/backups', { after: (_c, r) => ['backup.create', `Saved backup ${r.name}`] });

onAudit('DELETE /api/admin/backups/:name', { after: (c) => ['backup.delete', `Deleted backup ${c.params.name}`] });

onAudit('POST /api/admin/backups/:name/restore', { after: (c) => ['backup.restore', `Restored backup ${c.params.name}`] });
