import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'restaurant.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const NOW = "(datetime('now','localtime'))";

db.exec(`
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
`);

// Rows come back as loosely-typed records; callers narrow them where it matters
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Bind = string | number | bigint | null | Uint8Array;

// node:sqlite rejects undefined and booleans as bind values
const clean = (p: unknown[]): Bind[] =>
  p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Bind)));

export const all = <T = Row>(sql: string, ...p: unknown[]): T[] => db.prepare(sql).all(...clean(p)) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]): T | undefined =>
  db.prepare(sql).get(...clean(p)) as T | undefined;
export function run(sql: string, ...p: unknown[]): { changes: number; id: number } {
  const r = db.prepare(sql).run(...clean(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

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
