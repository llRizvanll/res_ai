// End-to-end QA suite: boots a throwaway server on a temp data folder and exercises the API like real staff would.
// Run with `npm test`. Nothing here touches your real data folder.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeTotals } from '../shared/calc.js';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/api`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-qa-'));
let server: ChildProcess;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
async function call(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; data: J }> {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: J = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* binary download */
  }
  return { status: res.status, data };
}
const ok = async (method: string, p: string, body?: unknown, token?: string) => {
  const r = await call(method, p, body, token);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const rejects = async (method: string, p: string, body: unknown, token: string | undefined, status: number, msg?: RegExp) => {
  const r = await call(method, p, body, token);
  assert.equal(r.status, status, `${method} ${p} expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  if (msg) assert.match(String(r.data.error), msg);
};
async function login(username: string, password: string, restaurant?: string): Promise<string> {
  return (await ok('POST', '/auth/login', { username, password, restaurant })).token;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin = '';
let manager = '';
let cashier = '';
let waiter = '';
let kitchen = '';

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', path.join(import.meta.dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), CLOSING_CHECK_SEC: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/restaurants`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  [admin, manager, cashier, waiter, kitchen] = await Promise.all([
    login('admin', 'admin123'), login('manager', 'manager123'), login('cashier', 'cashier123'), login('waiter', 'waiter123'), login('kitchen', 'kitchen123'),
  ]);
});

after(() => {
  server.kill('SIGTERM');
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 1500).unref();
});

// ------------------------------------------------------------------------------------------------
describe('Sign-in & sessions', () => {
  test('tokens are tied to the restaurant', () => assert.match(admin, /^main\./));
  test('wrong password is rejected', () => rejects('POST', '/auth/login', { username: 'admin', password: 'nope' }, undefined, 401));
  test('protected routes need a session', () => rejects('GET', '/orders', undefined, undefined, 401));
  test('a forged token is rejected', () => rejects('GET', '/orders', undefined, 'main.deadbeef', 401));
  test('5 wrong passwords lock the account for a while', async () => {
    for (let i = 0; i < 4; i++) await rejects('POST', '/auth/login', { username: 'manager', password: 'x' }, undefined, 401);
    await rejects('POST', '/auth/login', { username: 'manager', password: 'x' }, undefined, 429, /locked/);
    await rejects('POST', '/auth/login', { username: 'manager', password: 'manager123' }, undefined, 429, /Too many/);
  });
  test('sign-out ends the session', async () => {
    const t = await login('cashier', 'cashier123');
    await ok('POST', '/auth/logout', {}, t);
    await rejects('GET', '/orders', undefined, t, 401);
  });
  test('weak or reused passwords are refused', async () => {
    await rejects('POST', '/auth/password', { current: 'waiter123', password: '123456' }, waiter, 400, /too easy/);
    await rejects('POST', '/auth/password', { current: 'waiter123', password: 'waiter123' }, waiter, 400, /different/);
    await rejects('POST', '/auth/password', { current: 'wrong', password: 'Strong-Pass-9' }, waiter, 400, /incorrect/);
  });
});

describe('Role permissions', () => {
  const cases: [string, string, string, () => string][] = [
    ['waiter cannot see reports', 'GET', '/reports', () => waiter],
    ['waiter cannot settle', 'POST', '/orders/1/settle', () => waiter],
    ['kitchen cannot open orders', 'POST', '/orders', () => kitchen],
    ['cashier cannot edit the menu', 'POST', '/items', () => cashier],
    ['manager cannot manage staff', 'GET', '/users', () => manager],
    ['manager cannot change settings', 'PUT', '/settings', () => manager],
    ['manager cannot reset data', 'POST', '/admin/reset', () => manager],
    ['cashier cannot read the activity log', 'GET', '/activity', () => cashier],
    ['cashier cannot create restaurants', 'POST', '/restaurants', () => cashier],
  ];
  for (const [name, m, p, tok] of cases) test(name, () => rejects(m, p, m === 'GET' ? undefined : {}, tok(), 403));
  test('waiter cannot give discounts', async () => {
    const o = await ok('POST', '/orders', { type: 'takeaway' }, waiter);
    await rejects('PUT', `/orders/${o.id}`, { discount_type: 'flat', discount_value: 50 }, waiter, 403);
  });
});

