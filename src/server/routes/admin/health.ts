// Data-safety health: database checks, backup status, warnings, recovery notice.
import fs from 'node:fs';
import { ADMIN, api } from '../../core/http.js';
import { count, STARTED_AT } from '../../core/util.js';
import { log } from '../../core/log.js';
import { all, get, run, getSettings, current, isHealthy, isDemoSlug } from '../../db/index.js';
import { listBackups, mirrorDir, AUTO_INTERVAL_MIN } from '../../services/backup.js';

function healthWarnings(): string[] {
  if (isDemoSlug(current().slug)) return []; // the demo is never backed up on purpose
  const w: string[] = [];
  const s = getSettings();
  if (s.recovery_note) w.push(s.recovery_note);
  const t = current();
  if (t.lastBackupError) w.push(`The last automatic backup failed (${t.lastBackupError}). Check free disk space.`);
  const newest = listBackups()[0];
  if (!newest || Date.now() - Date.parse(newest.created) > 26 * 3600_000) w.push('No backup has been saved in the last 24 hours.');
  if (t.mirror.ok === false) w.push(`Copying backups to the off-site folder failed: ${t.mirror.error}`);
  const lastDl = get<{ at: string }>('SELECT MAX(at) AS at FROM backup_downloads');
  const hasOrders = count("SELECT COUNT(*) AS n FROM orders WHERE created_at >= datetime('now','localtime','-7 day')") > 0;
  if (hasOrders && !t.mirror.dir && (!lastDl?.at || Date.parse(lastDl.at.replace(' ', 'T')) < Date.now() - 7 * 86400_000)) {
    w.push('No backup has been downloaded or copied off this computer in the last 7 days. Download the closing backup from Settings → Data, reset & backup.');
  }
  return w;
}

api.get('/api/admin/health', ADMIN, () => {
  const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const backups = listBackups();
  return {
    healthy: isHealthy(current().db),
    db_size: size(current().file) + size(current().file + '-wal'),
    data_dir: current().dir,
    backup_dir: current().backupDir,
    backups: backups.length,
    newest_backup: backups[0] || null,
    last_backup: current().lastBackup,
    interval_min: AUTO_INTERVAL_MIN,
    mirror: { ...current().mirror, dir: mirrorDir() },
    started_at: STARTED_AT,
    recovery_note: getSettings().recovery_note || null,
    warnings: healthWarnings(),
  };
});

api.post('/api/admin/health/check', ADMIN, () => {
  const rows = all('PRAGMA integrity_check');
  const ok = rows.length === 1 && Object.values(rows[0]!)[0] === 'ok';
  if (!ok) log.error('Full integrity check failed', JSON.stringify(rows.slice(0, 20)));
  return { ok, problems: ok ? [] : rows.slice(0, 20).map((r) => String(Object.values(r)[0])) };
});

api.post('/api/admin/recovery-note/dismiss', ADMIN, () => {
  run("DELETE FROM settings WHERE key='recovery_note'");
});
