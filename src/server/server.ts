import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, all, get, run, tx, hashPassword, verifyPassword, getSettings, DATA_DIR, type Row } from './db.js';
import { seed, ensureSettings } from './seed.js';
import { computeTotals, r2, type CalcLine, type CalcOrder } from '../shared/calc.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');

if (!get('SELECT id FROM users LIMIT 1')) {
  console.log('First run: creating database with demo data…');
  seed({ demo: process.env.SEED_DEMO !== '0' });
}
ensureSettings();

// ---------------------------------------------------------------------------
// Infrastructure: errors, routing, auth, live events
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Declared as a function (not an arrow) so TypeScript narrows after `if (...) fail(...)`
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}
// Request bodies are untrusted JSON; every handler validates the fields it reads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Body;
  user: User; // always set on routes that declare roles
}
type Handler = (ctx: Ctx) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  roles: Role[] | null;
  handler: Handler;
}

const ADMIN: Role[] = ['admin'];
const MGR: Role[] = ['admin', 'manager'];
const FRONT: Role[] = ['admin', 'manager', 'cashier'];
const SERVICE: Role[] = ['admin', 'manager', 'cashier', 'waiter'];
const ALL: Role[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];
const ROLES = ALL;

const routes: Route[] = [];
function route(method: string, pattern: string, roles: Role[] | null, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, roles, handler });
}
type Register = (pattern: string, roles: Role[] | null, handler: Handler) => void;
const api: Record<'get' | 'post' | 'put' | 'patch' | 'del', Register> = {
  get: (p, r, h) => route('GET', p, r, h),
  post: (p, r, h) => route('POST', p, r, h),
  put: (p, r, h) => route('PUT', p, r, h),
  patch: (p, r, h) => route('PATCH', p, r, h),
  del: (p, r, h) => route('DELETE', p, r, h),
};

function authUser(req: IncomingMessage, url: URL): User | null {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  if (!token) return null;
  return get<User>(
    'SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1',
    token,
  ) || null;
}

const clients = new Set<ServerResponse>();
function broadcast(...events: string[]) {
  for (const ev of events) {
    const msg = `event: ${ev}\ndata: {}\n\n`;
    for (const c of clients) c.write(msg);
  }
}
setInterval(() => {
  for (const c of clients) c.write(': ping\n\n');
}, 25000).unref();

function events(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!authUser(req, url)) fail(401, 'Please log in');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  try {
    if (url.pathname === '/api/events') return events(req, res, url);
    const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!r) return fail(404, 'Not found');
    const m = url.pathname.match(r.re)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? '')]));
    let user: User | null = null;
    if (r.roles) {
      user = authUser(req, url);
      if (!user) return fail(401, 'Your session has expired. Please log in again.');
      if (!r.roles.includes(user.role)) fail(403, 'Your role does not have permission for this action');
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? await readBody(req) : {};
    const result = await r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, user: user as User });
    if (!res.writableEnded) send(res, 200, result ?? { ok: true });
  } catch (e) {
    const err = e as Partial<HttpError>;
    let status = err.status || 500;
    let message = err.message || String(e);
    const unique = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(message);
    if (unique) {
      status = 400;
      message = `This ${unique[2]} is already in use`;
    } else if (status === 500) {
      console.error(e);
      message = 'Server error: ' + message;
    }
    send(res, status, { error: message });
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(res: ServerResponse, pathname: string) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = path.join(PUBLIC, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Id = number | string;
const pub = (u: Row): User => ({ id: u.id, name: u.name, username: u.username, role: u.role });
const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const num = (v: unknown, d = 0): number => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));
const parseItem = (i: Row): Row => ({ ...i, variants: JSON.parse(i.variants || '[]') });
const todayStr = (): string => get("SELECT date('now','localtime') AS d")!.d;
const requireRow = <T>(row: T, what: string): NonNullable<T> => row ?? fail(404, `${what} not found`);

function loadOrder(id: Id): Row {
  const o = requireRow(
    get(
      `SELECT o.*, t.name AS table_name, c.name AS customer_name, c.phone AS customer_phone, c.points AS customer_points,
        u.name AS created_by_name, su.name AS settled_by_name
       FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN users u ON u.id=o.created_by LEFT JOIN users su ON su.id=o.settled_by WHERE o.id=?`,
      id,
    ),
    'Order',
  );
  o.items = all(
    'SELECT oi.*, k.kot_no, k.status AS kot_status FROM order_items oi LEFT JOIN kots k ON k.id=oi.kot_id WHERE oi.order_id=? ORDER BY oi.id',
    id,
  );
  o.payments = o.payments ? JSON.parse(o.payments) : [];
  return o;
}

function openOrder(id: Id): Row {
  const o = requireRow(get('SELECT * FROM orders WHERE id=?', id), 'Order');
  if (o.status !== 'open') fail(400, `Order ${o.order_no} is already ${o.status}`);
  return o;
}

function recalc(id: Id) {
  const o = get('SELECT * FROM orders WHERE id=?', id)!;
  const t = computeTotals(all<CalcLine>('SELECT * FROM order_items WHERE order_id=?', id), o as CalcOrder, getSettings());
  run(
    'UPDATE orders SET subtotal=?, discount=?, tax=?, service_charge=?, packaging=?, round_off=?, total=? WHERE id=?',
    t.subtotal, t.discount, t.tax, t.service_charge, t.packaging, t.round_off, t.total, id,
  );
}