describe('Input validation', () => {
  const v: [string, string, string, unknown, RegExp][] = [
    ['empty item name', 'POST', '/items', { name: ' ', price: 10 }, /required/],
    ['negative price', 'POST', '/items', { name: 'QA Tea', price: -5 }, /between/],
    ['absurd price', 'POST', '/items', { name: 'QA Tea', price: 99999999 }, /between/],
    ['invalid GST rate', 'POST', '/items', { name: 'QA Tea', price: 10, tax_rate: 7 }, /GST rate/],
    ['duplicate item name', 'POST', '/items', { name: 'paneer tikka', price: 10 }, /already exists/],
    ['duplicate short code', 'POST', '/items', { name: 'QA Dup Code', price: 10, code: 'pt' }, /already exists/],
    ['duplicate variant names', 'POST', '/items', { name: 'QA V', price: 10, variants: [{ name: 'Half', price: 5 }, { name: 'half', price: 6 }] }, /different/],
    ['unknown category', 'POST', '/items', { name: 'QA C', price: 10, category_id: 99999 }, /not found/],
    ['name too long', 'POST', '/categories', { name: 'x'.repeat(61) }, /too long/],
    ['duplicate category', 'POST', '/categories', { name: 'starters' }, /already exists/],
    ['table without area', 'POST', '/tables', { name: 'QA1' }, /area/],
    ['duplicate table', 'POST', '/tables', { name: 't1', area_id: 1 }, /already exists/],
    ['zero seats', 'POST', '/tables', { name: 'QA9', area_id: 1, seats: 0 }, /between/],
    ['bad phone', 'POST', '/customers', { name: 'QA', phone: 'abc' }, /valid phone/],
    ['duplicate phone', 'POST', '/customers', { name: 'QA', phone: '9810011111' }, /already exists/],
    ['bad email', 'POST', '/customers', { name: 'QA', phone: '9000000001', email: 'nope' }, /email/],
    ['future birthday', 'POST', '/customers', { name: 'QA', phone: '9000000002', birthday: '2999-01-01' }, /future/],
    ['impossible date', 'POST', '/customers', { name: 'QA', phone: '9000000003', birthday: '2020-02-31' }, /valid date/],
    ['reservation in the past', 'POST', '/reservations', { name: 'QA', date: '2020-01-01', time: '19:00', guests: 2 }, /past/],
    ['bad reservation time', 'POST', '/reservations', { name: 'QA', date: '2999-01-01', time: '25:00', guests: 2 }, /time/],
    ['too many guests', 'POST', '/reservations', { name: 'QA', date: '2999-01-01', time: '19:00', guests: 500 }, /between/],
    ['zero expense', 'POST', '/expenses', { date: '2026-01-01', amount: 0 }, /between/],
    ['expense far in future', 'POST', '/expenses', { date: '2999-01-01', amount: 10 }, /future/],
    ['unknown stock unit', 'POST', '/inventory', { name: 'QA Salt', unit: 'bags' }, /Unit must/],
    ['duplicate raw material', 'POST', '/inventory', { name: 'paneer' }, /already exists/],
    ['bad movement type', 'POST', '/inventory/1/move', { type: 'steal', qty: 1 }, /Invalid/],
    ['wastage more than stock', 'POST', '/inventory/1/move', { type: 'wastage', qty: 999999 }, /more than the stock/],
    ['invalid GSTIN', 'PUT', '/settings', { gstin: 'ABC' }, /GSTIN/],
    ['bad closing time', 'PUT', '/settings', { closing_time: '9pm' }, /Closing time/],
    ['service charge over 30%', 'PUT', '/settings', { service_charge: '45' }, /between/],
    ['bad invoice prefix', 'PUT', '/settings', { invoice_prefix: 'IN V!' }, /prefix/],
    ['blank restaurant name', 'PUT', '/settings', { name: '' }, /cannot be empty/],
    ['logo that is not an image', 'PUT', '/settings', { logo: 'data:text/html;base64,PGI+' }, /Logo/],
    ['relative backup folder', 'PUT', '/settings', { backup_mirror_dir: 'backups' }, /full folder path/],
    ['weak staff password', 'POST', '/users', { name: 'QA', username: 'qa1', role: 'waiter', password: '111111' }, /too easy/],
    ['duplicate username', 'POST', '/users', { name: 'QA', username: 'Cashier', role: 'waiter', password: 'Good-pass-1' }, /already exists/],
    ['invalid role', 'POST', '/users', { name: 'QA', username: 'qa2', role: 'boss', password: 'Good-pass-1' }, /role/],
    ['report range backwards', 'GET', '/reports?from=2026-02-01&to=2026-01-01', undefined, /on or after/],
    ['report range garbage', 'GET', '/reports?from=yesterday', undefined, /valid date/],
  ];
  for (const [name, m, p, body, msg] of v) test(name, () => rejects(m, p, body, admin, 400, msg));
  test('editing something that does not exist gives 404', async () => {
    await rejects('PUT', '/items/999999', { name: 'x', price: 1 }, admin, 404);
    await rejects('PUT', '/customers/999999', { name: 'x', phone: '9000000009' }, admin, 404);
    await rejects('DELETE', '/expenses/999999', undefined, admin, 404);
  });
});

