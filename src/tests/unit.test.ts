// Fast unit tests for pure logic shared by the till, the server and the reports. No server needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, taxBreakup, r2 } from '../shared/calc.js';
import { GST_RATES, ROLE_GROUPS, ROLES, FREQUENCY_PER_YEAR, FREQUENCIES } from '../shared/domain.js';

const line = (price: number, qty: number, tax_rate = 5, cancelled = 0) => ({ price, qty, tax_rate, cancelled });
const settings = { service_charge: '0', packaging_charge: '20', round_off: '1' };

describe('Bill maths (shared/calc)', () => {
  test('subtotal, 5% GST and rounding', () => {
    const t = computeTotals([line(260, 2), line(60, 3)], { type: 'dine_in' }, settings);
    assert.equal(t.subtotal, 700);
    assert.equal(t.tax, 35);
    assert.equal(t.total, 735);
    assert.equal(t.round_off, 0);
  });
  test('voided lines are ignored', () => {
    const t = computeTotals([line(100, 1), line(500, 1, 5, 1)], { type: 'dine_in' }, settings);
    assert.equal(t.subtotal, 100);
  });
  test('percent discount is applied before tax', () => {
    const t = computeTotals([line(1000, 1)], { type: 'dine_in', discount_type: 'percent', discount_value: 10 }, settings);
    assert.equal(t.discount, 100);
    assert.equal(t.tax, 45, 'tax on 900, not on 1000');
    assert.equal(t.total, 945);
  });
  test('flat discount never exceeds the subtotal', () => {
    const t = computeTotals([line(50, 1)], { type: 'takeaway', discount_type: 'flat', discount_value: 500 }, settings);
    assert.equal(t.discount, 50);
    assert.equal(t.tax, 0);
    assert.equal(t.total, 20, 'only the packaging charge is left');
  });
  test('packaging only for takeaway/delivery, service charge only for dine-in', () => {
    const s = { ...settings, service_charge: '10' };
    const dine = computeTotals([line(100, 1, 0)], { type: 'dine_in' }, s);
    const away = computeTotals([line(100, 1, 0)], { type: 'delivery' }, s);
    assert.deepEqual([dine.service_charge, dine.packaging], [10, 0]);
    assert.deepEqual([away.service_charge, away.packaging], [0, 20]);
  });
  test('round-off can be switched off', () => {
    const t = computeTotals([line(99.5, 1, 5)], { type: 'dine_in' }, { ...settings, round_off: '0' });
    assert.equal(t.total, r2(t.subtotal + t.tax), 'total is exactly subtotal + tax (tax rounded to paise first)');
    assert.equal(t.round_off, 0);
  });
  test('an empty bill has no packaging charge', () => {
    assert.equal(computeTotals([], { type: 'takeaway' }, settings).total, 0);
  });
  test('GST breakup splits each rate into equal CGST/SGST halves', () => {
    const items = [line(100, 1, 5), line(200, 1, 18)];
    const b = taxBreakup(items, { type: 'dine_in', discount: 0 });
    assert.deepEqual(b.map((x) => [x.rate, x.half]), [[5, 2.5], [18, 18]]);
    const total = computeTotals(items, { type: 'dine_in' }, settings);
    assert.equal(r2(b.reduce((a, x) => a + 2 * x.half, 0)), total.tax, 'halves add back up to the bill tax');
  });
});

describe('Shared domain lists', () => {
  test('role groups only contain known roles and widen in the right order', () => {
    for (const g of Object.values(ROLE_GROUPS)) for (const r of g) assert.ok(ROLES.includes(r));
    assert.ok(ROLE_GROUPS.ADMIN.every((r) => ROLE_GROUPS.MGR.includes(r)));
    assert.ok(ROLE_GROUPS.MGR.every((r) => ROLE_GROUPS.FRONT.includes(r)));
    assert.ok(ROLE_GROUPS.FRONT.every((r) => ROLE_GROUPS.SERVICE.includes(r)));
  });
  test('GST rates are the legal slabs, ascending', () => {
    assert.deepEqual(GST_RATES, [...GST_RATES].sort((a, b) => a - b));
    assert.ok(GST_RATES.includes(5) && GST_RATES.includes(18));
  });
  test('every repeat frequency has a yearly count', () => {
    for (const f of FREQUENCIES) assert.ok(FREQUENCY_PER_YEAR[f] > 0);
  });
});

describe('Validators (server/core/validate)', async () => {
  const v = await import('../server/core/validate.js');
  const throws400 = (fn: () => unknown, msg: RegExp) =>
    assert.throws(fn, (e: { status?: number; message: string }) => e.status === 400 && msg.test(e.message));

  test('calendar dates are real and time-zone proof', () => {
    assert.ok(v.isDayStr('2028-02-29'));
    assert.ok(!v.isDayStr('2026-02-29'));
    assert.ok(!v.isDayStr('2026-13-01'));
    assert.ok(!v.isDayStr('26-1-1'));
  });
  test('text trims, enforces length and required', () => {
    assert.equal(v.text('  Tea  ', 'Name'), 'Tea');
    assert.equal(v.text('   ', 'Name'), null);
    throws400(() => v.text('', 'Name', 10, true), /required/);
    throws400(() => v.text('x'.repeat(11), 'Name', 10), /too long/);
  });
  test('numbers must be finite and in range; blank uses the default', () => {
    assert.equal(v.numIn('', 'Qty', 1, 5, 2), 2);
    assert.equal(v.numIn('3', 'Qty', 1, 5), 3);
    throws400(() => v.numIn('abc', 'Qty', 1, 5), /number/);
    throws400(() => v.numIn(9, 'Qty', 1, 5), /between/);
  });
  test('phone numbers are normalised, junk refused', () => {
    assert.equal(v.phoneOpt('+91 98100-11111'), '+919810011111');
    throws400(() => v.phoneOpt('call me'), /valid phone/);
  });
  test('weak passwords are refused', () => {
    throws400(() => v.checkPassword('aaaaaaa'), /too easy/);
    throws400(() => v.checkPassword('admin123'), /too easy/);
    throws400(() => v.checkPassword('abc'), /characters/);
    assert.doesNotThrow(() => v.checkPassword('Kitchen-Door-7'));
  });
  test('times must be HH:MM in 24h', () => {
    assert.equal(v.timeOpt('19:30', 'Time'), '19:30');
    throws400(() => v.timeOpt('7pm', 'Time'), /time like/);
  });
});
