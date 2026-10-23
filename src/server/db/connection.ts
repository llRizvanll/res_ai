// Opening a restaurant's database safely: integrity check, automatic recovery from the newest good backup.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/** True when SQLite's own consistency check passes and the file looks like our database */
export function isHealthy(d: DatabaseSync, requireSchema = false): boolean {
  try {
    const rows = d.prepare('PRAGMA quick_check').all() as Record<string, unknown>[];
    if (rows.length !== 1 || Object.values(rows[0]!)[0] !== 'ok') return false;
    return !requireSchema || !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'").get();
  } catch {
    return false;
  }
}

/** Newest backup in a folder that opens cleanly and passes the integrity check */
export function latestGoodBackup(backupDir: string): string | null {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => path.join(backupDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files) {
    let d: DatabaseSync | null = null;
    try {
      d = new DatabaseSync(f);
      if (isHealthy(d, true)) return f;
    } catch {
      /* unreadable backup — try the next one */
    } finally {
      d?.close();
    }
  }
  return null;
}

/** Opens a database file; a damaged file is set aside and replaced from the newest good backup */
export function openDatabase(file: string, backupDir: string): { d: DatabaseSync; note: string | null } {
  let d: DatabaseSync | null = null;
  try {
    d = new DatabaseSync(file);
    if (!isHealthy(d)) {
      d.close();
      d = null;
    }
  } catch {
    d = null;
  }
  if (d) return { d, note: null };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const damaged = path.join(path.dirname(file), `restaurant.damaged-${stamp}.db`);
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(file + ext)) fs.renameSync(file + ext, damaged + ext);
  const good = latestGoodBackup(backupDir);
  let note: string;
  if (good) {
    fs.copyFileSync(good, file);
    note = `The database file was damaged and has been restored automatically from the backup “${path.basename(good)}”. Anything entered after that backup may need re-entering. The damaged file was kept as ${path.basename(damaged)}.`;
  } else {
    note = `The database file was damaged and no usable backup was found, so an empty database was started. The damaged file was kept as ${path.basename(damaged)} — keep it for recovery.`;
  }
  console.error('\n  !!! ' + note + '\n');
  return { d: new DatabaseSync(file), note };
}