describe('Billing flow & money math', () => {
  test('a full takeaway bill: KOT, discount, split payment, stock, customer, activity', async () => {
    const settings = await ok('GET', '/settings', undefined, admin);
    const menu = await ok('GET', '/menu', undefined, admin);
    const tikka = menu.items.find((i: J) => i.name === 'Paneer Tikka');
    const naan = menu.items.find((i: J) => i.name === 'Butter Naan');
    const paneerBefore = (await ok('GET', '/inventory', undefined, admin)).find((i: J) => i.name === 'Paneer').stock;
    const cust = await ok('POST', '/customers', { name: 'QA Customer', phone: '9123456780' }, cashier);

    const o = await ok('POST', '/orders', { type: 'takeaway', customer_id: cust.id, client_ref: 'qa-order-1' }, cashier);
    await rejects('POST', `/orders/${o.id}/kot`, { items: [{ item_id: tikka.id, qty: 1 }] }, cashier, 400, /portion/);
    await rejects('POST', `/orders/${o.id}/kot`, { items: [{ item_id: naan.id, qty: 0 }] }, cashier, 400, /between/);
    const k = await ok('POST', `/orders/${o.id}/kot`, { items: [{ item_id: tikka.id, variant: 'Full', qty: 2 }, { item_id: naan.id, qty: 3 }], client_ref: 'qa-kot-1' }, cashier);
    assert.equal(k.order.items.length, 2);

    const d = await ok('PUT', `/orders/${o.id}`, { discount_type: 'percent', discount_value: 10 }, cashier);
    const expected = computeTotals(d.items, d, settings);
    assert.equal(d.total, expected.total, 'server total matches the shared calculator');
    assert.equal(d.subtotal, 2 * 260 + 3 * 60);
    await rejects('PUT', `/orders/${o.id}`, { discount_type: 'percent', discount_value: 150 }, cashier, 400, /100%/);

    await rejects('POST', `/orders/${o.id}/settle`, { payments: [{ mode: 'cash', amount: 1 }] }, cashier, 400, /do not match/);
    await rejects('POST', `/orders/${o.id}/settle`, { payments: [{ mode: 'bitcoin', amount: d.total }] }, cashier, 400, /Unknown payment/);
    const half = Math.floor(d.total / 2);
    const done = await ok('POST', `/orders/${o.id}/settle`, { payments: [{ mode: 'cash', amount: half }, { mode: 'upi', amount: d.total - half }] }, cashier);
    assert.equal(done.status, 'completed');
    assert.equal(done.payment_mode, 'split');
    await rejects('POST', `/orders/${o.id}/settle`, {}, cashier, 400, /already completed/);
    await rejects('POST', `/orders/${o.id}/kot`, { items: [{ item_id: naan.id, qty: 1 }] }, cashier, 400, /already completed/);

    const paneerAfter = (await ok('GET', '/inventory', undefined, admin)).find((i: J) => i.name === 'Paneer').stock;
    assert.ok(Math.abs(paneerBefore - paneerAfter - 0.4) < 1e-9, 'recipe (0.2 kg/plate × 2) deducted from stock');
    const c2 = await ok('GET', `/customers/${cust.id}`, undefined, admin);
    assert.equal(c2.visits, 1);
    assert.equal(c2.total_spent, done.total);

    const log = await ok('GET', '/activity?action=order', undefined, admin);
    const mine = log.filter((e: J) => String(e.summary).includes(done.order_no));
    for (const a of ['order.create', 'order.kot', 'order.discount', 'order.settle']) assert.ok(mine.some((e: J) => e.action === a), `activity has ${a}`);
    assert.equal(mine.find((e: J) => e.action === 'order.settle').user_name, 'Cashier Desk');
  });

  test('retrying the same order / KOT never duplicates', async () => {
    const a = await ok('POST', '/orders', { type: 'takeaway', client_ref: 'qa-retry' }, cashier);
    const b = await ok('POST', '/orders', { type: 'takeaway', client_ref: 'qa-retry' }, cashier);
    assert.equal(a.id, b.id);
    const body = { items: [{ item_id: 7, qty: 1 }], client_ref: 'qa-retry-kot' };
    await ok('POST', `/orders/${a.id}/kot`, body, cashier);
    const again = await ok('POST', `/orders/${a.id}/kot`, body, cashier);
    assert.equal(again.duplicate, true);
    assert.equal(again.order.items.length, 1);
  });

  test('voids recalculate the bill and cannot be repeated', async () => {
    const o = await ok('POST', '/orders', { type: 'takeaway' }, cashier);
    const r = await ok('POST', `/orders/${o.id}/kot`, { items: [{ item_id: 7, qty: 2 }, { item_id: 9, qty: 1 }] }, cashier);
    const line = r.order.items[0];
    const after = await ok('PATCH', `/order-items/${line.id}`, { cancelled: true, reason: 'QA' }, cashier);
    assert.ok(after.total < r.order.total);
    await rejects('PATCH', `/order-items/${line.id}`, { cancelled: true }, cashier, 400, /already voided/);
    await rejects('PATCH', `/order-items/${line.id}`, { cancelled: true }, waiter, 403);
  });

  test('a table can only hold one running order and moves need a free table', async () => {
    const t = await ok('GET', '/tables', undefined, waiter);
    const free = t.tables.filter((x: J) => !x.order_id);
    const a = await ok('POST', '/orders', { type: 'dine_in', table_id: free[0].id }, waiter);
    const again = await ok('POST', '/orders', { type: 'dine_in', table_id: free[0].id }, waiter);
    assert.equal(again.id, a.id, 'opening a busy table returns its running order');
    const busy = t.tables.find((x: J) => x.order_id);
    await rejects('POST', `/orders/${a.id}/move`, { table_id: busy.id }, waiter, 400, /occupied/);
    await rejects('POST', '/orders', { type: 'dine_in' }, waiter, 400, /table/);
  });

  test('cancelling needs a reason; deleting a bill puts stock back', async () => {
    const o = await ok('POST', '/orders', { type: 'takeaway' }, cashier);
    await rejects('POST', `/orders/${o.id}/cancel`, {}, cashier, 400, /reason/);
    const menu = await ok('GET', '/menu', undefined, admin);
    const naan = menu.items.find((i: J) => i.name === 'Butter Naan');
    const maida = async () => (await ok('GET', '/inventory', undefined, admin)).find((i: J) => i.name === 'Maida').stock;
    const before0 = await maida();
    await ok('POST', `/orders/${o.id}/kot`, { items: [{ item_id: naan.id, qty: 5 }] }, cashier);
    await ok('POST', `/orders/${o.id}/settle`, { payment_mode: 'card' }, cashier);
    assert.ok(Math.abs(before0 - (await maida()) - 0.5) < 1e-9);
    await rejects('DELETE', `/orders/${o.id}`, undefined, manager, 403);
    await ok('DELETE', `/orders/${o.id}`, undefined, admin);
    assert.ok(Math.abs((await maida()) - before0) < 1e-9, 'stock restored after deleting the bill');
  });

  test('reports add up: daily sales = total = payments', async () => {
    const day = (await ok('GET', '/admin/daily?days=1', undefined, admin)).days[0].day;
    const r = await ok('GET', `/reports?from=${day}&to=${day}`, undefined, admin);
    const daily = r.daily.reduce((a: number, d: J) => a + d.sales, 0);
    const pays = r.payments.reduce((a: number, p: J) => a + p.amount, 0);
    assert.ok(Math.abs(daily - r.summary.total) < 0.01, 'daily chart sums to the total');
    assert.ok(Math.abs(pays - r.summary.total) < 0.01, 'payment modes sum to the total');
    const net = r.summary.gross - r.summary.discount + r.summary.tax + r.summary.service_charge + r.summary.packaging + r.summary.round_off;
    assert.ok(Math.abs(net - r.summary.total) < 0.05, 'gross − discount + tax + charges + round-off = total');
  });
});

