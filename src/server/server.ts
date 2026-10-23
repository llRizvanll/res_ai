import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  all, get, run, tx, exec, hashPassword, verifyPassword, getSettings, isHealthy, current, withTenant, listTenants, openTenant,
  tenantExists, registerTenant, archiveTenant, SLUG_RE, DATA_DIR, type Row, type Tenant,
} from './db.js';
import { snapshot, verifyBackup, listBackups, startSchedule, backupIfChanged, checkMirrorDir, mirrorDir, closingTime, kindOf, AUTO_INTERVAL_MIN } from './backup.js';
import { log } from './log.js';
import { materializeRecurring, pnl, pnlByMonth, insights, addDays as addDay, nextOccurrence as nextFrom, FREQUENCIES, type Frequency } from './finance.js';
import { seed, ensureSettings, FRESH_SETTINGS, BRANDING_KEYS } from './seed.js';
import { computeTotals, r2, type CalcLine, type CalcOrder } from '../shared/calc.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');

/** Brings every restaurant's database up to date at start-up */
function prepareTenant(t: Tenant) {
  withTenant(t, () => {
    if (!get('SELECT id FROM users LIMIT 1')) {
      console.log(`[${t.slug}] First run: creating database with demo data…`);
      seed({ content: process.env.SEED_DEMO === '0' ? 'sample' : 'demo' });
    }
    ensureSettings();
    if (t.recoveryNote) {
      run("INSERT INTO settings (key, value) VALUES ('recovery_note', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", t.recoveryNote);
    }
  });
}
for (const t of listTenants()) prepareTenant(t);
const STARTED_AT = new Date().toISOString();

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
  pattern: string;
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
  routes.push({ method, pattern, re, keys, roles, handler });
}
type Register = (pattern: string, roles: Role[] | null, handler: Handler) => void;
const api: Record<'get' | 'post' | 'put' | 'patch' | 'del', Register> = {
  get: (p, r, h) => route('GET', p, r, h),
  post: (p, r, h) => route('POST', p, r, h),
  put: (p, r, h) => route('PUT', p, r, h),
  patch: (p, r, h) => route('PATCH', p, r, h),
  del: (p, r, h) => route('DELETE', p, r, h),
};

/** Tokens look like "<restaurant>.<random>" so each request is routed to the right restaurant's data */
function tokenOf(req: IncomingMessage, url: URL): string | null {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
}
function tenantFor(req: IncomingMessage, url: URL, body: Body): Tenant {
  const token = tokenOf(req, url);
  const slug = (token && token.includes('.') ? token.split('.')[0] : null) || String(body.restaurant || url.searchParams.get('r') || 'main');
  if (slug !== 'main' && (!SLUG_RE.test(slug) || !tenantExists(slug))) fail(404, 'Restaurant not found');
  return openTenant(slug);
}
function authUser(req: IncomingMessage, url: URL): User | null {
  const token = tokenOf(req, url);
  if (!token) return null;
  return get<User>(
    'SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1',
    token,
  ) || null;
}

// Live-update listeners, kept per restaurant so branches never see each other's events
const clients = new Map<string, Set<ServerResponse>>();
const allClients = () => [...clients.values()].flatMap((s) => [...s]);
function broadcast(...events: string[]) {
  const set = clients.get(current().slug);
  if (!set) return;
  for (const ev of events) {
    const msg = `event: ${ev}\ndata: {}\n\n`;
    for (const c of set) c.write(msg);
  }
}
setInterval(() => {
  for (const c of allClients()) c.write(': ping\n\n');
}, 25000).unref();

