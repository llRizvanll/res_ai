// Verified snapshots of each restaurant's database: automatic schedule, closing-time copy,
// rotation and an optional off-site mirror. Everything here acts on the current restaurant (see withTenant).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { current, exec, get, getSettings, isHealthy, realTenants, withTenant, type Tenant } from '../db/index.js';
import { log } from '../core/log.js';
import { config } from '../config.js';

const KEEP = config.backup.keep;

export const AUTO_INTERVAL_MIN = config.backup.intervalMin;
const CLOSING_CHECK_SEC = config.backup.closingCheckSec;

const sqlPath = (p: string) => `'${p.replace(/'/g, "''")}'`;
export const kindOf = (name: string) => name.replace(/-\d{4}-\d{2}-\d{2}_.*$/, '');
const totalChanges = () => get<{ n: number }>('SELECT total_changes() AS n')!.n;

export function verifyBackup(file: string): boolean {
  let d: DatabaseSync | null = null;
  try {
    d = new DatabaseSync(file);
    return isHealthy(d, true);
  } catch {
    return false;
  } finally {
    d?.close();
  }
}

const localStamp = () => get<{ t: string }>("SELECT strftime('%Y-%m-%d_%H-%M-%S','now','localtime') AS t")!.t;
const localDay = () => localStamp().slice(0, 10);
const localHHMM = () => get<{ t: string }>("SELECT strftime('%H:%M','now','localtime') AS t")!.t;

export function mirrorDir(): string | null {
  return (getSettings().backup_mirror_dir || config.backup.mirrorDir || '').trim() || null;
}

/** Checks a folder can receive backups; returns an error message or null */
export function checkMirrorDir(dir: string): string | null {
  if (!path.isAbsolute(dir)) return 'Use a full folder path, e.g. /Volumes/USB/restaurant-backups or D:\\Backups';
  try {
    if (!fs.statSync(dir).isDirectory()) return 'That path is not a folder';
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return null;
  } catch (e) {
    return `Cannot write to that folder (${(e as NodeJS.ErrnoException).code || (e as Error).message})`;
  }
}

function prune(dir: string) {
  const byKind: Record<string, { f: string; t: number }[]> = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.db')) continue;
    const k = kindOf(f);
    if (!(k in KEEP)) continue;
    (byKind[k] ??= []).push({ f, t: fs.statSync(path.join(dir, f)).mtimeMs });
  }
  for (const [k, files] of Object.entries(byKind)) {
    files.sort((a, b) => b.t - a.t);
    for (const old of files.slice(KEEP[k])) fs.rmSync(path.join(dir, old.f), { force: true });
  }
}

function mirror(file: string) {
  const t = current();
  const root = mirrorDir();
  t.mirror.dir = root;
  if (!root) return;
  try {
    const problem = checkMirrorDir(root);
    if (problem) throw new Error(problem);
    // Each restaurant gets its own sub-folder so branches sharing a USB drive never mix
    const dir = t.slug === 'main' ? root : path.join(root, t.slug);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, path.basename(file) + '.tmp');
    fs.copyFileSync(file, tmp);
    fs.renameSync(tmp, path.join(dir, path.basename(file)));
    prune(dir);
    Object.assign(t.mirror, { ok: true, at: new Date().toISOString(), error: null });
  } catch (e) {
    Object.assign(t.mirror, { ok: false, at: new Date().toISOString(), error: (e as Error).message });
    log.error(`[${t.slug}] Off-site backup copy to ${root} failed:`, e);
  }
}

/** Writes a consistent copy of the live DB, verifies it, then mirrors and rotates. Never call inside a transaction. */
export function snapshot(label: string): string {
  const t = current();
  let name = `${label}-${localStamp()}.db`;
  for (let i = 2; fs.existsSync(path.join(t.backupDir, name)); i++) name = `${label}-${localStamp()}-${i}.db`;
  const final = path.join(t.backupDir, name);
  const tmp = final + '.tmp';
  try {
    exec(`VACUUM INTO ${sqlPath(tmp)}`);
    if (!verifyBackup(tmp)) throw new Error('the copy failed its integrity check');
    fs.renameSync(tmp, final);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    t.lastBackupError = `${new Date().toLocaleString()}: ${(e as Error).message}`;
    log.error(`[${t.slug}] Backup "${label}" failed:`, e);
    throw new Error(`Backup failed: ${(e as Error).message}`);
  }
  t.lastBackupError = null;
  t.changesAtLastBackup = totalChanges();
  t.lastBackup = { name, at: new Date().toISOString() };
  mirror(final);
  prune(t.backupDir);
  return name;
}

/** Snapshot only if something changed since the last backup; errors are logged, not thrown */
export function backupIfChanged(label: string): string | null {
  if (totalChanges() === current().changesAtLastBackup) return null;
  try {
    return snapshot(label);
  } catch {
    return null;
  }
}

const hasBackup = (kind: string, day: string) => fs.readdirSync(current().backupDir).some((f) => f.startsWith(`${kind}-${day}`));

export function closingTime(): string {
  const fallback = config.backup.defaultClosingTime;
  const v = getSettings().closing_time || fallback;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
}

/** The end-of-day backup: taken once per day at the restaurant's closing time */
export function closingBackupDue(): boolean {
  return localHHMM() >= closingTime() && !hasBackup('closing', localDay());
}

function tick(t: Tenant, full: boolean) {
  withTenant(t, () => {
    try {
      if (closingBackupDue()) {
        const name = snapshot('closing');
        log.info(`[${t.slug}] Closing-time backup saved: ${name}`);
      }
      if (full) {
        backupIfChanged('auto');
        if (!hasBackup('daily', localDay())) snapshot('daily');
      }
    } catch {
      /* already logged */
    }
  });
}

/** Start-up copy for every restaurant, then the recurring schedule */
export function startSchedule() {
  for (const t of realTenants()) {
    withTenant(t, () => {
      try {
        snapshot('startup');
        if (!hasBackup('daily', localDay())) snapshot('daily');
      } catch {
        /* already logged */
      }
    });
  }
  let elapsed = 0;
  setInterval(() => {
    elapsed += CLOSING_CHECK_SEC;
    const full = elapsed >= AUTO_INTERVAL_MIN * 60;
    if (full) elapsed = 0;
    for (const t of realTenants()) tick(t, full);
  }, CLOSING_CHECK_SEC * 1000).unref();
}

export interface BackupFile {
  name: string;
  size: number;
  created: string;
}
export function listBackups(): BackupFile[] {
  const dir = current().backupDir;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, created: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Restorable copy taken right before anything is deleted, so a wrong tap can always be undone */
export function safeguard() {
  snapshot('before-delete');
}