describe('Separate restaurants', () => {
  let branch = '';
  test('an admin can create a branch with its own owner login', async () => {
    await rejects('POST', '/restaurants', { name: 'B', admin_name: 'x', username: 'xyz', password: 'Good-pass-1' }, admin, 400, /code/);
    await rejects('POST', '/restaurants', { name: 'Bad User Co', admin_name: 'x', username: 'x', password: 'Good-pass-1' }, admin, 400, /Username/);
    await rejects('POST', '/restaurants', { name: 'Main', slug: 'main', admin_name: 'x', username: 'xyz', password: 'Good-pass-1' }, admin, 400, /code/);
    const r = await ok('POST', '/restaurants', { name: 'QA Branch', admin_name: 'Branch Boss', username: 'boss', password: 'Branch-pass-7', content: 'sample' }, admin);
    assert.equal(r.slug, 'qa-branch');
    await rejects('POST', '/restaurants', { name: 'QA Branch', admin_name: 'x', username: 'boss', password: 'Branch-pass-7' }, admin, 400, /already exists/);
    branch = await login('boss', 'Branch-pass-7', 'qa-branch');
    assert.match(branch, /^qa-branch\./);
  });
  test('data never leaks between restaurants', async () => {
    const mainOrders = await ok('GET', '/orders', undefined, admin);
    const branchOrders = await ok('GET', '/orders', undefined, branch);
    assert.ok(mainOrders.length > 0);
    assert.equal(branchOrders.length, 0);
    await rejects('GET', `/orders/${mainOrders[0].id}`, undefined, branch, 404);
    await ok('POST', '/customers', { name: 'Main Only', phone: '9555500001' }, admin);
    const bc = await ok('GET', '/customers?q=9555500001', undefined, branch);
    assert.equal(bc.length, 0, 'a main-restaurant customer is invisible to the branch');
    const bm = await ok('GET', '/menu', undefined, branch);
    assert.ok(bm.items.length > 0, 'sample content gave the branch a menu');
    await ok('POST', '/items', { name: 'Branch Special', price: 99 }, branch);
    const mm = await ok('GET', '/menu', undefined, admin);
    assert.ok(!mm.items.some((i: J) => i.name === 'Branch Special'), 'branch menu changes do not touch main');
  });
  test('logins are per restaurant', async () => {
    await rejects('POST', '/auth/login', { username: 'boss', password: 'Branch-pass-7' }, undefined, 401);
    await rejects('POST', '/auth/login', { username: 'admin', password: 'admin123', restaurant: 'qa-branch' }, undefined, 401);
    await rejects('POST', '/auth/login', { username: 'admin', password: 'admin123', restaurant: 'nope' }, undefined, 404);
  });
  test('each restaurant keeps its own activity log', async () => {
    const b = await ok('GET', '/activity', undefined, branch);
    assert.ok(b.every((e: J) => e.user_name !== 'Cashier Desk'));
    assert.ok(b.some((e: J) => e.action === 'auth.login' && e.user_name === 'Branch Boss'));
  });
  test('removing a branch archives it instead of deleting', async () => {
    await rejects('POST', '/restaurants/current/archive', { confirm: 'wrong', password: 'Branch-pass-7' }, branch, 400, /Type the restaurant name/);
    await rejects('POST', '/restaurants/current/archive', { confirm: 'QA Branch' }, admin, 400, /main restaurant/);
    const r = await ok('POST', '/restaurants/current/archive', { confirm: 'QA Branch', password: 'Branch-pass-7' }, branch);
    assert.ok(fs.existsSync(path.join(r.archived_to, 'restaurant.db')));
    const list = await ok('GET', '/restaurants');
    assert.ok(!list.some((x: J) => x.slug === 'qa-branch'));
  });
});