function events(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!authUser(req, url)) fail(401, 'Please log in');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const slug = current().slug;
  if (!clients.has(slug)) clients.set(slug, new Set());
  clients.get(slug)!.add(res);
  req.on('close', () => clients.get(slug)?.delete(res));
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
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? await readBody(req) : {};
    const tenant = tenantFor(req, url, body);
    await withTenant(tenant, async () => {
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
      const c: Ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body, user: user as User };
      const spec = AUDITS.get(`${r.method} ${r.pattern}`);
      const before = spec?.before?.(c);
      const result = await r.handler(c);
      if (spec) {
        try {
          const entry = spec.after(c, result as Row, before as Row);
          if (entry) audit(c, entry[0], entry[1], entry[2]);
        } catch (e) {
          log.error('Activity log rule failed', e);
        }
      }
      if (!res.writableEnded) send(res, 200, result ?? { ok: true });
    });
  } catch (e) {
    const err = e as Partial<HttpError>;
    let status = err.status || 500;
    let message = err.message || String(e);
    const unique = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(message);
    if (unique) {
      status = 400;
      message = `This ${unique[2]} is already in use`;
    } else if (status === 500) {
      log.error(`${req.method} ${url.pathname} failed:`, e);
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
// ---- validators: every user-supplied value goes through one of these
/** Trimmed text with a length limit; null when empty, or an error when required */
function text(v: unknown, label: string, max = 100, required = false): string | null {
  const t = v === undefined || v === null ? '' : String(v).trim();
  if (!t) {
    if (required) fail(400, `${label} is required`);
    return null;
  }
  if (t.length > max) fail(400, `${label} is too long (max ${max} characters)`);
  return t;
}
/** A number within [min, max]; `def` is used when the value is blank */
function numIn(v: unknown, label: string, min: number, max: number, def?: number): number {
  if (v === '' || v === null || v === undefined) {
    if (def !== undefined) return def;
    fail(400, `${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(400, `${label} must be a number`);
  if (n < min || n > max) fail(400, `${label} must be between ${min} and ${max}`);
  return n;
}
/** Real calendar date in YYYY-MM-DD (rejects 2020-02-31). Checked in UTC so the server's time zone can't shift the day. */
function isDayStr(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo && dt.getUTCDate() === d;
}
function dateOpt(v: unknown, label: string): string | null {
  const t = text(v, label, 10);
  if (t && !isDayStr(t)) fail(400, `${label} must be a valid date (YYYY-MM-DD)`);
  return t;
}
function timeOpt(v: unknown, label: string): string | null {
  const t = text(v, label, 5);
  if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(400, `${label} must be a time like 19:30`);
  return t;
}
function checkPassword(v: unknown) {
  const pw = String(v ?? '');
  if (pw.length < 6 || pw.length > 100) fail(400, 'Password must be 6–100 characters');
  if (/^(.)\1+$/.test(pw) || ['123456', 'password', 'admin123', '111111', 'qwerty'].includes(pw.toLowerCase())) {
    fail(400, 'That password is too easy to guess — choose another');
  }
}
function emailOpt(v: unknown): string | null {
  const t = text(v, 'Email', 120);
  if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail(400, 'Enter a valid email address');
  return t;
}
function phoneOpt(v: unknown, label = 'Phone'): string | null {
  const t = text(v, label, 20);
  if (t && !/^\+?[0-9][0-9\s-]{5,18}$/.test(t)) fail(400, `Enter a valid ${label.toLowerCase()} number`);
  return t ? t.replace(/[\s-]/g, '') : null;
}
/** Optional reference to another row that must exist */
function refOpt(v: unknown, table: string, label: string): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const id = Number(v);
  if (!Number.isInteger(id) || !get(`SELECT 1 FROM ${table} WHERE id=?`, id)) fail(400, `${label} not found`);
  return id;
}
/** Case-insensitive uniqueness within a table (excluding the row being edited) */
function unique(table: string, col: string, value: string | null, label: string, exceptId?: unknown) {
  if (!value) return;
  if (get(`SELECT 1 FROM ${table} WHERE lower(${col})=lower(?) AND id != ?`, value, Number(exceptId) || 0)) fail(400, `${label} “${value}” already exists`);
}

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
// Activity log: who did what, per staff account. Kept across backup restores.
// ---------------------------------------------------------------------------
interface AuditOpts {
  as?: User | null; // when there is no signed-in user yet (sign-in attempts)
  entity?: string;
  id?: string | number | null;
  amount?: number | null;
  details?: unknown;
}
function audit(c: Pick<Ctx, 'req'> & { user?: User | null }, action: string, summary: string, o: AuditOpts = {}) {
  const u = o.as !== undefined ? o.as : c.user || null;
  try {
    run(
      'INSERT INTO activity_log (user_id, user_name, role, action, entity, entity_id, summary, amount, details, ip) VALUES (?,?,?,?,?,?,?,?,?,?)',
      u?.id ?? null, u?.name ?? null, u?.role ?? null, action, o.entity ?? action.split('.')[0], o.id == null ? null : String(o.id),
      summary.slice(0, 300), o.amount ?? null, o.details === undefined ? null : JSON.stringify(o.details).slice(0, 4000),
      String(c.req.socket.remoteAddress || '').replace('::ffff:', ''),
    );
  } catch (e) {
    log.error('Could not write activity log', e); // never block the actual work
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
// Brute-force protection: 5 wrong passwords for a username from one device locks it for 5 minutes
const failedLogins = new Map<string, { n: number; until: number }>();
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60_000;

api.post('/api/auth/login', null, (c) => {
  const { body, req } = c;
  const username = String(body.username || '').trim().toLowerCase();
  const key = `${current().slug}|${username}|${req.socket.remoteAddress}`;
  const lock = failedLogins.get(key);
  if (lock && lock.until > Date.now()) {
    fail(429, `Too many wrong attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minute(s).`);
  }
  const u = get('SELECT * FROM users WHERE username=? AND active=1', username);
  if (!u || !verifyPassword(String(body.password || ''), u.password)) {
    const n = (lock && lock.until > Date.now() ? lock.n : lock?.n || 0) + 1;
    failedLogins.set(key, { n, until: n >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
    audit(c, 'auth.login_failed', `Failed sign-in for “${username.slice(0, 40)}”`, { as: u ? (u as User) : null });
    if (n >= LOCK_AFTER) fail(429, 'Too many wrong attempts. Sign-in is locked for 5 minutes.');
    fail(401, 'Invalid username or password');
  }
  failedLogins.delete(key);
  const token = `${current().slug}.${crypto.randomBytes(24).toString('hex')}`;
  run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, u.id);
  audit(c, 'auth.login', `${u.name} signed in`, { as: u as User });
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
  checkPassword(body.password);
  if (String(body.password) === String(body.current)) fail(400, 'The new password must be different from the current one');
  run('UPDATE users SET password=? WHERE id=?', hashPassword(body.password), user.id);
});

// ---------------------------------------------------------------------------
// Settings & backup
// ---------------------------------------------------------------------------
const SETTING_KEYS = [
  'name', 'tagline', 'address', 'phone', 'email', 'gstin', 'fssai', 'currency', 'service_charge', 'packaging_charge',
  'round_off', 'invoice_prefix', 'invoice_footer', 'loyalty_rate', 'kot_auto_print', 'bill_auto_print',
  'logo', 'theme_color', 'theme_mode', 'backup_mirror_dir', 'closing_time',
];
const MAX_LOGO_CHARS = 700_000; // ~500 KB image once base64-encoded

const SETTING_LIMITS: Record<string, number> = {
  name: 60, tagline: 60, address: 300, phone: 30, email: 120, gstin: 15, fssai: 14, currency: 4, invoice_prefix: 10, invoice_footer: 200,
};
function validateSetting(k: string, v: string): string {
  v = v.trim();
  if (k === 'name' && !v) fail(400, 'Restaurant name cannot be empty');
  if (k in SETTING_LIMITS && v.length > SETTING_LIMITS[k]!) fail(400, `${k.replace('_', ' ')} is too long (max ${SETTING_LIMITS[k]} characters)`);
  if (k === 'currency' && !v) fail(400, 'Currency symbol is required');
  if (k === 'email' && v) emailOpt(v);
  if (k === 'gstin' && v && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.toUpperCase())) fail(400, 'GSTIN must be a valid 15-character GST number');
  if (k === 'fssai' && v && !/^\d{14}$/.test(v)) fail(400, 'FSSAI licence number must be 14 digits');
  if (k === 'invoice_prefix' && !/^[A-Za-z0-9-]{1,10}$/.test(v)) fail(400, 'Invoice prefix: 1–10 letters, numbers or dashes');
  if (k === 'service_charge') numIn(v, 'Service charge %', 0, 30);
  if (k === 'packaging_charge') numIn(v, 'Packaging charge', 0, 10_000);
  if (k === 'loyalty_rate') numIn(v, 'Loyalty points rate', 0, 100);
  if (['round_off', 'kot_auto_print', 'bill_auto_print'].includes(k) && !['0', '1'].includes(v)) fail(400, `${k.replace(/_/g, ' ')} must be on or off`);
  if (k === 'gstin') return v.toUpperCase();
  if (k === 'theme_color' && !/^#[0-9a-f]{6}$/i.test(v)) fail(400, 'Theme colour must be a hex value like #e8590c');
  if (k === 'theme_mode' && !['light', 'dark', 'system'].includes(v)) fail(400, 'Theme mode must be light, dark or system');
  if (k === 'closing_time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, 'Closing time must look like 23:30');
  if (k === 'backup_mirror_dir' && v.trim()) {
    const problem = checkMirrorDir(v.trim());
    if (problem) fail(400, problem);
    return v.trim();
  }
  if (k === 'logo' && v) {
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(400, 'Logo must be a PNG, JPG, WebP or SVG image');
    if (v.length > MAX_LOGO_CHARS) fail(400, 'Logo is too large — please use an image under 500 KB');
  }
  return v;
}
api.get('/api/settings', ALL, () => getSettings());

// Public so the sign-in screen can show the restaurant's own name, logo and colours
api.get('/api/branding', null, () => {
  const s = getSettings();
  return { name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color, theme_mode: s.theme_mode };
});
api.put('/api/settings', ADMIN, ({ body }) => {
  tx(() => {
    for (const k of SETTING_KEYS) {
      if (k in body) {
        const value = validateSetting(k, String(body[k] ?? ''));
        run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, value);
      }
    }
    if ('service_charge' in body || 'invoice_prefix' in body) run("UPDATE settings SET value='1' WHERE key='setup_billing'");
  });
  broadcast('settings');
  return getSettings();
});

api.get('/api/backup', ADMIN, (c) => {
  const { res } = c;
  run('INSERT INTO backup_downloads (name, user_id, user_name) VALUES (?,?,?)', `current-${todayStr()}`, c.user.id, c.user.name);
  const file = path.join(os.tmpdir(), `dineflow-backup-${Date.now()}.db`);
  exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
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
  const name = text(body.name, 'Area name', 40, true);
  unique('areas', 'name', name, 'Area');
  const id = run('INSERT INTO areas (name, sort) VALUES (?, ?)', name, numIn(body.sort, 'Order', 0, 9999, 0)).id;
  broadcast('tables');
  return get('SELECT * FROM areas WHERE id=?', id);
});
api.put('/api/areas/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM areas WHERE id=?', params.id), 'Area');
  const name = text(body.name, 'Area name', 40, true);
  unique('areas', 'name', name, 'Area', params.id);
  run('UPDATE areas SET name=?, sort=? WHERE id=?', name, numIn(body.sort, 'Order', 0, 9999, 0), params.id);
  broadcast('tables');
});
api.del('/api/areas/:id', MGR, ({ params }) => {
  if (get("SELECT 1 FROM orders o JOIN dining_tables t ON t.id=o.table_id WHERE t.area_id=? AND o.status='open'", params.id)) {
    fail(400, 'This area has tables with running orders');
  }
  safeguard();
  run('DELETE FROM areas WHERE id=?', params.id);
  broadcast('tables');
});

function tableValues(body: Body, exceptId?: unknown): unknown[] {
  const area = refOpt(body.area_id, 'areas', 'Area') ?? fail(400, 'Choose an area for the table');
  const name = text(body.name, 'Table name', 20, true);
  unique('dining_tables', 'name', name, 'Table', exceptId);
  return [area, name, Math.round(numIn(body.seats, 'Seats', 1, 100, 4)), numIn(body.sort, 'Order', 0, 9999, 0)];
}
api.post('/api/tables', MGR, ({ body }) => {
  const id = run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', ...tableValues(body)).id;
  broadcast('tables');
  return get('SELECT * FROM dining_tables WHERE id=?', id);
});
api.put('/api/tables/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', params.id), 'Table');
  run('UPDATE dining_tables SET area_id=?, name=?, seats=?, sort=? WHERE id=?', ...tableValues(body, params.id), params.id);
  broadcast('tables');
});
api.del('/api/tables/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM dining_tables WHERE id=?', params.id), 'Table');
  if (get("SELECT 1 FROM orders WHERE table_id=? AND status='open'", params.id)) fail(400, 'Table has a running order');
  safeguard();
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
  const name = text(body.name, 'Category name', 60, true);
  unique('categories', 'name', name, 'Category');
  const id = run('INSERT INTO categories (name, sort, active) VALUES (?,?,?)', name, numIn(body.sort, 'Order', 0, 9999, 0), body.active === false ? 0 : 1).id;
  broadcast('menu');
  return get('SELECT * FROM categories WHERE id=?', id);
});
api.put('/api/categories/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM categories WHERE id=?', params.id), 'Category');
  const name = text(body.name, 'Category name', 60, true);
  unique('categories', 'name', name, 'Category', params.id);
  run('UPDATE categories SET name=?, sort=?, active=? WHERE id=?', name, numIn(body.sort, 'Order', 0, 9999, 0), body.active === false ? 0 : 1, params.id);
  broadcast('menu');
});
api.del('/api/categories/:id', MGR, ({ params }) => {
  safeguard();
  run('DELETE FROM categories WHERE id=?', params.id);
  broadcast('menu');
});

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
function itemValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Item name', 100, true);
  unique('items', 'name', name, 'Menu item', exceptId);
  const code = text(b.code, 'Short code', 10);
  if (code && !/^[A-Za-z0-9-]+$/.test(code)) fail(400, 'Short code can only use letters, numbers and dashes');
  unique('items', 'code', code, 'Short code', exceptId);
  const tax = numIn(b.tax_rate, 'GST rate', 0, 28, 0);
  if (!GST_RATES.includes(tax)) fail(400, `GST rate must be one of ${GST_RATES.join(', ')}%`);
  const raw = Array.isArray(b.variants) ? b.variants : [];
  if (raw.length > 20) fail(400, 'An item can have at most 20 variants');
  const variants = raw
    .filter((v: Row) => str(v?.name))
    .map((v: Row) => ({ name: text(v.name, 'Variant name', 40, true)!, price: numIn(v.price, `Price of ${v.name}`, 0, 1_000_000) }));
  const names = variants.map((v: Row) => v.name.toLowerCase());
  if (new Set(names).size !== names.length) fail(400, 'Variant names must be different from each other');
  return [refOpt(b.category_id, 'categories', 'Category'), name, code ? code.toUpperCase() : null, text(b.description, 'Description', 300),
    numIn(b.price, 'Price', 0, 1_000_000), tax, b.veg ? 1 : 0, b.available === false ? 0 : 1, JSON.stringify(variants), numIn(b.sort, 'Order', 0, 9999, 0)];
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
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  run(
    'UPDATE items SET category_id=?, name=?, code=?, description=?, price=?, tax_rate=?, veg=?, available=?, variants=?, sort=? WHERE id=?',
    ...itemValues(body, params.id), params.id,
  );
  broadcast('menu');
  return parseItem(requireRow(get('SELECT * FROM items WHERE id=?', params.id), 'Item'));
});
api.patch('/api/items/:id/availability', ['admin', 'manager', 'kitchen'], ({ params, body }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  run('UPDATE items SET available=? WHERE id=?', body.available ? 1 : 0, params.id);
  broadcast('menu');
});
api.del('/api/items/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  safeguard();
  run('DELETE FROM items WHERE id=?', params.id);
  broadcast('menu');
});

api.get('/api/items/:id/recipe', MGR, ({ params }) =>
  all('SELECT r.inventory_id, r.qty, i.name, i.unit FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.item_id=? ORDER BY i.name', params.id),
);
api.put('/api/items/:id/recipe', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  const lines = (Array.isArray(body.lines) ? body.lines : []).filter((r: Row) => r?.inventory_id);
  if (lines.length > 50) fail(400, 'A recipe can have at most 50 ingredients');
  const seen = new Set<number>();
  const clean = lines.map((r: Row) => {
    const inv = refOpt(r.inventory_id, 'inventory', 'Ingredient')!;
    if (seen.has(inv)) fail(400, 'Each ingredient can be listed only once');
    seen.add(inv);
    return [inv, numIn(r.qty, 'Ingredient quantity', 0.0001, 10_000)];
  });
  tx(() => {
    run('DELETE FROM recipes WHERE item_id=?', params.id);
    for (const [inv, qty] of clean) run('INSERT INTO recipes (item_id, inventory_id, qty) VALUES (?,?,?)', params.id, inv, qty);
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
  if (query.from) w.push('date(o.created_at)>=?') && p.push(dateOpt(query.from, 'From date'));
  if (query.to) w.push('date(o.created_at)<=?') && p.push(dateOpt(query.to, 'To date'));
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
  refOpt(body.customer_id, 'customers', 'Customer');
  numIn(body.guests, 'Guests', 0, 200, 0);
  text(body.notes, 'Order note', 300);
  text(body.delivery_address, 'Delivery address', 300);
  if (type === 'dine_in') {
    if (!body.table_id) fail(400, 'Select a table for dine-in orders');
    refOpt(body.table_id, 'dining_tables', 'Table');
    const existing = get("SELECT id FROM orders WHERE table_id=? AND status='open'", body.table_id);
    if (existing) return loadOrder(existing.id);
  }
  const ref = str(body.client_ref);
  const dup = ref && get('SELECT id FROM orders WHERE client_ref=?', ref);
  if (dup) return loadOrder(dup.id); // same request retried after a dropped connection
  const disc = discountFields(body, user) || { type: 'flat', value: 0 };
  const s = getSettings();
  const id = tx(() => {
    const id = run(
      'INSERT INTO orders (type, table_id, customer_id, guests, notes, delivery_address, discount_type, discount_value, created_by, client_ref) VALUES (?,?,?,?,?,?,?,?,?,?)',
      type, type === 'dine_in' ? body.table_id : null, body.customer_id || null, num(body.guests), str(body.notes),
      type === 'delivery' ? str(body.delivery_address) : null, disc.type, disc.value, user.id, ref,
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
    if ('customer_id' in body) run('UPDATE orders SET customer_id=? WHERE id=?', refOpt(body.customer_id, 'customers', 'Customer'), o.id);
    if ('guests' in body) run('UPDATE orders SET guests=? WHERE id=?', Math.round(numIn(body.guests, 'Guests', 0, 200, 0)), o.id);
    if ('notes' in body) run('UPDATE orders SET notes=? WHERE id=?', text(body.notes, 'Order note', 300), o.id);
    if ('delivery_address' in body) run('UPDATE orders SET delivery_address=? WHERE id=?', text(body.delivery_address, 'Delivery address', 300), o.id);
    if (disc) run('UPDATE orders SET discount_type=?, discount_value=? WHERE id=?', disc.type, disc.value, o.id);
    recalc(o.id);
  });
  broadcast('tables', 'orders');
  return loadOrder(o.id);
});

api.post('/api/orders/:id/kot', SERVICE, ({ params, body, user }) => {
  const o = openOrder(params.id);
  const ref = str(body.client_ref);
  const dup = ref && get('SELECT id FROM kots WHERE client_ref=?', ref);
  if (dup) return { order: loadOrder(o.id), kot: loadKot(dup.id), duplicate: true };
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length > 100) fail(400, 'Too many lines in one KOT (max 100)');
  const lines: Row[] = raw.map((l: Row) => ({ ...l, qty: numIn(l?.qty, 'Quantity', 0.001, 999), notes: text(l?.notes, 'Item note', 200) }));
  if (!lines.length) fail(400, 'Add at least one item');
  const kotId = tx(() => {
    const kotNo = get("SELECT COALESCE(MAX(kot_no),0)+1 AS n FROM kots WHERE date(created_at)=date('now','localtime')")!.n;
    const kid = run('INSERT INTO kots (order_id, kot_no, created_by, client_ref) VALUES (?,?,?,?)', o.id, kotNo, user.id, ref).id;
    for (const l of lines) {
      const it = requireRow(get('SELECT * FROM items WHERE id=?', l.item_id), 'Menu item');
      if (!it.available) fail(400, `${it.name} is currently unavailable`);
      let price = it.price;
      let variant = null;
      if (!l.variant && JSON.parse(it.variants || '[]').length) fail(400, `Choose a portion/variant for ${it.name}`);
      if (l.variant) {
        const v = (JSON.parse(it.variants || '[]') as Row[]).find((v) => v.name === l.variant);
        if (!v) return fail(400, `Unknown variant ${l.variant} for ${it.name}`);
        price = v.price;
        variant = v.name;
      }
      run(
        'INSERT INTO order_items (order_id, kot_id, item_id, name, variant, price, qty, tax_rate, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        o.id, kid, it.id, it.name, variant, price, l.qty, it.tax_rate, l.notes,
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
  if (body.cancelled && it.cancelled) fail(400, 'This item is already voided');
  if (!body.cancelled && !('qty' in body)) fail(400, 'Nothing to change');
  const reason = text(body.reason, 'Reason', 200);
  const q = 'qty' in body && !body.cancelled ? numIn(body.qty, 'Quantity', 0.001, 999) : null;
  tx(() => {
    if (body.cancelled) run('UPDATE order_items SET cancelled=1, cancel_reason=? WHERE id=?', reason, it.id);
    else run('UPDATE order_items SET qty=? WHERE id=?', q, it.id);
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
    const MODES = ['cash', 'card', 'upi', 'other'];
    const raw = Array.isArray(body.payments) ? body.payments : [];
    if (raw.length > 10) fail(400, 'Too many payment parts');
    let payments = raw
      .map((p: Row) => {
        if (!MODES.includes(String(p?.mode))) fail(400, `Unknown payment mode “${p?.mode}”`);
        return { mode: String(p.mode), amount: r2(numIn(p.amount, 'Payment amount', 0, 10_000_000)) };
      })
      .filter((p: { amount: number }) => p.amount > 0);
    const single = String(body.payment_mode || 'cash');
    if (!MODES.includes(single)) fail(400, `Unknown payment mode “${single}”`);
    if (!payments.length) payments = [{ mode: single, amount: fresh.total }];
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
        // Cost at the time of sale, so later price changes don't rewrite past food-cost figures
        run(
          "INSERT INTO stock_moves (inventory_id, type, qty, cost, order_id, note, user_id) VALUES (?, 'consumption', ?, (SELECT cost FROM inventory WHERE id=?), ?, ?, ?)",
          rec.inventory_id, -q, rec.inventory_id, o.id, fresh.order_no, user.id,
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
  const reason = text(body.reason, 'Reason for cancelling', 200) || fail(400, 'Please give a reason for cancelling');
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
function customerValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Customer name', 80, true);
  const phone = phoneOpt(b.phone) || fail(400, 'Phone number is required');
  unique('customers', 'phone', phone, 'A customer with phone', exceptId);
  const birthday = dateOpt(b.birthday, 'Birthday');
  if (birthday && birthday > todayStr()) fail(400, 'Birthday cannot be in the future');
  return [name, phone, emailOpt(b.email), text(b.address, 'Address', 300), birthday, text(b.notes, 'Notes', 500)];
}
api.post('/api/customers', SERVICE, ({ body }) => {
  const id = run('INSERT INTO customers (name, phone, email, address, birthday, notes) VALUES (?,?,?,?,?,?)', ...customerValues(body)).id;
  return get('SELECT * FROM customers WHERE id=?', id);
});
api.put('/api/customers/:id', FRONT, ({ params, body }) => {
  requireRow(get('SELECT id FROM customers WHERE id=?', params.id), 'Customer');
  run('UPDATE customers SET name=?, phone=?, email=?, address=?, birthday=?, notes=? WHERE id=?', ...customerValues(body, params.id), params.id);
  if ('points' in body && body.points !== null) run('UPDATE customers SET points=? WHERE id=?', Math.round(numIn(body.points, 'Loyalty points', 0, 10_000_000)), params.id);
  return get('SELECT * FROM customers WHERE id=?', params.id);
});
api.del('/api/customers/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM customers WHERE id=?', params.id), 'Customer');
  safeguard();
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
const UNITS = ['kg', 'g', 'ltr', 'ml', 'pcs', 'pack', 'dozen', 'box', 'bottle', 'can', 'tray'];
function invValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Name', 80, true);
  unique('inventory', 'name', name, 'Raw material', exceptId);
  const unit = text(b.unit, 'Unit', 10) || 'kg';
  if (!UNITS.includes(unit)) fail(400, `Unit must be one of ${UNITS.join(', ')}`);
  return [name, unit, numIn(b.min_stock, 'Minimum level', 0, 1_000_000, 0), numIn(b.cost, 'Cost per unit', 0, 1_000_000, 0)];
}
api.post('/api/inventory', MGR, ({ body, user }) => {
  const id = tx(() => {
    const stock = numIn(body.stock, 'Opening stock', 0, 1_000_000, 0);
    const id = run('INSERT INTO inventory (name, unit, min_stock, cost, stock) VALUES (?,?,?,?,?)', ...invValues(body), stock).id;
    if (stock > 0) {
      run("INSERT INTO stock_moves (inventory_id, type, qty, cost, note, user_id) VALUES (?, 'adjust', ?, ?, 'Opening stock', ?)", id, stock, num(body.cost), user.id);
    }
    return id;
  });
  return get('SELECT * FROM inventory WHERE id=?', id);
});
api.put('/api/inventory/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM inventory WHERE id=?', params.id), 'Raw material');
  run('UPDATE inventory SET name=?, unit=?, min_stock=?, cost=? WHERE id=?', ...invValues(body, params.id), params.id);
  return get('SELECT * FROM inventory WHERE id=?', params.id);
});
api.del('/api/inventory/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM inventory WHERE id=?', params.id), 'Raw material');
  safeguard();
  run('DELETE FROM inventory WHERE id=?', params.id);
});
api.post('/api/inventory/:id/move', MGR, ({ params, body, user }) => {
  const inv = requireRow(get('SELECT * FROM inventory WHERE id=?', params.id), 'Inventory item');
  const qty = numIn(body.qty, 'Quantity', 0, 1_000_000);
  const cost = numIn(body.cost, 'Cost per unit', 0, 1_000_000, 0);
  const supplier = text(body.supplier, 'Supplier', 80);
  const note = text(body.note, 'Note', 200);
  if (body.type === 'wastage' && qty > inv.stock + 1e-9) fail(400, `Wastage (${qty}) is more than the stock in hand (${inv.stock} ${inv.unit})`);
  let change: number;
  if (body.type === 'purchase') change = qty;
  else if (body.type === 'wastage') change = -qty;
  else if (body.type === 'adjust') change = qty - inv.stock;
  else return fail(400, 'Invalid movement type');
  if (body.type !== 'adjust' && qty === 0) fail(400, 'Quantity must be more than zero');
  const unitCost = cost > 0 ? cost : inv.cost;
  tx(() => {
    run('UPDATE inventory SET stock=stock+? WHERE id=?', change, inv.id);
    if (body.type === 'purchase' && cost > 0) run('UPDATE inventory SET cost=? WHERE id=?', unitCost, inv.id);
    run(
      'INSERT INTO stock_moves (inventory_id, type, qty, cost, supplier, note, user_id) VALUES (?,?,?,?,?,?,?)',
      inv.id, body.type, change, unitCost, supplier, note, user.id,
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
function resValues(b: Body, isNew: boolean): unknown[] {
  const date = dateOpt(b.date, 'Date') || fail(400, 'Date is required');
  if (isNew && date < todayStr()) fail(400, 'Reservation date cannot be in the past');
  return [
    text(b.name, 'Guest name', 80, true), phoneOpt(b.phone), Math.round(numIn(b.guests, 'Number of guests', 1, 100, 2)),
    date, timeOpt(b.time, 'Time') || fail(400, 'Time is required'), refOpt(b.table_id, 'dining_tables', 'Table'), text(b.notes, 'Notes', 300),
  ];
}
api.post('/api/reservations', SERVICE, ({ body }) => {
  const id = run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', ...resValues(body, true)).id;
  return get('SELECT * FROM reservations WHERE id=?', id);
});
api.put('/api/reservations/:id', SERVICE, ({ params, body }) => {
  requireRow(get('SELECT id FROM reservations WHERE id=?', params.id), 'Reservation');
  if (body.status && Object.keys(body).length === 1) {
    if (!['booked', 'seated', 'cancelled', 'no_show'].includes(body.status)) fail(400, 'Invalid status');
    run('UPDATE reservations SET status=? WHERE id=?', body.status, params.id);
  } else {
    run('UPDATE reservations SET name=?, phone=?, guests=?, date=?, time=?, table_id=?, notes=? WHERE id=?', ...resValues(body, false), params.id);
  }
});
api.del('/api/reservations/:id', SERVICE, ({ params }) => {
  run('DELETE FROM reservations WHERE id=?', params.id);
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
/** Posts any recurring expenses that have fallen due (rent on the 1st, weekly gas, …) */
function syncRecurring() {
  try {
    const n = tx(() => materializeRecurring(todayStr()));
    if (n) log.info(`[${current().slug}] Added ${n} recurring expense(s)`);
  } catch (e) {
    log.error('Recurring expenses failed', e);
  }
}

api.get('/api/expenses', MGR, ({ query }) => (
  syncRecurring(),
  all(
    `SELECT e.*, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
    dateOpt(query.from, 'From date') || '0000-01-01', dateOpt(query.to, 'To date') || '9999-12-31',
  )
));

// ---- recurring expense templates
function recurringValues(b: Body): { category: string; amount: number; paid_to: string | null; note: string | null; frequency: Frequency; start_date: string; end_date: string | null } {
  const frequency = String(b.frequency) as Frequency;
  if (!FREQUENCIES.includes(frequency)) fail(400, `Repeat must be one of: ${FREQUENCIES.join(', ')}`);
  const start = dateOpt(b.start_date, 'Start date') || fail(400, 'Start date is required');
  if (start < addDay(todayStr(), -366)) fail(400, 'Start date can be at most one year in the past');
  const end = dateOpt(b.end_date, 'End date');
  if (end && end < start) fail(400, 'End date must be after the start date');
  return {
    category: text(b.category, 'Category', 40, true)!, amount: numIn(b.amount, 'Amount', 0.01, 100_000_000), paid_to: text(b.paid_to, 'Paid to', 80),
    note: text(b.note, 'Note', 300), frequency, start_date: start, end_date: end,
  };
}
api.get('/api/expenses/recurring', MGR, () => {
  syncRecurring();
  return all(
    `SELECT r.*, (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id=r.id) AS posted,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.recurring_id=r.id) AS posted_total
     FROM recurring_expenses r ORDER BY r.active DESC, r.next_date`,
  );
});
api.post('/api/expenses/recurring', MGR, ({ body, user }) => {
  const v = recurringValues(body);
  const id = run(
    'INSERT INTO recurring_expenses (category, amount, paid_to, note, frequency, start_date, end_date, next_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    v.category, v.amount, v.paid_to, v.note, v.frequency, v.start_date, v.end_date, v.start_date, user.id,
  ).id;
  syncRecurring();
  return get('SELECT * FROM recurring_expenses WHERE id=?', id);
});
api.put('/api/expenses/recurring/:id', MGR, ({ params, body }) => {
  const r = requireRow(get('SELECT * FROM recurring_expenses WHERE id=?', params.id), 'Recurring expense');
  if (Object.keys(body).length === 1 && 'active' in body) {
    run('UPDATE recurring_expenses SET active=? WHERE id=?', body.active ? 1 : 0, r.id);
  } else {
    const v = recurringValues(body);
    // Keep going from where it left off: never re-post a date that was already posted
    let next = v.start_date;
    const last = get<{ d: string | null }>('SELECT MAX(date) AS d FROM expenses WHERE recurring_id=?', r.id)!.d;
    if (last) {
      const anchor = Number(v.start_date.slice(8));
      for (let g = 0; next <= last && g < 5000; g++) next = nextFrom(v.frequency, next, anchor);
    }
    run(
      'UPDATE recurring_expenses SET category=?, amount=?, paid_to=?, note=?, frequency=?, start_date=?, end_date=?, next_date=?, active=1 WHERE id=?',
      v.category, v.amount, v.paid_to, v.note, v.frequency, v.start_date, v.end_date, next, r.id,
    );
  }
  syncRecurring();
  return get('SELECT * FROM recurring_expenses WHERE id=?', r.id);
});
api.del('/api/expenses/recurring/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM recurring_expenses WHERE id=?', params.id), 'Recurring expense');
  safeguard();
  // Expenses already posted are real history and stay; they just lose the link
  tx(() => {
    run('UPDATE expenses SET recurring_id=NULL WHERE recurring_id=?', params.id);
    run('DELETE FROM recurring_expenses WHERE id=?', params.id);
  });
});

