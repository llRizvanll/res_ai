// Restaurant registry: each restaurant has its own database file, backups and staff accounts.
// Every query runs against the restaurant chosen for the current request (see withTenant).
import type { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './schema.js';

export const DATA_DIR = config.dataDir;
const REGISTRY = path.join(DATA_DIR, 'restaurants.json');

export interface MirrorStatus {
  dir: string | null;
  ok: boolean | null;
  at: string | null;
  error: string | null;
}

export interface Tenant {
  slug: string;
  dir: string;
  file: string;
  backupDir: string;
  db: DatabaseSync;
  recoveryNote: string | null;
  // backup bookkeeping, per restaurant
  changesAtLastBackup: number;
  lastBackup: { name: string; at: string } | null;
  lastBackupError: string | null;
  mirror: MirrorStatus;
}

/** True when SQLite's own consistency check passes and the file looks like our database */
// ---------------------------------------------------------------- restaurant registry
interface RegistryEntry {
  slug: string;
  created_at: string;
}
const tenants = new Map<string, Tenant>();
const als = new AsyncLocalStorage<Tenant>();

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const tenantDir = (slug: string) => (slug === 'main' ? DATA_DIR : path.join(DATA_DIR, 'restaurants', slug));

function readRegistry(): RegistryEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as RegistryEntry[];
    if (Array.isArray(list) && list.some((r) => r.slug === 'main')) return list.filter((r) => SLUG_RE.test(r.slug) || r.slug === 'main');
  } catch {
    /* first run, or unreadable — rebuild below */
  }
  // Rebuild from folders on disk so a lost registry never hides a restaurant's data
  const list: RegistryEntry[] = [{ slug: 'main', created_at: new Date().toISOString() }];
  const dir = path.join(DATA_DIR, 'restaurants');
  if (fs.existsSync(dir)) {
    for (const slug of fs.readdirSync(dir)) {
      if (SLUG_RE.test(slug) && fs.existsSync(path.join(dir, slug, 'restaurant.db'))) list.push({ slug, created_at: new Date().toISOString() });
    }
  }
  writeRegistry(list);
  return list;
}
function writeRegistry(list: RegistryEntry[]) {
  const tmp = REGISTRY + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, REGISTRY);
}

export function openTenant(slug: string): Tenant {
  const cached = tenants.get(slug);
  if (cached) return cached;
  const dir = tenantDir(slug);
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(dir, 'restaurant.db');
  const { d, note } = openDatabase(file, backupDir);
  migrate(d);
  const t: Tenant = {
    slug, dir, file, backupDir, db: d, recoveryNote: note, changesAtLastBackup: -1, lastBackup: null, lastBackupError: null,
    mirror: { dir: null, ok: null, at: null, error: null },
  };
  tenants.set(slug, t);
  return t;
}

/** All restaurants, opened */
/** All restaurants, opened — including the built-in demo */
export function listTenants(): Tenant[] {
  return readRegistry().map((r) => openTenant(r.slug));
}
export const isDemoSlug = (slug: string) => slug === config.demo.slug;
/** Real restaurants only (the demo is not backed up, not on the sign-in list) */
export const realTenants = (): Tenant[] => listTenants().filter((t) => !isDemoSlug(t.slug));

/** Throws away a restaurant's database (not its backups) and opens a fresh, empty one */
export function recreateTenant(slug: string): Tenant {
  const t = tenants.get(slug);
  if (t) {
    t.db.close();
    tenants.delete(slug);
  }
  const file = path.join(tenantDir(slug), 'restaurant.db');
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  return openTenant(slug);
}
export function tenantExists(slug: string): boolean {
  return readRegistry().some((r) => r.slug === slug);
}
export function registerTenant(slug: string): Tenant {
  const list = readRegistry();
  if (list.some((r) => r.slug === slug)) throw new Error('A restaurant with that code already exists');
  const t = openTenant(slug);
  list.push({ slug, created_at: new Date().toISOString() });
  writeRegistry(list);
  return t;
}
/** Removes a restaurant from the list and moves its whole folder to data/archived (nothing is deleted) */
export function archiveTenant(slug: string): string {
  if (slug === 'main' || isDemoSlug(slug)) throw new Error('This restaurant cannot be removed');
  const t = tenants.get(slug);
  if (t) {
    t.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    t.db.close();
    tenants.delete(slug);
  }
  const dest = path.join(DATA_DIR, 'archived', `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tenantDir(slug), dest);
  writeRegistry(readRegistry().filter((r) => r.slug !== slug));
  return dest;
}

/** Runs fn with the given restaurant as the target of every query */
export function withTenant<T>(t: Tenant, fn: () => T): T {
  return als.run(t, fn);
}
export function current(): Tenant {
  const t = als.getStore();
  if (!t) throw new Error('No restaurant selected for this operation');
  return t;
}
/** The database of the restaurant for the current request */
export const currentDb = () => current().db;