describe('Backups, closing time, downloads & restore', () => {
  test('a closing-time backup is taken and listed with that day’s sales', async () => {
    await ok('PUT', '/settings', { closing_time: '00:00' }, admin);
    let rem: J = null;
    for (let i = 0; i < 20 && !rem?.closing; i++) {
      await sleep(300);
      rem = await ok('GET', '/admin/backup-reminder', undefined, admin);
    }
    assert.ok(rem.closing, 'closing backup created');
    assert.equal(rem.downloaded, null);
    const daily = await ok('GET', '/admin/daily?days=1', undefined, admin);
    assert.equal(daily.days[0].backup.name, rem.closing.name);
    assert.ok(daily.days[0].accounts.includes('Cashier Desk'), 'accounts that worked today are listed');
  });
  test('downloading is tracked per account', async () => {
    const rem = await ok('GET', '/admin/backup-reminder', undefined, admin);
    const r = await call('GET', `/admin/backups/${encodeURIComponent(rem.closing.name)}`, undefined, admin);
    assert.equal(r.status, 200);
    const after = await ok('GET', '/admin/backup-reminder', undefined, admin);
    assert.equal(after.downloaded.user_name, 'Restaurant Owner');
    const log = await ok('GET', '/activity?action=backup', undefined, admin);
    assert.ok(log.some((e: J) => e.action === 'backup.download'));
  });
  test('backup names cannot escape the backup folder', () => rejects('GET', '/admin/backups/..%2F..%2Frestaurant.db', undefined, admin, 400));
  test('reset needs RESET and the password, and is reversible from the automatic backup', async () => {
    await rejects('POST', '/admin/reset', { scopes: ['expenses'], confirm: 'yes', password: 'admin123' }, admin, 400, /RESET/);
    await rejects('POST', '/admin/reset', { scopes: ['expenses'], confirm: 'RESET', password: 'bad' }, admin, 403);
    const before = (await ok('GET', '/admin/summary', undefined, admin)).expenses;
    assert.ok(before > 0);
    const r = await ok('POST', '/admin/reset', { scopes: ['expenses'], confirm: 'RESET', password: 'admin123' }, admin);
    assert.equal((await ok('GET', '/admin/summary', undefined, admin)).expenses, 0);
    await ok('POST', `/admin/backups/${encodeURIComponent(r.backup)}/restore`, { password: 'admin123' }, admin);
    assert.equal((await ok('GET', '/admin/summary', undefined, admin)).expenses, before, 'expenses back after restore');
    const log = await ok('GET', '/activity?action=data', undefined, admin);
    assert.ok(log.some((e: J) => e.action === 'data.reset'), 'the activity log survives a restore');
  });
  test('a damaged backup is refused', async () => {
    const dir = path.join(DATA, 'backups');
    fs.writeFileSync(path.join(dir, 'manual-broken.db'), 'not a database');
    await rejects('POST', '/admin/backups/manual-broken.db/restore', { password: 'admin123' }, admin, 400, /damaged/);
  });
  test('health check passes', async () => {
    const h = await ok('POST', '/admin/health/check', {}, admin);
    assert.equal(h.ok, true);
  });
});