// ---- profit & loss and growth insights
function rangeOf(query: Record<string, string>): [string, string] {
  const from = dateOpt(query.from, 'From date') || todayStr().slice(0, 8) + '01';
  const to = dateOpt(query.to, 'To date') || todayStr();
  if (to < from) fail(400, '“To” date must be on or after the “From” date');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366 * 3) fail(400, 'Choose a range of three years or less');
  return [from, to];
}
api.get('/api/pnl', MGR, ({ query }) => {
  syncRecurring();
  const [from, to] = rangeOf(query);
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);
  const prevTo = addDay(from, -1);
  const lastYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
  return {
    current: pnl(from, to),
    previous: pnl(addDay(prevTo, -len), prevTo),
    last_year: pnl(lastYear(from), lastYear(to)),
  };
});
api.get('/api/pnl/monthly', MGR, ({ query }) => {
  syncRecurring();
  const year = Math.round(numIn(query.year, 'Year', 2000, 2100, Number(todayStr().slice(0, 4))));
  return { year, months: pnlByMonth(year, todayStr()) };
});
api.get('/api/insights', MGR, () => {
  syncRecurring();
  return insights(todayStr());
});
function expValues(b: Body): unknown[] {
  const amount = numIn(b.amount, 'Amount', 0.01, 100_000_000);
  const date = dateOpt(b.date, 'Date') || fail(400, 'Date is required');
  const maxDay = get<{ d: string }>("SELECT date('now','localtime','+31 day') AS d")!.d;
  if (date > maxDay) fail(400, 'Expense date is too far in the future');
  return [date, text(b.category, 'Category', 40) || 'Other', amount, text(b.paid_to, 'Paid to', 80), text(b.note, 'Note', 300)];
}
api.post('/api/expenses', MGR, ({ body, user }) => {
  run('INSERT INTO expenses (date, category, amount, paid_to, note, user_id) VALUES (?,?,?,?,?,?)', ...expValues(body), user.id);
});
api.put('/api/expenses/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM expenses WHERE id=?', params.id), 'Expense');
  run('UPDATE expenses SET date=?, category=?, amount=?, paid_to=?, note=? WHERE id=?', ...expValues(body), params.id);
});
api.del('/api/expenses/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM expenses WHERE id=?', params.id), 'Expense');
  safeguard();
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
  checkPassword(body.password);
  unique('users', 'username', username, 'Username');
  run(
    'INSERT INTO users (name, username, password, role, phone) VALUES (?,?,?,?,?)',
    text(body.name, 'Name', 60, true), username, hashPassword(body.password), body.role, phoneOpt(body.phone),
  );
});
api.put('/api/users/:id', ADMIN, ({ params, body, user }) => {
  const u = requireRow(get('SELECT * FROM users WHERE id=?', params.id), 'User');
  if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
  const active = body.active === false ? 0 : 1;
  if (u.id === user.id && (body.role !== 'admin' || !active)) fail(400, 'You cannot remove your own admin access');
  tx(() => {
    run('UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?', text(body.name, 'Name', 60) || u.name, body.role, phoneOpt(body.phone), active, u.id);
    if (body.password) {
      checkPassword(body.password);
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
  const from = dateOpt(query.from, 'From date') || todayStr();
  const to = dateOpt(query.to, 'To date') || from;
  if (to < from) fail(400, '“To” date must be on or after the “From” date');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366) fail(400, 'Choose a range of one year or less');
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
// Owner tools: deletes, resets, backups & restore, setup checklist
// ---------------------------------------------------------------------------
const sqlPath = (p: string) => `'${p.replace(/'/g, "''")}'`;
const count = (sql: string, ...p: unknown[]): number => get<{ n: number }>(sql, ...p)!.n;

/** Restorable copy taken right before anything is deleted, so a wrong tap can always be undone */
function safeguard() {
  snapshot('before-delete');
}

function backupPath(name: string): string {
  if (!/^[\w.-]+\.db$/.test(name)) fail(400, 'Invalid backup name');
  const p = path.join(current().backupDir, name);
  if (!fs.existsSync(p)) fail(404, 'Backup not found');
  return p;
}
function requirePassword(user: User, password: unknown) {
  const u = get('SELECT password FROM users WHERE id=?', user.id)!;
  if (!verifyPassword(String(password || ''), u.password)) fail(403, 'Your password is incorrect');
}
const ALL_EVENTS = ['settings', 'menu', 'tables', 'orders', 'kot'];

// Tables copied back on restore, parents before children (FKs are off during restore anyway)
const DATA_TABLES = [
  'settings', 'users', 'areas', 'dining_tables', 'categories', 'items', 'customers', 'orders', 'kots', 'order_items',
  'inventory', 'recipes', 'stock_moves', 'reservations', 'expenses', 'recurring_expenses',
];

api.get('/api/admin/summary', ADMIN, () => ({
  demo: getSettings().demo_data === '1',
  orders: count('SELECT COUNT(*) AS n FROM orders'),
  open_orders: count("SELECT COUNT(*) AS n FROM orders WHERE status='open'"),
  activity: count('SELECT COUNT(*) AS n FROM activity_log'),
  customers: count('SELECT COUNT(*) AS n FROM customers'),
  reservations: count('SELECT COUNT(*) AS n FROM reservations'),
  expenses: count('SELECT COUNT(*) AS n FROM expenses'),
  stock_moves: count('SELECT COUNT(*) AS n FROM stock_moves'),
  inventory: count('SELECT COUNT(*) AS n FROM inventory'),
  items: count('SELECT COUNT(*) AS n FROM items'),
  categories: count('SELECT COUNT(*) AS n FROM categories'),
  areas: count('SELECT COUNT(*) AS n FROM areas'),
  tables: count('SELECT COUNT(*) AS n FROM dining_tables'),
  staff: count('SELECT COUNT(*) AS n FROM users'),
}));

api.get('/api/admin/setup', ADMIN, ({ user }) => {
  const s = getSettings();
  const pw = get('SELECT password FROM users WHERE id=?', user.id)!.password;
  return {
    demo: s.demo_data === '1',
    steps: {
      branding: !['My Restaurant', 'Spice Garden', ''].includes(s.name || '') || !!s.logo,
      business: !!(s.address && s.phone),
      billing: s.setup_billing === '1',
      floor: count('SELECT COUNT(*) AS n FROM dining_tables') > 0,
      menu: count('SELECT COUNT(*) AS n FROM items') > 0,
      inventory: count('SELECT COUNT(*) AS n FROM inventory') > 0,
      staff: count('SELECT COUNT(*) AS n FROM users WHERE active=1') > 1,
      password: !verifyPassword('admin123', pw),
    },
  };
});

const RESET_SCOPES = [
  'orders', 'customers', 'reservations', 'expenses', 'stock_history', 'stock_levels', 'inventory', 'menu', 'floor', 'staff',
  'settings', 'branding', 'activity',
] as const;
type Scope = (typeof RESET_SCOPES)[number];

api.post('/api/admin/reset', ADMIN, ({ body, user }) => {
  const scopes = new Set<Scope>(
    body.everything ? RESET_SCOPES : (Array.isArray(body.scopes) ? body.scopes : []).filter((x: string) => RESET_SCOPES.includes(x as Scope)),
  );
  if (!scopes.size) fail(400, 'Choose at least one thing to reset');
  if (String(body.confirm || '').trim().toUpperCase() !== 'RESET') fail(400, 'Type RESET to confirm');
  requirePassword(user, body.password);
  const open = count("SELECT COUNT(*) AS n FROM orders WHERE status='open'");
  if (open && !scopes.has('orders') && (scopes.has('menu') || scopes.has('floor'))) {
    fail(400, `There are ${open} running orders. Settle or cancel them first, or also clear "Orders & sales".`);
  }
  const backup = snapshot('before-reset');
  const has = (x: Scope) => scopes.has(x);
  tx(() => {
    if (has('orders')) {
      run('DELETE FROM orders'); // KOTs and order items cascade
      run("DELETE FROM stock_moves WHERE type='consumption'");
      run('UPDATE customers SET visits=0, total_spent=0, points=0, last_visit=NULL');
    }
    if (has('customers')) run('DELETE FROM customers');
    if (has('reservations')) run('DELETE FROM reservations');
    if (has('expenses')) {
      run('DELETE FROM expenses');
      run('DELETE FROM recurring_expenses');
    }
    if (has('stock_history')) run('DELETE FROM stock_moves');
    if (has('stock_levels')) run('UPDATE inventory SET stock=0');
    if (has('inventory')) run('DELETE FROM inventory'); // recipes & movements cascade
    if (has('menu')) {
      run('DELETE FROM items');
      run('DELETE FROM categories');
    }
    if (has('floor')) {
      run('DELETE FROM dining_tables');
      run('DELETE FROM areas');
    }
    if (has('staff')) run('DELETE FROM users WHERE id != ?', user.id);
    const put = (k: string) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, FRESH_SETTINGS[k]);
    if (has('settings')) for (const k of Object.keys(FRESH_SETTINGS)) if (!BRANDING_KEYS.includes(k)) put(k);
    if (has('branding')) for (const k of BRANDING_KEYS) put(k);
    if (has('activity')) {
      run('DELETE FROM activity_log');
      run('DELETE FROM backup_downloads');
    }
    if (body.everything) {
      put('demo_data');
      put('setup_billing');
    }
  });
  broadcast(...ALL_EVENTS);
  return { backup, settings: getSettings() };
});

api.get('/api/admin/backups', ADMIN, () => listBackups());

function healthWarnings(): string[] {
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
api.post('/api/admin/backups', ADMIN, ({ body }) => {
  const label = String(body.label || 'manual').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'manual';
  return { name: snapshot(label) };
});
function recordDownload(c: Ctx, name: string) {
  run('INSERT INTO backup_downloads (name, user_id, user_name) VALUES (?,?,?)', name, c.user.id, c.user.name);
  audit(c, 'backup.download', `Downloaded backup ${name}`);
}
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

api.del('/api/orders/:id', ADMIN, ({ params }) => {
  const o = requireRow(get('SELECT * FROM orders WHERE id=?', params.id), 'Order');
  safeguard();
  const s = getSettings();
  tx(() => {
    // Put back raw material consumed by this bill (generated demo history never touched stock)
    for (const m of all("SELECT * FROM stock_moves WHERE order_id=? AND type='consumption' AND COALESCE(note,'') != 'Demo history'", o.id)) {
      run('UPDATE inventory SET stock=stock-? WHERE id=?', m.qty, m.inventory_id);
    }
    run('DELETE FROM stock_moves WHERE order_id=?', o.id);
    if (o.status === 'completed' && o.customer_id) {
      const pts = Math.floor((o.total / 100) * num(s.loyalty_rate));
      run(
        'UPDATE customers SET total_spent=MAX(0, total_spent-?), visits=MAX(0, visits-1), points=MAX(0, points-?) WHERE id=?',
        o.total, pts, o.customer_id,
      );
    }
    run('DELETE FROM orders WHERE id=?', o.id);
  });
  broadcast('tables', 'orders', 'kot');
});

function bulkIds(body: Body): number[] {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) fail(400, 'Nothing selected');
  return ids;
}
api.post('/api/items/bulk-delete', MGR, ({ body }) => {
  const ids = bulkIds(body);
  safeguard();
  run(`DELETE FROM items WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  broadcast('menu');
  return { deleted: ids.length };
});
api.post('/api/customers/bulk-delete', MGR, ({ body }) => {
  const ids = bulkIds(body);
  safeguard();
  run(`DELETE FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return { deleted: ids.length };
});

api.del('/api/users/:id', ADMIN, ({ params, user }) => {
  const u = requireRow(get('SELECT * FROM users WHERE id=?', params.id), 'User');
  if (u.id === user.id) fail(400, 'You cannot delete your own account');
  if (u.role === 'admin' && count("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1") <= 1) fail(400, 'Keep at least one active admin');
  safeguard();
  run('DELETE FROM users WHERE id=?', u.id); // sessions cascade; past orders keep their totals
});



// ---------------------------------------------------------------------------
// Activity log & daily closing report
// ---------------------------------------------------------------------------

api.get('/api/activity', ADMIN, ({ query }) => {
  const from = dateOpt(query.from, 'From date') || todayStr();
  const to = dateOpt(query.to, 'To date') || from;
  const w = ['date(at) BETWEEN ? AND ?'];
  const p: unknown[] = [from, to];
  if (query.user_id) w.push('user_id=?') && p.push(Number(query.user_id));
  if (query.action) w.push('action LIKE ?') && p.push(`${String(query.action).replace(/[%_]/g, '')}%`);
  if (query.q) w.push('(summary LIKE ? OR user_name LIKE ?)') && p.push(`%${query.q}%`, `%${query.q}%`);
  return all(
    `SELECT id, at, user_id, user_name, role, action, entity, entity_id, summary, amount, ip FROM activity_log
     WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${Math.min(num(query.limit, 1000), 5000)}`,
    ...p,
  );
});

/** Per-account totals for one day: what each login did */
api.get('/api/activity/summary', ADMIN, ({ query }) => {
  const day = dateOpt(query.date, 'Date') || todayStr();
  return all(
    `SELECT COALESCE(user_name,'(unknown)') AS user_name, role, user_id,
      MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*) AS actions,
      SUM(action='auth.login') AS logins, SUM(action='auth.login_failed') AS failed_logins,
      SUM(action='order.kot') AS kots, SUM(action='order.settle') AS bills, COALESCE(SUM(CASE WHEN action='order.settle' THEN amount END),0) AS sales,
      SUM(action='order.void') AS voids, COALESCE(SUM(CASE WHEN action='order.void' THEN amount END),0) AS void_value,
      SUM(action='order.discount') AS discounts, SUM(action='order.cancel') AS cancels,
      SUM(action LIKE '%delete%') AS deletes
     FROM activity_log WHERE date(at)=? GROUP BY user_id, user_name ORDER BY sales DESC, actions DESC`,
    day,
  );
});

api.get('/api/admin/daily', ADMIN, ({ query }) => {
  const days = Math.min(Math.max(num(query.days, 30), 1), 366);
  const backups = listBackups();
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = get<{ d: string }>("SELECT date('now','localtime',?) AS d", `-${i} day`)!.d;
    const sales = get('SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales FROM orders WHERE status=\'completed\' AND date(closed_at)=?', day)!;
    const pick = (kind: string) => backups.find((b) => kindOf(b.name) === kind && b.name.startsWith(`${kind}-${day}`));
    const backup = pick('closing') || pick('daily') || null;
    const dl = backup ? get('SELECT at, user_name FROM backup_downloads WHERE name=? ORDER BY id DESC LIMIT 1', backup.name) : null;
    const accounts = all('SELECT DISTINCT user_name FROM activity_log WHERE date(at)=? AND user_name IS NOT NULL ORDER BY user_name', day).map((r) => r.user_name);
    out.push({ day, orders: sales.orders, sales: sales.sales, backup, downloaded: dl || null, accounts });
  }
  return { closing_time: closingTime(), days: out };
});

/** What the owner should do today about backups (shown on the dashboard after closing time) */
api.get('/api/admin/backup-reminder', ADMIN, () => {
  const today = todayStr();
  const closing = listBackups().find((b) => b.name.startsWith(`closing-${today}`)) || null;
  const downloaded = closing ? get('SELECT at, user_name FROM backup_downloads WHERE name=? ORDER BY id DESC LIMIT 1', closing.name) : null;
  const lastDl = get<{ at: string | null }>('SELECT MAX(at) AS at FROM backup_downloads')!.at;
  return { closing_time: closingTime(), closing, downloaded: downloaded || null, last_download: lastDl };
});

// ---------------------------------------------------------------------------
// Restaurants (branches): each has its own logins, data and backups
// ---------------------------------------------------------------------------
function restaurantInfo(t: Tenant) {
  return withTenant(t, () => {
    const s = getSettings();
    return { slug: t.slug, name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color };
  });
}
api.get('/api/restaurants', null, () => listTenants().map(restaurantInfo));

api.post('/api/restaurants', ADMIN, (c) => {
  const b = c.body;
  const name = text(b.name, 'Restaurant name', 60, true)!;
  const slug = (str(b.slug) || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!SLUG_RE.test(slug) || slug === 'main') fail(400, 'Restaurant code must be 2–31 letters, numbers or dashes');
  if (tenantExists(slug)) fail(400, `A restaurant with code “${slug}” already exists`);
  const admin = {
    name: text(b.admin_name, 'Owner name', 60, true)!,
    username: (text(b.username, 'Username', 30, true) || '').toLowerCase(),
    password: String(b.password || ''),
  };
  if (!/^[a-z0-9._-]{3,30}$/.test(admin.username)) fail(400, 'Username: 3–30 letters, numbers, dot, dash or underscore');
  if (admin.password.length < 6 || admin.password.length > 100) fail(400, 'Password must be 6–100 characters');
  const content = ['demo', 'sample', 'empty'].includes(b.content) ? b.content : 'empty';
  const t = registerTenant(slug);
  withTenant(t, () => {
    seed({ content, admin, name });
    ensureSettings();
    if (content !== 'demo') run("UPDATE settings SET value='0' WHERE key='demo_data'");
    snapshot('startup');
  });
  audit(c, 'restaurant.create', `Created restaurant “${name}” (code ${slug}, ${content}) with owner login “${admin.username}”`);
  return restaurantInfo(t);
});

api.post('/api/restaurants/current/archive', ADMIN, (c) => {
  const t = current();
  if (t.slug === 'main') fail(400, 'The main restaurant cannot be removed');
  const name = getSettings().name;
  if (String(c.body.confirm || '').trim() !== name) fail(400, `Type the restaurant name “${name}” exactly to confirm`);
  requirePassword(c.user, c.body.password);
  snapshot('before-archive');
  for (const res of clients.get(t.slug) || []) res.end();
  clients.delete(t.slug);
  const dest = archiveTenant(t.slug);
  log.info(`Restaurant ${t.slug} archived to ${dest} by ${c.user.name}`);
  return { archived_to: dest };
});

// ---------------------------------------------------------------------------
// What gets written to the activity log for each action
// ---------------------------------------------------------------------------
interface AuditSpec {
  /** Runs before the handler, e.g. to remember the name of something about to be deleted */
  before?: (c: Ctx) => unknown;
  after: (c: Ctx, result: Row, before: Row) => [string, string, AuditOpts?] | null;
}
const AUDITS = new Map<string, AuditSpec>();
const onAudit = (key: string, spec: AuditSpec) => AUDITS.set(key, spec);
const cur$ = (n: unknown) => `${getSettings().currency || '₹'}${r2(Number(n) || 0).toLocaleString('en-IN')}`;
const row = (table: string) => (c: Ctx) => get(`SELECT * FROM ${table} WHERE id=?`, c.params.id);
const orderOf = (c: Ctx) => get('SELECT * FROM orders WHERE id=?', c.params.id);

onAudit('POST /api/auth/logout', { after: (c) => ['auth.logout', `${c.user.name} signed out`] });
onAudit('POST /api/auth/password', { after: () => ['auth.password', 'Changed own password'] });
onAudit('PUT /api/settings', {
  after: (c) => {
    const keys = Object.keys(c.body).filter((k) => SETTING_KEYS.includes(k));
    return keys.length ? ['settings.update', `Changed settings: ${keys.join(', ')}`, { details: Object.fromEntries(keys.map((k) => [k, k === 'logo' ? '(image)' : c.body[k]])) }] : null;
  },
});
onAudit('GET /api/backup', { after: () => ['backup.download', 'Downloaded a copy of the current data'] });
// (named backup downloads are logged inside their handler, together with the download record)

onAudit('POST /api/areas', { after: (c, r) => ['floor.area_create', `Added area “${r.name}”`, { id: r.id }] });
onAudit('PUT /api/areas/:id', { before: row('areas'), after: (c, _r, b) => ['floor.area_update', `Renamed area “${b?.name}” to “${c.body.name}”`, { id: c.params.id }] });
onAudit('DELETE /api/areas/:id', { before: row('areas'), after: (c, _r, b) => ['floor.area_delete', `Deleted area “${b?.name}” and its tables`, { id: c.params.id }] });
onAudit('POST /api/tables', { after: (c, r) => ['floor.table_create', `Added table ${r.name} (${r.seats} seats)`, { id: r.id }] });
onAudit('PUT /api/tables/:id', { before: row('dining_tables'), after: (c, _r, b) => ['floor.table_update', `Edited table ${b?.name} → ${c.body.name}, ${c.body.seats} seats`, { id: c.params.id }] });
onAudit('DELETE /api/tables/:id', { before: row('dining_tables'), after: (c, _r, b) => ['floor.table_delete', `Deleted table ${b?.name}`, { id: c.params.id }] });

onAudit('POST /api/categories', { after: (c, r) => ['menu.category_create', `Added category “${r.name}”`, { id: r.id }] });
onAudit('PUT /api/categories/:id', { before: row('categories'), after: (c, _r, b) => ['menu.category_update', `Edited category “${b?.name}”${b?.name !== c.body.name ? ` → “${c.body.name}”` : ''}`, { id: c.params.id }] });
onAudit('DELETE /api/categories/:id', { before: row('categories'), after: (c, _r, b) => ['menu.category_delete', `Deleted category “${b?.name}”`, { id: c.params.id }] });
onAudit('POST /api/items', { after: (c, r) => ['menu.item_create', `Added “${r.name}” at ${cur$(r.price)}`, { id: r.id }] });
onAudit('PUT /api/items/:id', {
  before: row('items'),
  after: (c, r, b) => ['menu.item_update', `Edited “${r.name}”${b && b.price !== r.price ? ` — price ${cur$(b.price)} → ${cur$(r.price)}` : ''}`, { id: r.id }],
});
onAudit('PATCH /api/items/:id/availability', { before: row('items'), after: (c, _r, b) => ['menu.availability', `“${b?.name}” marked ${c.body.available ? 'available' : 'out of stock'}`, { id: c.params.id }] });
onAudit('DELETE /api/items/:id', { before: row('items'), after: (c, _r, b) => ['menu.item_delete', `Deleted “${b?.name}”`, { id: c.params.id }] });
onAudit('PUT /api/items/:id/recipe', { before: row('items'), after: (c, _r, b) => ['menu.recipe', `Updated recipe of “${b?.name}”`, { id: c.params.id }] });
onAudit('POST /api/items/bulk-delete', {
  before: (c) => all(`SELECT name FROM items WHERE id IN (${bulkIds(c.body).map(() => '?').join(',')})`, ...bulkIds(c.body)).map((x) => x.name),
  after: (c, r, b) => ['menu.item_delete', `Deleted ${r.deleted} items: ${(b as unknown as string[]).join(', ').slice(0, 200)}`],
});

onAudit('POST /api/orders', { after: (c, o) => ['order.create', `Opened ${o.order_no} · ${o.type.replace('_', '-')}${o.table_name ? ` · ${o.table_name}` : ''}`, { id: o.id }] });
onAudit('PUT /api/orders/:id', {
  after: (c, o) => {
    if ('discount_value' in c.body) {
      return ['order.discount', `Discount on ${o.order_no}: ${o.discount_type === 'percent' ? `${o.discount_value}%` : 'flat'} = ${cur$(o.discount)}`, { id: o.id, amount: o.discount }];
    }
    if ('customer_id' in c.body) return ['order.customer', `${o.order_no} customer: ${o.customer_name || 'removed'}`, { id: o.id }];
    return null;
  },
});
onAudit('POST /api/orders/:id/kot', {
  after: (c, r) =>
    r.duplicate
      ? null
      : ['order.kot', `KOT #${r.kot.kot_no} for ${r.order.order_no}: ${r.kot.items.map((i: Row) => `${i.qty}× ${i.name}`).join(', ').slice(0, 200)}`, { id: r.order.id }],
});
onAudit('PATCH /api/order-items/:id', {
  before: (c) => get('SELECT oi.*, o.order_no FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=?', c.params.id),
  after: (c, _r, b) =>
    c.body.cancelled
      ? ['order.void', `Voided ${b.qty}× ${b.name} on ${b.order_no}${c.body.reason ? ` — ${c.body.reason}` : ''}`, { id: b.order_id, amount: b.qty * b.price }]
      : ['order.qty', `Changed ${b.name} on ${b.order_no}: qty ${b.qty} → ${c.body.qty}`, { id: b.order_id }],
});
onAudit('POST /api/orders/:id/bill', { after: (c, o) => ['order.bill', `Printed bill ${o.order_no} for ${cur$(o.total)}`, { id: o.id, amount: o.total }] });
onAudit('POST /api/orders/:id/settle', {
  after: (c, o) => ['order.settle', `Settled ${o.order_no} for ${cur$(o.total)} — ${o.payments.map((p: Row) => `${p.mode} ${cur$(p.amount)}`).join(' + ')}`, { id: o.id, amount: o.total }],
});
onAudit('POST /api/orders/:id/cancel', { after: (c, o) => ['order.cancel', `Cancelled ${o.order_no} (${cur$(o.total)}) — ${o.cancel_reason}`, { id: o.id, amount: o.total }] });
onAudit('POST /api/orders/:id/move', { before: orderOf, after: (c, o) => ['order.move', `Moved ${o.order_no} to table ${o.table_name}`, { id: o.id }] });
onAudit('DELETE /api/orders/:id', {
  before: orderOf,
  after: (c, _r, b) => ['order.delete', `Permanently deleted ${b?.order_no} (${b?.status}, ${cur$(b?.total)})`, { id: c.params.id, amount: b?.total, details: b }],
});
onAudit('PATCH /api/kots/:id', { after: (c, k) => ['kot.status', `KOT #${k.kot_no} (${k.order_no}) → ${k.status}`, { id: k.id }] });

onAudit('POST /api/customers', { after: (c, r) => ['customer.create', `Added customer ${r.name} (${r.phone})`, { id: r.id }] });
onAudit('PUT /api/customers/:id', { after: (c, r) => ['customer.update', `Edited customer ${r.name}${'points' in c.body ? `, points set to ${r.points}` : ''}`, { id: r.id }] });
onAudit('DELETE /api/customers/:id', { before: row('customers'), after: (c, _r, b) => ['customer.delete', `Deleted customer ${b?.name} (${b?.phone})`, { id: c.params.id, details: b }] });
onAudit('POST /api/customers/bulk-delete', { after: (c, r) => ['customer.delete', `Deleted ${r.deleted} customers`, { details: c.body.ids }] });

onAudit('POST /api/inventory', { after: (c, r) => ['inventory.create', `Added raw material ${r.name} (${r.stock} ${r.unit})`, { id: r.id }] });
onAudit('PUT /api/inventory/:id', { after: (c, r) => ['inventory.update', `Edited raw material ${r.name}`, { id: r.id }] });
onAudit('DELETE /api/inventory/:id', { before: row('inventory'), after: (c, _r, b) => ['inventory.delete', `Deleted raw material ${b?.name} (had ${b?.stock} ${b?.unit})`, { id: c.params.id, details: b }] });
onAudit('POST /api/inventory/:id/move', {
  before: row('inventory'),
  after: (c, r, b) => {
    const t = String(c.body.type);
    const what = t === 'purchase' ? `Purchased ${c.body.qty} ${r.unit}` : t === 'wastage' ? `Wastage ${c.body.qty} ${r.unit}` : `Stock count ${b?.stock} → ${r.stock} ${r.unit}`;
    return [`inventory.${t}`, `${what} of ${r.name}${c.body.supplier ? ` from ${c.body.supplier}` : ''}`, { id: r.id, amount: t === 'purchase' ? num(c.body.qty) * r.cost : null }];
  },
});

onAudit('POST /api/reservations', { after: (c, r) => ['reservation.create', `Booked ${r.name} for ${r.guests} on ${r.date} ${r.time || ''}`, { id: r.id }] });
onAudit('PUT /api/reservations/:id', {
  before: row('reservations'),
  after: (c, _r, b) => ['reservation.update', c.body.status && Object.keys(c.body).length === 1 ? `Reservation ${b?.name} marked ${c.body.status}` : `Edited reservation of ${c.body.name}`, { id: c.params.id }],
});
onAudit('DELETE /api/reservations/:id', { before: row('reservations'), after: (c, _r, b) => ['reservation.delete', `Deleted reservation of ${b?.name} (${b?.date})`, { id: c.params.id }] });

onAudit('POST /api/expenses', { after: (c) => ['expense.create', `Added expense ${c.body.category} ${cur$(c.body.amount)}${c.body.paid_to ? ` to ${c.body.paid_to}` : ''}`, { amount: num(c.body.amount) }] });
onAudit('PUT /api/expenses/:id', { before: row('expenses'), after: (c, _r, b) => ['expense.update', `Edited expense ${b?.category}: ${cur$(b?.amount)} → ${cur$(c.body.amount)}`, { id: c.params.id, amount: num(c.body.amount) }] });
onAudit('DELETE /api/expenses/:id', { before: row('expenses'), after: (c, _r, b) => ['expense.delete', `Deleted expense ${b?.category} ${cur$(b?.amount)} (${b?.date})`, { id: c.params.id, amount: b?.amount, details: b }] });

onAudit('POST /api/expenses/recurring', { after: (c, r) => ['expense.recurring_create', `Set up ${r.frequency} expense ${r.category} ${cur$(r.amount)} from ${r.start_date}`, { id: r.id, amount: r.amount }] });
onAudit('PUT /api/expenses/recurring/:id', {
  after: (c, r) => ['expense.recurring_update', 'active' in c.body && Object.keys(c.body).length === 1 ? `${c.body.active ? 'Resumed' : 'Paused'} ${r.frequency} expense ${r.category}` : `Edited ${r.frequency} expense ${r.category} → ${cur$(r.amount)}`, { id: r.id }],
});
onAudit('DELETE /api/expenses/recurring/:id', { before: row('recurring_expenses'), after: (c, _r, b) => ['expense.recurring_delete', `Stopped ${b?.frequency} expense ${b?.category} ${cur$(b?.amount)}`, { id: c.params.id }] });
onAudit('POST /api/users', { after: (c) => ['staff.create', `Created ${c.body.role} login “${String(c.body.username).toLowerCase()}” for ${c.body.name}`] });
onAudit('PUT /api/users/:id', {
  before: row('users'),
  after: (c, _r, b) => {
    const changes = [];
    if (b?.role !== c.body.role) changes.push(`role ${b?.role} → ${c.body.role}`);
    if (!!b?.active !== (c.body.active !== false)) changes.push(c.body.active === false ? 'disabled' : 're-enabled');
    if (c.body.password) changes.push('password reset');
    return ['staff.update', `Edited login of ${b?.name}${changes.length ? `: ${changes.join(', ')}` : ''}`, { id: c.params.id }];
  },
});
onAudit('DELETE /api/users/:id', { before: row('users'), after: (c, _r, b) => ['staff.delete', `Deleted login “${b?.username}” (${b?.name}, ${b?.role})`, { id: c.params.id }] });

onAudit('POST /api/admin/reset', { after: (c) => ['data.reset', c.body.everything ? 'Erased everything (start fresh)' : `Cleared: ${(c.body.scopes || []).join(', ')}`] });
onAudit('POST /api/admin/backups', { after: (c, r) => ['backup.create', `Saved backup ${r.name}`] });
onAudit('DELETE /api/admin/backups/:name', { after: (c) => ['backup.delete', `Deleted backup ${c.params.name}`] });
onAudit('POST /api/admin/backups/:name/restore', { after: (c) => ['backup.restore', `Restored backup ${c.params.name}`] });

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(res, url.pathname);
});

let shuttingDown = false;
/** Final backup + WAL checkpoint so every committed bill is in the main database file before exit */
function shutdown(reason: string, code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Shutting down (${reason})…`);
  server.close();
  for (const c of allClients()) c.end();
  for (const t of listTenants()) {
    try {
      withTenant(t, () => backupIfChanged(code === 0 ? 'shutdown' : 'crash'));
      t.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      t.db.close();
    } catch (e) {
      log.error(`[${t.slug}] Error while closing the database`, e);
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('uncaughtException', (e) => {
  log.error('Unexpected crash:', e);
  shutdown('crash', 1);
});
process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection:', e));

server.on('error', (e: NodeJS.ErrnoException) => {
  log.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — is the POS already running?` : 'Server error:', e);
  shutdown('listen error', 1);
});

startSchedule();
// Post recurring expenses that fell due while the server was off, then keep checking hourly
listTenants().forEach((t) => withTenant(t, syncRecurring));
setInterval(() => listTenants().forEach((t) => withTenant(t, syncRecurring)), 3600_000).unref();

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  console.log(`\n  Restaurant POS server is running`);
  console.log(`  ➜ This computer:  http://localhost:${PORT}`);
  for (const u of lan) console.log(`  ➜ Other devices:  ${u}   (tablets / phones on the same Wi-Fi)`);
  console.log(`  Data folder: ${DATA_DIR}`);
  const ts = listTenants();
  console.log(`  Restaurants: ${ts.map((t) => withTenant(t, () => `${getSettings().name} [${t.slug}]`)).join(', ')}`);
  console.log(`  Backups:     every ${AUTO_INTERVAL_MIN} min when data changes + closing-time & daily copies, in each restaurant's backups/ folder\n`);
  log.info(`Server started on port ${PORT}`);
});