function loadKot(id: Id): Row {
  const k = requireRow(
    get(
      `SELECT k.*, o.order_no, o.type, o.notes AS order_notes, o.guests, t.name AS table_name, u.name AS created_by_name
       FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=k.created_by
       WHERE k.id=?`,
      id,
    ),
    'KOT',
  );
  k.items = all('SELECT * FROM order_items WHERE kot_id=? ORDER BY id', id);
  return k;
}

function paymentSplit(rows: Row[]) {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const ps: { mode: string; amount: number }[] = r.payments
      ? JSON.parse(r.payments)
      : [{ mode: r.payment_mode || 'cash', amount: r.total }];
    for (const p of ps) m[p.mode] = (m[p.mode] || 0) + Number(p.amount);
  }
  return Object.entries(m)
    .map(([mode, amount]) => ({ mode, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

function discountFields(body: Body, user: User): { type: string; value: number } | null {
  if (!('discount_value' in body) && !('discount_type' in body)) return null;
  if (!FRONT.includes(user.role)) fail(403, 'Only cashier or manager can apply discounts');
  const type = body.discount_type === 'percent' ? 'percent' : 'flat';
  const value = Math.max(0, num(body.discount_value));
  if (type === 'percent' && value > 100) fail(400, 'Discount cannot exceed 100%');
  return { type, value };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
api.post('/api/auth/login', null, ({ body }) => {
  const u = get('SELECT * FROM users WHERE username=? AND active=1', String(body.username || '').trim().toLowerCase());
  if (!u || !verifyPassword(String(body.password || ''), u.password)) fail(401, 'Invalid username or password');
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, u.id);
  run("DELETE FROM sessions WHERE created_at < datetime('now','localtime','-30 day')");
  return { token, user: pub(u) };
});

api.get('/api/auth/me', ALL, ({ user }) => ({ user, settings: getSettings() }));

api.post('/api/auth/logout', ALL, ({ req }) => {
  run('DELETE FROM sessions WHERE token=?', (req.headers.authorization || '').slice(7));
});

api.post('/api/auth/password', ALL, ({ body, user }) => {
  const u = get('SELECT * FROM users WHERE id=?', user.id)!;
  if (!verifyPassword(String(body.current || ''), u.password)) fail(400, 'Current password is incorrect');
  if (String(body.password || '').length < 6) fail(400, 'New password must be at least 6 characters');
  run('UPDATE users SET password=? WHERE id=?', hashPassword(body.password), user.id);
});

// ---------------------------------------------------------------------------
// Settings & backup
// ---------------------------------------------------------------------------
const SETTING_KEYS = [
  'name', 'tagline', 'address', 'phone', 'email', 'gstin', 'fssai', 'currency', 'service_charge', 'packaging_charge',
  'round_off', 'invoice_prefix', 'invoice_footer', 'loyalty_rate', 'kot_auto_print', 'bill_auto_print',
];
api.get('/api/settings', ALL, () => getSettings());
api.put('/api/settings', ADMIN, ({ body }) => {
  tx(() => {
    for (const k of SETTING_KEYS) {
      if (k in body) {
        run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(body[k] ?? ''));
      }
    }
  });
  broadcast('settings');
  return getSettings();
});

api.get('/api/backup', ADMIN, ({ res }) => {
  const file = path.join(os.tmpdir(), `dineflow-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="dineflow-backup-${todayStr()}.db"`,
  });
  fs.createReadStream(file).on('close', () => fs.rm(file, () => {})).pipe(res);
});

// ---------------------------------------------------------------------------
// Floor: areas & tables
// ---------------------------------------------------------------------------
api.get('/api/tables', ALL, () => ({
  areas: all('SELECT * FROM areas ORDER BY sort, id'),
  tables: all(
    `SELECT t.*, o.id AS order_id, o.order_no, o.total, o.guests, o.bill_printed, o.created_at AS order_time,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM dining_tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status='open' ORDER BY t.sort, t.id`,
  ),
  open: all(
    `SELECT o.id, o.order_no, o.type, o.total, o.created_at, o.bill_printed, c.name AS customer_name, c.phone AS customer_phone,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='open' AND o.type!='dine_in' ORDER BY o.id`,
  ),
}));

api.post('/api/areas', MGR, ({ body }) => {
  const name = str(body.name) || fail(400, 'Area name is required');
  const id = run('INSERT INTO areas (name, sort) VALUES (?, ?)', name, num(body.sort)).id;
  broadcast('tables');
  return get('SELECT * FROM areas WHERE id=?', id);
});
api.put('/api/areas/:id', MGR, ({ params, body }) => {
  run('UPDATE areas SET name=?, sort=? WHERE id=?', str(body.name) || fail(400, 'Area name is required'), num(body.sort), params.id);
  broadcast('tables');
});
api.del('/api/areas/:id', MGR, ({ params }) => {
  if (get("SELECT 1 FROM orders o JOIN dining_tables t ON t.id=o.table_id WHERE t.area_id=? AND o.status='open'", params.id)) {
    fail(400, 'This area has tables with running orders');
  }
  run('DELETE FROM areas WHERE id=?', params.id);
  broadcast('tables');
});

api.post('/api/tables', MGR, ({ body }) => {
  const name = str(body.name) || fail(400, 'Table name is required');
  const id = run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', body.area_id, name, num(body.seats, 4), num(body.sort)).id;
  broadcast('tables');
  return get('SELECT * FROM dining_tables WHERE id=?', id);
});
api.put('/api/tables/:id', MGR, ({ params, body }) => {
  run(
    'UPDATE dining_tables SET area_id=?, name=?, seats=?, sort=? WHERE id=?',
    body.area_id, str(body.name) || fail(400, 'Table name is required'), num(body.seats, 4), num(body.sort), params.id,
  );
  broadcast('tables');
});
api.del('/api/tables/:id', MGR, ({ params }) => {
  if (get("SELECT 1 FROM orders WHERE table_id=? AND status='open'", params.id)) fail(400, 'Table has a running order');
  run('DELETE FROM dining_tables WHERE id=?', params.id);
  broadcast('tables');
});

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
api.get('/api/menu', ALL, () => ({
  categories: all('SELECT * FROM categories ORDER BY sort, name'),
  items: all('SELECT * FROM items ORDER BY sort, name').map(parseItem),
}));

api.post('/api/categories', MGR, ({ body }) => {
  const name = str(body.name) || fail(400, 'Category name is required');
  const id = run('INSERT INTO categories (name, sort, active) VALUES (?,?,?)', name, num(body.sort), body.active === false ? 0 : 1).id;
  broadcast('menu');
  return get('SELECT * FROM categories WHERE id=?', id);
});
api.put('/api/categories/:id', MGR, ({ params, body }) => {
  run(
    'UPDATE categories SET name=?, sort=?, active=? WHERE id=?',
    str(body.name) || fail(400, 'Category name is required'), num(body.sort), body.active === false ? 0 : 1, params.id,
  );
  broadcast('menu');
});
api.del('/api/categories/:id', MGR, ({ params }) => {
  run('DELETE FROM categories WHERE id=?', params.id);
  broadcast('menu');
});

function itemValues(b: Body): unknown[] {
  const name = str(b.name) || fail(400, 'Item name is required');
  const variants = (Array.isArray(b.variants) ? b.variants : [])
    .filter((v: Row) => str(v.name))
    .map((v: Row) => ({ name: String(v.name).trim(), price: num(v.price) }));
  return [b.category_id || null, name, str(b.code), str(b.description), num(b.price), num(b.tax_rate), b.veg ? 1 : 0,
    b.available === false ? 0 : 1, JSON.stringify(variants), num(b.sort)];
}
api.post('/api/items', MGR, ({ body }) => {
  const id = run(
    'INSERT INTO items (category_id, name, code, description, price, tax_rate, veg, available, variants, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ...itemValues(body),
  ).id;
  broadcast('menu');
  return parseItem(get('SELECT * FROM items WHERE id=?', id)!);
});
api.put('/api/items/:id', MGR, ({ params, body }) => {
  run(
    'UPDATE items SET category_id=?, name=?, code=?, description=?, price=?, tax_rate=?, veg=?, available=?, variants=?, sort=? WHERE id=?',
    ...itemValues(body), params.id,
  );
  broadcast('menu');
  return parseItem(requireRow(get('SELECT * FROM items WHERE id=?', params.id), 'Item'));
});
api.patch('/api/items/:id/availability', ['admin', 'manager', 'kitchen'], ({ params, body }) => {
  run('UPDATE items SET available=? WHERE id=?', body.available ? 1 : 0, params.id);
  broadcast('menu');
});
api.del('/api/items/:id', MGR, ({ params }) => {
  run('DELETE FROM items WHERE id=?', params.id);
  broadcast('menu');
});

api.get('/api/items/:id/recipe', MGR, ({ params }) =>
  all('SELECT r.inventory_id, r.qty, i.name, i.unit FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.item_id=? ORDER BY i.name', params.id),
);
api.put('/api/items/:id/recipe', MGR, ({ params, body }) => {
  tx(() => {
    run('DELETE FROM recipes WHERE item_id=?', params.id);
    const seen = new Set();
    for (const r of Array.isArray(body.lines) ? body.lines : []) {
      if (!r.inventory_id || !(num(r.qty) > 0) || seen.has(Number(r.inventory_id))) continue;
      seen.add(Number(r.inventory_id));
      run('INSERT INTO recipes (item_id, inventory_id, qty) VALUES (?,?,?)', params.id, r.inventory_id, num(r.qty));
    }
  });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
api.get('/api/orders', SERVICE, ({ query }) => {
  const w = [];
  const p = [];
  if (query.status) w.push('o.status=?') && p.push(query.status);
  if (query.type) w.push('o.type=?') && p.push(query.type);
  if (query.from) w.push('date(o.created_at)>=?') && p.push(query.from);
  if (query.to) w.push('date(o.created_at)<=?') && p.push(query.to);
  if (query.customer_id) w.push('o.customer_id=?') && p.push(query.customer_id);
  if (query.q) {
    w.push('(o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR t.name LIKE ?)');
    const s = `%${query.q}%`;
    p.push(s, s, s, s);
  }
  const limit = Math.min(num(query.limit, 500), 5000);
  return all(
    `SELECT o.id, o.order_no, o.type, o.status, o.subtotal, o.discount, o.tax, o.total, o.payment_mode, o.created_at, o.closed_at,
      o.bill_printed, o.guests, t.name AS table_name, c.name AS customer_name, c.phone AS customer_phone, u.name AS created_by_name,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.cancelled=0) AS item_count
     FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN customers c ON c.id=o.customer_id
     LEFT JOIN users u ON u.id=o.created_by ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ${limit}`,
    ...p,
  );
});

api.get('/api/orders/:id', SERVICE, ({ params }) => loadOrder(params.id));

api.post('/api/orders', SERVICE, ({ body, user }) => {
  const type = body.type;
  if (!['dine_in', 'takeaway', 'delivery'].includes(type)) fail(400, 'Invalid order type');
  if (type === 'dine_in') {
    if (!body.table_id) fail(400, 'Select a table for dine-in orders');
    requireRow(get('SELECT id FROM dining_tables WHERE id=?', body.table_id), 'Table');
    const existing = get("SELECT id FROM orders WHERE table_id=? AND status='open'", body.table_id);
    if (existing) return loadOrder(existing.id);
  }
  const disc = discountFields(body, user) || { type: 'flat', value: 0 };
  const s = getSettings();
  const id = tx(() => {
    const id = run(
      'INSERT INTO orders (type, table_id, customer_id, guests, notes, delivery_address, discount_type, discount_value, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      type, type === 'dine_in' ? body.table_id : null, body.customer_id || null, num(body.guests), str(body.notes),
      type === 'delivery' ? str(body.delivery_address) : null, disc.type, disc.value, user.id,
    ).id;
    run('UPDATE orders SET order_no=? WHERE id=?', `${s.invoice_prefix || 'INV'}-${String(id).padStart(5, '0')}`, id);
    return id;
  });
  broadcast('tables', 'orders');
  return loadOrder(id);
});

api.put('/api/orders/:id', SERVICE, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const disc = discountFields(body, user);
  tx(() => {
    if ('customer_id' in body) run('UPDATE orders SET customer_id=? WHERE id=?', body.customer_id || null, o.id);
    if ('guests' in body) run('UPDATE orders SET guests=? WHERE id=?', num(body.guests), o.id);
    if ('notes' in body) run('UPDATE orders SET notes=? WHERE id=?', str(body.notes), o.id);
    if ('delivery_address' in body) run('UPDATE orders SET delivery_address=? WHERE id=?', str(body.delivery_address), o.id);
    if (disc) run('UPDATE orders SET discount_type=?, discount_value=? WHERE id=?', disc.type, disc.value, o.id);
    recalc(o.id);
  });
  broadcast('tables', 'orders');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/kot', SERVICE, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const lines = (Array.isArray(body.items) ? body.items : []).filter((l) => num(l.qty) > 0);
  if (!lines.length) fail(400, 'Add at least one item');
  const kotId = tx(() => {
    const kotNo = get("SELECT COALESCE(MAX(kot_no),0)+1 AS n FROM kots WHERE date(created_at)=date('now','localtime')")!.n;
    const kid = run('INSERT INTO kots (order_id, kot_no, created_by) VALUES (?,?,?)', o.id, kotNo, user.id).id;
    for (const l of lines) {
      const it = requireRow(get('SELECT * FROM items WHERE id=?', l.item_id), 'Menu item');
      if (!it.available) fail(400, `${it.name} is currently unavailable`);
      let price = it.price;
      let variant = null;
      if (l.variant) {
        const v = (JSON.parse(it.variants || '[]') as Row[]).find((v) => v.name === l.variant);
        if (!v) return fail(400, `Unknown variant ${l.variant} for ${it.name}`);
        price = v.price;
        variant = v.name;
      }
      run(
        'INSERT INTO order_items (order_id, kot_id, item_id, name, variant, price, qty, tax_rate, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        o.id, kid, it.id, it.name, variant, price, num(l.qty), it.tax_rate, str(l.notes),
      );
    }
    run('UPDATE orders SET bill_printed=0 WHERE id=?', o.id);
    recalc(o.id);
    return kid;
  });
  broadcast('kot', 'tables', 'orders');
  return { order: loadOrder(o.id), kot: loadKot(kotId) };
});

api.patch('/api/order-items/:id', FRONT, ({ params, body }) => {
  const it = requireRow(get('SELECT * FROM order_items WHERE id=?', params.id), 'Item');
  openOrder(it.order_id);
  tx(() => {
    if (body.cancelled) {
      run('UPDATE order_items SET cancelled=1, cancel_reason=? WHERE id=?', str(body.reason), it.id);
    } else if ('qty' in body) {
      const q = num(body.qty);
      if (q <= 0) fail(400, 'Quantity must be positive — void the item instead');
      run('UPDATE order_items SET qty=? WHERE id=?', q, it.id);
    }
    recalc(it.order_id);
  });
  broadcast('kot', 'tables', 'orders');
  return loadOrder(it.order_id);
});

api.post('/api/orders/:id/bill', SERVICE, ({ params }) => {
  const o = openOrder(params.id);
  if (!get('SELECT 1 FROM order_items WHERE order_id=? AND cancelled=0', o.id)) fail(400, 'No items on this order');
  run('UPDATE orders SET bill_printed=1 WHERE id=?', o.id);
  broadcast('tables');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/settle', FRONT, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const items = all('SELECT * FROM order_items WHERE order_id=? AND cancelled=0', o.id);
  if (!items.length) fail(400, 'Cannot settle an order without items');
  const s = getSettings();
  tx(() => {
    recalc(o.id);
    const fresh = get('SELECT * FROM orders WHERE id=?', o.id)!;
    let payments = (Array.isArray(body.payments) ? body.payments : [])
      .map((p) => ({ mode: String(p.mode || 'cash'), amount: r2(num(p.amount)) }))
      .filter((p) => p.amount > 0);
    if (!payments.length) payments = [{ mode: body.payment_mode || 'cash', amount: fresh.total }];
    const paid = r2(payments.reduce((a, p) => a + p.amount, 0));
    if (Math.abs(paid - fresh.total) > 0.5) fail(400, `Payments (${paid}) do not match bill total (${fresh.total})`);
    const mode = payments.length > 1 ? 'split' : payments[0].mode;
    run(
      "UPDATE orders SET status='completed', bill_printed=1, payment_mode=?, payments=?, settled_by=?, closed_at=datetime('now','localtime') WHERE id=?",
      mode, JSON.stringify(payments), user.id, o.id,
    );

    // Auto-deduct raw materials using each item's recipe
    for (const it of items) {
      for (const rec of all('SELECT * FROM recipes WHERE item_id=?', it.item_id)) {
        const q = rec.qty * it.qty;
        run('UPDATE inventory SET stock=stock-? WHERE id=?', q, rec.inventory_id);
        run(
          "INSERT INTO stock_moves (inventory_id, type, qty, order_id, note, user_id) VALUES (?, 'consumption', ?, ?, ?, ?)",
          rec.inventory_id, -q, o.id, fresh.order_no, user.id,
        );
      }
    }

    if (fresh.customer_id) {
      const points = Math.floor((fresh.total / 100) * num(s.loyalty_rate));
      run(
        "UPDATE customers SET total_spent=total_spent+?, visits=visits+1, points=points+?, last_visit=datetime('now','localtime') WHERE id=?",
        fresh.total, points, fresh.customer_id,
      );
    }
  });
  broadcast('tables', 'orders', 'kot');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/cancel', FRONT, ({ params, body }) => {
  const o = openOrder(params.id);
  const reason = str(body.reason) || fail(400, 'Please give a reason for cancelling');
  run("UPDATE orders SET status='cancelled', cancel_reason=?, closed_at=datetime('now','localtime') WHERE id=?", reason, o.id);
  broadcast('tables', 'orders', 'kot');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/move', SERVICE, ({ params, body }) => {
  const o = openOrder(params.id);
  if (o.type !== 'dine_in') fail(400, 'Only dine-in orders can be moved');
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', body.table_id), 'Table');
  if (get("SELECT 1 FROM orders WHERE table_id=? AND status='open' AND id!=?", body.table_id, o.id)) fail(400, 'That table is occupied');
  run('UPDATE orders SET table_id=? WHERE id=?', body.table_id, o.id);
  broadcast('tables', 'kot');
  return loadOrder(o.id);
});

// ---------------------------------------------------------------------------
// Kitchen (KOT / KDS)
// ---------------------------------------------------------------------------
api.get('/api/kots', ALL, () => {
  const kots = all(
    `SELECT k.*, o.order_no, o.type, o.notes AS order_notes, t.name AS table_name, u.name AS created_by_name
     FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=k.created_by
     WHERE o.status!='cancelled' AND k.status IN ('new','preparing','ready') AND k.created_at >= datetime('now','localtime','-1 day')
     ORDER BY k.id`,
  );
  if (!kots.length) return [];
  const items = all(`SELECT * FROM order_items WHERE kot_id IN (${kots.map(() => '?').join(',')}) ORDER BY id`, ...kots.map((k) => k.id));
  for (const k of kots) k.items = items.filter((i) => i.kot_id === k.id);
  return kots;
});
api.get('/api/kots/:id', ALL, ({ params }) => loadKot(params.id));
api.patch('/api/kots/:id', ALL, ({ params, body }) => {
  if (!['new', 'preparing', 'ready', 'served'].includes(body.status)) fail(400, 'Invalid status');
  requireRow(get('SELECT id FROM kots WHERE id=?', params.id), 'KOT');
  run("UPDATE kots SET status=?, updated_at=datetime('now','localtime') WHERE id=?", body.status, params.id);
  broadcast('kot', 'orders');
  return loadKot(params.id);
});

// ---------------------------------------------------------------------------
// Customers (CRM)
// ---------------------------------------------------------------------------
api.get('/api/customers', SERVICE, ({ query }) => {
  const s = `%${query.q || ''}%`;
  return all(
    'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY last_visit IS NULL, last_visit DESC, name LIMIT ?',
    s, s, s, Math.min(num(query.limit, 300), 2000),
  );
});
api.get('/api/customers/:id', SERVICE, ({ params }) => {
  const c = requireRow(get('SELECT * FROM customers WHERE id=?', params.id), 'Customer');
  c.orders = all(
    "SELECT id, order_no, type, total, status, created_at FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 50", params.id,
  );
  c.favourites = all(
    `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.customer_id=? AND o.status='completed' AND oi.cancelled=0 GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
    params.id,
  );
  return c;
});
function customerValues(b: Body): unknown[] {
  const name = str(b.name) || fail(400, 'Customer name is required');
  const phone = str(b.phone) || fail(400, 'Phone number is required');
  if (!/^[0-9+\-\s]{6,16}$/.test(phone)) fail(400, 'Enter a valid phone number');
  return [name, phone.replace(/\s/g, ''), str(b.email), str(b.address), str(b.birthday), str(b.notes)];
}
api.post('/api/customers', SERVICE, ({ body }) => {
  const id = run('INSERT INTO customers (name, phone, email, address, birthday, notes) VALUES (?,?,?,?,?,?)', ...customerValues(body)).id;
  return get('SELECT * FROM customers WHERE id=?', id);
});
api.put('/api/customers/:id', FRONT, ({ params, body }) => {
  run('UPDATE customers SET name=?, phone=?, email=?, address=?, birthday=?, notes=? WHERE id=?', ...customerValues(body), params.id);
  if ('points' in body) run('UPDATE customers SET points=? WHERE id=?', Math.max(0, num(body.points)), params.id);
  return get('SELECT * FROM customers WHERE id=?', params.id);
});
api.del('/api/customers/:id', MGR, ({ params }) => {
  run('DELETE FROM customers WHERE id=?', params.id);
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
api.get('/api/inventory', MGR, () =>
  all(
    `SELECT i.*, (SELECT COUNT(*) FROM recipes r WHERE r.inventory_id=i.id) AS used_in,
      (SELECT COALESCE(SUM(-m.qty),0) FROM stock_moves m WHERE m.inventory_id=i.id AND m.type='consumption'
        AND m.created_at >= datetime('now','localtime','-7 day')) AS used_7d
     FROM inventory i ORDER BY i.name`,
  ),
);
function invValues(b: Body): unknown[] {
  return [str(b.name) || fail(400, 'Name is required'), str(b.unit) || 'kg', num(b.min_stock), num(b.cost)];
}
api.post('/api/inventory', MGR, ({ body, user }) => {
  const id = tx(() => {
    const id = run('INSERT INTO inventory (name, unit, min_stock, cost, stock) VALUES (?,?,?,?,?)', ...invValues(body), num(body.stock)).id;
    if (num(body.stock) > 0) {
      run("INSERT INTO stock_moves (inventory_id, type, qty, cost, note, user_id) VALUES (?, 'adjust', ?, ?, 'Opening stock', ?)", id, num(body.stock), num(body.cost), user.id);
    }
    return id;
  });
  return get('SELECT * FROM inventory WHERE id=?', id);
});
api.put('/api/inventory/:id', MGR, ({ params, body }) => {
  run('UPDATE inventory SET name=?, unit=?, min_stock=?, cost=? WHERE id=?', ...invValues(body), params.id);
  return get('SELECT * FROM inventory WHERE id=?', params.id);
});
api.del('/api/inventory/:id', MGR, ({ params }) => {
  run('DELETE FROM inventory WHERE id=?', params.id);
});
api.post('/api/inventory/:id/move', MGR, ({ params, body, user }) => {
  const inv = requireRow(get('SELECT * FROM inventory WHERE id=?', params.id), 'Inventory item');
  const qty = num(body.qty, NaN);
  if (!(qty >= 0)) fail(400, 'Enter a valid quantity');
  let change: number;
  if (body.type === 'purchase') change = qty;
  else if (body.type === 'wastage') change = -qty;
  else if (body.type === 'adjust') change = qty - inv.stock;
  else return fail(400, 'Invalid movement type');
  if (body.type !== 'adjust' && qty === 0) fail(400, 'Quantity must be more than zero');
  const unitCost = num(body.cost) > 0 ? num(body.cost) : inv.cost;
  tx(() => {
    run('UPDATE inventory SET stock=stock+? WHERE id=?', change, inv.id);
    if (body.type === 'purchase' && num(body.cost) > 0) run('UPDATE inventory SET cost=? WHERE id=?', unitCost, inv.id);
    run(
      'INSERT INTO stock_moves (inventory_id, type, qty, cost, supplier, note, user_id) VALUES (?,?,?,?,?,?,?)',
      inv.id, body.type, change, unitCost, str(body.supplier), str(body.note), user.id,
    );
  });
  return get('SELECT * FROM inventory WHERE id=?', inv.id);
});
api.get('/api/stock-moves', MGR, ({ query }) => {
  const w = [];
  const p = [];
  if (query.inventory_id) w.push('m.inventory_id=?') && p.push(query.inventory_id);
  if (query.type) w.push('m.type=?') && p.push(query.type);
  if (query.from) w.push('date(m.created_at)>=?') && p.push(query.from);
  if (query.to) w.push('date(m.created_at)<=?') && p.push(query.to);
  return all(
    `SELECT m.*, i.name, i.unit, u.name AS user_name, o.order_no FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
     LEFT JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ${Math.min(num(query.limit, 300), 3000)}`,
    ...p,
  );
});

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------
api.get('/api/reservations', SERVICE, ({ query }) => {
  const from = query.from || todayStr();
  const to = query.to || '9999-12-31';
  return all(
    `SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id=r.table_id
     WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.time`,
    from, to,
  );
});
function resValues(b: Body): unknown[] {
  return [
    str(b.name) || fail(400, 'Guest name is required'), str(b.phone), Math.max(1, num(b.guests, 2)),
    str(b.date) || fail(400, 'Date is required'), str(b.time), b.table_id || null, str(b.notes),
  ];
}
api.post('/api/reservations', SERVICE, ({ body }) => {
  const id = run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', ...resValues(body)).id;
  return get('SELECT * FROM reservations WHERE id=?', id);
});
api.put('/api/reservations/:id', SERVICE, ({ params, body }) => {
  if (body.status && Object.keys(body).length === 1) {
    if (!['booked', 'seated', 'cancelled', 'no_show'].includes(body.status)) fail(400, 'Invalid status');
    run('UPDATE reservations SET status=? WHERE id=?', body.status, params.id);
  } else {
    run('UPDATE reservations SET name=?, phone=?, guests=?, date=?, time=?, table_id=?, notes=? WHERE id=?', ...resValues(body), params.id);
  }
});
api.del('/api/reservations/:id', SERVICE, ({ params }) => {
  run('DELETE FROM reservations WHERE id=?', params.id);
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
api.get('/api/expenses', MGR, ({ query }) =>
  all(
    `SELECT e.*, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
    query.from || '0000-01-01', query.to || '9999-12-31',
  ),
);
function expValues(b: Body): unknown[] {
  const amount = num(b.amount);
  if (!(amount > 0)) fail(400, 'Enter an amount greater than zero');
  return [str(b.date) || fail(400, 'Date is required'), str(b.category) || 'Other', amount, str(b.paid_to), str(b.note)];
}
api.post('/api/expenses', MGR, ({ body, user }) => {
  run('INSERT INTO expenses (date, category, amount, paid_to, note, user_id) VALUES (?,?,?,?,?,?)', ...expValues(body), user.id);
});
api.put('/api/expenses/:id', MGR, ({ params, body }) => {
  run('UPDATE expenses SET date=?, category=?, amount=?, paid_to=?, note=? WHERE id=?', ...expValues(body), params.id);
});
api.del('/api/expenses/:id', MGR, ({ params }) => {
  run('DELETE FROM expenses WHERE id=?', params.id);
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
api.get('/api/users', ADMIN, () =>
  all('SELECT id, name, username, role, phone, active, created_at FROM users ORDER BY active DESC, role, name'),
);
api.post('/api/users', ADMIN, ({ body }) => {
  const username = (str(body.username) || fail(400, 'Username is required')).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) fail(400, 'Username: 3–30 letters, numbers, dot, dash or underscore');
  if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
  if (String(body.password || '').length < 6) fail(400, 'Password must be at least 6 characters');
  run(
    'INSERT INTO users (name, username, password, role, phone) VALUES (?,?,?,?,?)',
    str(body.name) || fail(400, 'Name is required'), username, hashPassword(body.password), body.role, str(body.phone),
  );
});
api.put('/api/users/:id', ADMIN, ({ params, body, user }) => {
  const u = requireRow(get('SELECT * FROM users WHERE id=?', params.id), 'User');
  if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
  const active = body.active === false ? 0 : 1;
  if (u.id === user.id && (body.role !== 'admin' || !active)) fail(400, 'You cannot remove your own admin access');
  tx(() => {
    run('UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?', str(body.name) || u.name, body.role, str(body.phone), active, u.id);
    if (body.password) {
      if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters');
      run('UPDATE users SET password=? WHERE id=?', hashPassword(body.password), u.id);
    }
    if (!active || body.password) run('DELETE FROM sessions WHERE user_id=?', u.id);
  });
});

// ---------------------------------------------------------------------------
// Dashboard & reports
// ---------------------------------------------------------------------------
api.get('/api/dashboard', FRONT, () => {
  const dayStats = (offset: number) =>
    get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(guests),0) AS guests FROM orders
       WHERE status='completed' AND date(closed_at)=date('now','localtime',?)`,
      `${offset} day`,
    );
  const W = "status='completed' AND date(closed_at)=date('now','localtime')";
  return {
    today: dayStats(0),
    yesterday: dayStats(-1),
    running: get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS value FROM orders WHERE status='open'"),
    tables: get("SELECT COUNT(*) AS total, (SELECT COUNT(DISTINCT table_id) FROM orders WHERE status='open' AND table_id IS NOT NULL) AS occupied FROM dining_tables"),
    kots: get("SELECT COUNT(*) AS n FROM kots k JOIN orders o ON o.id=k.order_id WHERE k.status IN ('new','preparing') AND o.status!='cancelled'")!.n,
    last7: all(
      `SELECT date(closed_at) AS day, SUM(total) AS sales, COUNT(*) AS orders FROM orders
       WHERE status='completed' AND date(closed_at) >= date('now','localtime','-6 day') GROUP BY day ORDER BY day`,
    ),
    topItems: all(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty*oi.price) AS amount FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.${W.replace('date(closed_at)', 'date(o.closed_at)')} AND oi.cancelled=0 GROUP BY oi.name ORDER BY qty DESC LIMIT 6`,
    ),
    payments: paymentSplit(all(`SELECT payment_mode, payments, total FROM orders WHERE ${W}`)),
    byType: all(`SELECT type, COUNT(*) AS orders, SUM(total) AS sales FROM orders WHERE ${W} GROUP BY type`),
    lowStock: all('SELECT * FROM inventory WHERE stock <= min_stock ORDER BY (stock - min_stock) LIMIT 8'),
    reservations: all(
      `SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id=r.table_id
       WHERE r.date=date('now','localtime') AND r.status='booked' ORDER BY r.time`,
    ),
    recent: all(
      `SELECT o.id, o.order_no, o.type, o.status, o.total, o.created_at, t.name AS table_name FROM orders o
       LEFT JOIN dining_tables t ON t.id=o.table_id ORDER BY o.id DESC LIMIT 8`,
    ),
  };
});

api.get('/api/reports', MGR, ({ query }) => {
  const from = query.from || todayStr();
  const to = query.to || from;
  const W = "o.status='completed' AND date(o.closed_at) BETWEEN ? AND ?";
  const items = all(
    `SELECT oi.name, COALESCE(c.name,'Uncategorised') AS category, SUM(oi.qty) AS qty, SUM(oi.qty*oi.price) AS amount
     FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN items i ON i.id=oi.item_id LEFT JOIN categories c ON c.id=i.category_id
     WHERE ${W} AND oi.cancelled=0 GROUP BY oi.name, category ORDER BY amount DESC`,
    from, to,
  );
  const cats: Record<string, { category: string; qty: number; amount: number }> = {};
  for (const i of items) {
    cats[i.category] ??= { category: i.category, qty: 0, amount: 0 };
    cats[i.category].qty += i.qty;
    cats[i.category].amount += i.amount;
  }
  const cost = (type: string): number =>
    get(
      `SELECT COALESCE(SUM(-m.qty * i.cost),0) AS v FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
       WHERE m.type=? AND date(m.created_at) BETWEEN ? AND ?`,
      type, from, to,
    )!.v;
  return {
    from,
    to,
    summary: get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(tax),0) AS tax,
        COALESCE(SUM(service_charge),0) AS service_charge, COALESCE(SUM(packaging),0) AS packaging, COALESCE(SUM(round_off),0) AS round_off,
        COALESCE(SUM(total),0) AS total, COALESCE(SUM(guests),0) AS guests FROM orders o WHERE ${W}`,
      from, to,
    ),
    cancelled: get(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS value FROM orders o WHERE o.status='cancelled' AND date(o.created_at) BETWEEN ? AND ?",
      from, to,
    ),
    voids: get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(oi.qty*oi.price),0) AS value FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE oi.cancelled=1 AND date(o.created_at) BETWEEN ? AND ?`,
      from, to,
    ),
    daily: all(`SELECT date(o.closed_at) AS day, COUNT(*) AS orders, SUM(total) AS sales FROM orders o WHERE ${W} GROUP BY day ORDER BY day`, from, to),
    hourly: all(
      `SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS sales FROM orders o
       WHERE ${W} GROUP BY hour ORDER BY hour`,
      from, to,
    ),
    byType: all(`SELECT type, COUNT(*) AS orders, SUM(total) AS sales FROM orders o WHERE ${W} GROUP BY type ORDER BY sales DESC`, from, to),
    payments: paymentSplit(all(`SELECT payment_mode, payments, total FROM orders o WHERE ${W}`, from, to)),
    items,
    categories: Object.values(cats).sort((a, b) => b.amount - a.amount),
    staff: all(
      `SELECT COALESCE(u.name,'—') AS name, COUNT(*) AS orders, SUM(o.total) AS sales FROM orders o LEFT JOIN users u ON u.id=o.created_by
       WHERE ${W} GROUP BY o.created_by ORDER BY sales DESC`,
      from, to,
    ),
    topCustomers: all(
      `SELECT c.name, c.phone, COUNT(*) AS orders, SUM(o.total) AS spent FROM orders o JOIN customers c ON c.id=o.customer_id
       WHERE ${W} GROUP BY c.id ORDER BY spent DESC LIMIT 10`,
      from, to,
    ),
    expenses: all(
      'SELECT category, SUM(amount) AS amount, COUNT(*) AS n FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC',
      from, to,
    ),
    foodCost: r2(cost('consumption')),
    wastage: r2(cost('wastage')),
    purchases: r2(
      get(
        "SELECT COALESCE(SUM(qty*cost),0) AS v FROM stock_moves WHERE type='purchase' AND date(created_at) BETWEEN ? AND ?",
        from, to,
      )!.v,
    ),
  };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  console.log(`\n  DineFlow is running`);
  console.log(`  ➜ This computer:  http://localhost:${PORT}`);
  for (const u of lan) console.log(`  ➜ Other devices:  ${u}   (tablets / phones on the same Wi-Fi)`);
  console.log(`  Data folder: ${DATA_DIR}\n`);
});
