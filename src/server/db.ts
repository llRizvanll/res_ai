import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Each restaurant has its own database file, backups and staff accounts.
// The original single-restaurant data is the "main" restaurant and stays in DATA_DIR itself.
export const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
const REGISTRY = path.join(DATA_DIR, 'restaurants.json');
fs.mkdirSync(LOG_DIR, { recursive: true });

const NOW = "(datetime('now','localtime'))";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL, phone TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS dining_tables (
  id INTEGER PRIMARY KEY, area_id INTEGER REFERENCES areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL, seats INTEGER DEFAULT 4, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, code TEXT, description TEXT, price REAL NOT NULL DEFAULT 0, tax_rate REAL DEFAULT 5,
  veg INTEGER DEFAULT 1, available INTEGER DEFAULT 1, variants TEXT DEFAULT '[]', sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, email TEXT, address TEXT,
  birthday TEXT, notes TEXT, points REAL DEFAULT 0, total_spent REAL DEFAULT 0, visits INTEGER DEFAULT 0,
  last_visit TEXT, created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, order_no TEXT, type TEXT NOT NULL,
  table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  guests INTEGER DEFAULT 0, status TEXT DEFAULT 'open', bill_printed INTEGER DEFAULT 0,
  subtotal REAL DEFAULT 0, discount_type TEXT DEFAULT 'flat', discount_value REAL DEFAULT 0, discount REAL DEFAULT 0,
  tax REAL DEFAULT 0, service_charge REAL DEFAULT 0, packaging REAL DEFAULT 0, round_off REAL DEFAULT 0, total REAL DEFAULT 0,
  payment_mode TEXT, payments TEXT, notes TEXT, delivery_address TEXT, cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, settled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}, closed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders(closed_at);

CREATE TABLE IF NOT EXISTS kots (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, kot_no INTEGER,
  status TEXT DEFAULT 'new', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}, updated_at TEXT);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  kot_id INTEGER REFERENCES kots(id) ON DELETE SET NULL, item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  name TEXT, variant TEXT, price REAL, qty REAL, tax_rate REAL, notes TEXT,
  cancelled INTEGER DEFAULT 0, cancel_reason TEXT, created_at TEXT DEFAULT ${NOW});
CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT DEFAULT 'kg', stock REAL DEFAULT 0,
  min_stock REAL DEFAULT 0, cost REAL DEFAULT 0, created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS recipes (
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE CASCADE,
  qty REAL NOT NULL, PRIMARY KEY (item_id, inventory_id));

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, inventory_id INTEGER REFERENCES inventory(id) ON DELETE CASCADE,
  type TEXT, qty REAL, cost REAL DEFAULT 0, supplier TEXT, note TEXT, order_id INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, guests INTEGER DEFAULT 2, date TEXT NOT NULL, time TEXT,
  table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL, status TEXT DEFAULT 'booked', notes TEXT,
  created_at TEXT DEFAULT ${NOW});

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT, amount REAL NOT NULL, paid_to TEXT, note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT ${NOW});
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, amount REAL NOT NULL, paid_to TEXT, note TEXT,
  frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, next_date TEXT NOT NULL, active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT ${NOW});
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT ${NOW}, user_id INTEGER, user_name TEXT, role TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, summary TEXT, amount REAL, details TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);

CREATE TABLE IF NOT EXISTS backup_downloads (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, at TEXT DEFAULT ${NOW}, user_id INTEGER, user_name TEXT);
`;

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
function openDatabase(file: string, backupDir: string): { d: DatabaseSync; note: string | null } {
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

function migrate(d: DatabaseSync) {
  // FULL sync: a committed bill survives a power cut. WAL keeps reads fast while writing.
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  d.exec(SCHEMA);
  const ensureColumn = (table: string, col: string, decl: string) => {
    const cols = (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  };
  // client_ref makes order/KOT creation safe to retry after a dropped connection
  ensureColumn('orders', 'client_ref', 'TEXT');
  ensureColumn('kots', 'client_ref', 'TEXT');
  // Expenses generated from a recurring template point back to it
  ensureColumn('expenses', 'recurring_id', 'INTEGER');
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_ref ON orders(client_ref) WHERE client_ref IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_kots_ref ON kots(client_ref) WHERE client_ref IS NOT NULL;
  `);
}

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
export function listTenants(): Tenant[] {
  return readRegistry().map((r) => openTenant(r.slug));
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
  if (slug === 'main') throw new Error('The main restaurant cannot be removed');
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
const cur = () => current().db;

// Rows come back as loosely-typed records; callers narrow them where it matters
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Bind = string | number | bigint | null | Uint8Array;

// node:sqlite rejects undefined and booleans as bind values
const clean = (p: unknown[]): Bind[] =>
  p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Bind)));

export const all = <T = Row>(sql: string, ...p: unknown[]): T[] => cur().prepare(sql).all(...clean(p)) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]): T | undefined =>
  cur().prepare(sql).get(...clean(p)) as T | undefined;
export function run(sql: string, ...p: unknown[]): { changes: number; id: number } {
  const r = cur().prepare(sql).run(...clean(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  const d = cur();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Raw SQL on the current restaurant's database (pragmas, VACUUM INTO, ATTACH) */
export const exec = (sql: string) => cur().exec(sql);

export type Settings = Record<string, string>;

export function getSettings(): Settings {
  const o: Settings = {};
  for (const r of all('SELECT key, value FROM settings')) o[r.key] = r.value;
  return o;
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pw, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
