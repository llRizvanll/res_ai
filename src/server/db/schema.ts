// Table definitions and in-place upgrades. Every restaurant database gets exactly this schema.
import type { DatabaseSync } from 'node:sqlite';

const NOW = "(datetime('now','localtime'))";
export const SCHEMA = `
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

export function migrate(d: DatabaseSync) {
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