describe('Expenses, P&L and growth projections', () => {
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('monthly dates clamp to the end of short months', async () => {
    const { addMonths, nextOccurrence } = await import('../server/services/finance/index.js');
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(nextOccurrence('monthly', '2026-02-28', 31), '2026-03-31', 'keeps the original day after a short month');
    assert.equal(nextOccurrence('quarterly', '2026-11-30', 30), '2027-02-28');
    assert.equal(nextOccurrence('yearly', '2028-02-29', 29), '2029-02-28');
  });

  test('a recurring expense posts every due date exactly once', async () => {
    const r = await ok('POST', '/expenses/recurring', { category: 'Utilities', amount: 777, frequency: 'weekly', start_date: daysAgo(14), paid_to: 'QA Gas' }, manager);
    const posted = async () => (await ok('GET', `/expenses?from=${daysAgo(30)}`, undefined, manager)).filter((e: J) => e.recurring_id === r.id);
    assert.equal((await posted()).length, 3, 'today, 7 and 14 days ago');
    await ok('GET', '/expenses/recurring', undefined, manager); // syncing again must not duplicate
    assert.equal((await posted()).length, 3);
    const list = await ok('GET', '/expenses/recurring', undefined, manager);
    assert.equal(list.find((x: J) => x.id === r.id).next_date, daysAgo(-7));

    await ok('PUT', `/expenses/recurring/${r.id}`, { category: 'Utilities', amount: 800, frequency: 'weekly', start_date: daysAgo(14), paid_to: 'QA Gas' }, manager);
    assert.equal((await posted()).length, 3, 'editing never re-posts old dates');
    await ok('PUT', `/expenses/recurring/${r.id}`, { active: false }, manager);
    assert.equal((await ok('GET', '/expenses/recurring', undefined, manager)).find((x: J) => x.id === r.id).active, 0);
    await ok('DELETE', `/expenses/recurring/${r.id}`, undefined, manager);
    const kept = (await ok('GET', `/expenses?from=${daysAgo(30)}`, undefined, manager)).filter((e: J) => e.paid_to === 'QA Gas');
    assert.equal(kept.length, 3, 'stopping a recurring expense keeps the entries already posted');
  });

  test('recurring expense validation', async () => {
    await rejects('POST', '/expenses/recurring', { category: 'Rent', amount: 10, frequency: 'hourly', start_date: daysAgo(0) }, manager, 400, /Repeat/);
    await rejects('POST', '/expenses/recurring', { category: 'Rent', amount: 10, frequency: 'monthly', start_date: daysAgo(400) }, manager, 400, /one year/);
    await rejects('POST', '/expenses/recurring', { category: 'Rent', amount: 10, frequency: 'monthly', start_date: daysAgo(0), end_date: daysAgo(5) }, manager, 400, /after the start/);
    await rejects('POST', '/expenses/recurring', { category: 'Rent', amount: -1, frequency: 'monthly', start_date: daysAgo(0) }, manager, 400, /between/);
    await rejects('GET', '/expenses/recurring', undefined, cashier, 403);
  });

  test('P&L lines add up and periods compare like with like', async () => {
    const d = await ok('GET', `/pnl?from=${daysAgo(29)}&to=${daysAgo(0)}`, undefined, admin);
    for (const p of [d.current, d.previous]) {
      assert.ok(Math.abs(p.net_sales - (p.gross_sales - p.discounts)) < 0.02, 'net = gross − discounts');
      assert.ok(Math.abs(p.total_revenue - (p.net_sales + p.other_income)) < 0.02, 'revenue = net + other income');
      assert.ok(Math.abs(p.gross_profit - (p.total_revenue - p.cogs)) < 0.02, 'gross profit = revenue − COGS');
      assert.ok(Math.abs(p.operating_profit - (p.gross_profit - p.total_expenses)) < 0.02, 'net profit = gross profit − expenses');
      const exp = p.expenses.reduce((a: number, e: J) => a + e.amount, 0);
      assert.ok(Math.abs(exp - p.total_expenses) < 0.02, 'expense categories sum to the total');
    }
    assert.equal(d.previous.days, d.current.days, 'previous period has the same length');
    assert.ok(d.current.total_revenue > 0 && d.current.cogs > 0);
    await rejects('GET', '/pnl?from=2026-05-01&to=2026-04-01', undefined, admin, 400, /on or after/);
    await rejects('GET', '/pnl', undefined, waiter, 403);
  });

  test('P&L by month: 12 months, future months empty', async () => {
    const y = Number(daysAgo(0).slice(0, 4));
    const r = await ok('GET', `/pnl/monthly?year=${y}`, undefined, admin);
    assert.equal(r.months.length, 12);
    const thisMonth = Number(daysAgo(0).slice(5, 7));
    assert.ok(r.months[thisMonth - 1], 'current month present');
    if (thisMonth < 12) assert.equal(r.months[thisMonth], null, 'next month is empty');
    await rejects('GET', '/pnl/monthly?year=1800', undefined, admin, 400, /between/);
  });

  test('growth insights: forecast, break-even and outlook are sane', async () => {
    const d = await ok('GET', '/insights', undefined, manager);
    assert.ok(d.forecast, 'demo history is long enough to forecast');
    assert.equal(d.forecast.points.length, 90);
    for (const p of d.forecast.points) assert.ok(p.value >= 0 && p.low <= p.value && p.value <= p.high, `forecast point ${p.day} is ordered and non-negative`);
    assert.equal(d.forecast.points[0].day, daysAgo(0));
    assert.ok(Math.abs(d.break_even.daily - d.break_even.monthly / 30.4) < 1);
    assert.ok(d.break_even.fixed_monthly >= d.break_even.recurring_monthly);
    assert.equal(d.outlook.length, 3);
    assert.equal(d.months.length, 12);
    assert.equal(d.weekdays.length, 7);
    assert.ok(Number(d.month_end.projected_sales) >= Number(d.month_end.mtd_sales), 'projection never below what is already sold');
    assert.ok(Array.isArray(d.advice) && d.advice.length > 0);
    await rejects('GET', '/insights', undefined, cashier, 403);
  });
});

describe('Demo restaurant (reference)', () => {
  let demo = '';
  test('an admin opens the demo and gets a demo-only session', async () => {
    await rejects('POST', '/demo/open', {}, manager, 403);
    const r = await ok('POST', '/demo/open', {}, admin);
    demo = r.token;
    assert.match(demo, /^demo\./);
    const me = await ok('GET', '/auth/me', undefined, demo);
    assert.equal(me.demo, true);
    assert.equal(me.settings.name, 'Demo Restaurant');
    assert.equal((await ok('GET', '/auth/me', undefined, admin)).demo, false, 'the real session is untouched');
  });
  test('the demo has full sample data and is separate from the real restaurant', async () => {
    const orders = await ok('GET', '/orders?limit=5000', undefined, demo);
    assert.ok(orders.length > 100, 'demo has 30 days of bills');
    await ok('POST', '/customers', { name: 'Demo Only', phone: '9777700001' }, demo);
    assert.equal((await ok('GET', '/customers?q=9777700001', undefined, admin)).length, 0, 'demo changes never reach the real restaurant');
  });
  test('the demo is not on the sign-in list and is never backed up', async () => {
    const list = await ok('GET', '/restaurants');
    assert.ok(!list.some((r: J) => r.slug === 'demo'));
    const h = await ok('GET', '/admin/health', undefined, demo);
    assert.deepEqual(h.warnings, [], 'no backup nagging inside the demo');
  });
  test('the demo cannot touch real restaurants, backups or the file system', async () => {
    await rejects('POST', '/restaurants', { name: 'From Demo', admin_name: 'x', username: 'fromdemo', password: 'Good-pass-1' }, demo, 403, /demo/);
    await rejects('PUT', '/settings', { backup_mirror_dir: '/tmp' }, demo, 403, /demo/);
    await rejects('GET', '/backup', undefined, demo, 403, /demo/);
    await rejects('POST', '/demo/open', {}, demo, 400, /already in the demo/);
    await rejects('POST', '/restaurants', { name: 'Demo', slug: 'demo', admin_name: 'x', username: 'xyz', password: 'Good-pass-1' }, admin, 400, /code/);
  });
  test('reset gives fresh sample data and a new session', async () => {
    await rejects('POST', '/demo/reset', {}, admin, 400, /Only the demo/);
    const r = await ok('POST', '/demo/reset', {}, demo);
    assert.match(r.token, /^demo\./);
    await rejects('GET', '/orders', undefined, demo, 401);
    assert.equal((await ok('GET', '/customers?q=9777700001', undefined, r.token)).length, 0, 'demo edits are gone after reset');
  });
});
