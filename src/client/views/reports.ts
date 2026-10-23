import type { AppCtx } from '../core/types/app.js';
import { $, esc } from '../core/dom.js';
import { addDays, today } from '../core/dates.js';
import { api } from '../core/api.js';
import { fmtDate, label, money, money0, ORDER_TYPE_LABELS, PAYMENT_MODE_LABELS, qtyFmt } from '../core/format.js';
import { downloadCSV } from '../core/csv.js';
import { UI_CONFIG } from '../config.js';
import { barChart, emptyState, hbars } from '../ui/index.js';

interface Report {
  from: string;
  to: string;
  summary: { orders: number; gross: number; discount: number; tax: number; service_charge: number; packaging: number; round_off: number; total: number; guests: number };
  cancelled: { n: number; value: number };
  voids: { n: number; value: number };
  daily: { day: string; orders: number; sales: number }[];
  hourly: { hour: number; orders: number; sales: number }[];
  byType: { type: string; orders: number; sales: number }[];
  payments: { mode: string; amount: number }[];
  items: { name: string; category: string; qty: number; amount: number }[];
  categories: { category: string; qty: number; amount: number }[];
  staff: { name: string; orders: number; sales: number }[];
  topCustomers: { name: string; phone: string; orders: number; spent: number }[];
  expenses: { category: string; amount: number; n: number }[];
  foodCost: number;
  wastage: number;
  purchases: number;
}

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let data: Report;
const f = { from: addDays(today(), -6), to: today() };

const PRESETS: [string, () => [string, string]][] = [
  ['Today', () => [today(), today()]],
  ['Yesterday', () => [addDays(today(), -1), addDays(today(), -1)]],
  ['Last 7 days', () => [addDays(today(), -6), today()]],
  ['Last 30 days', () => [addDays(today(), -29), today()]],
  ['This month', () => [today().slice(0, 8) + '01', today()]],
];

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = `
    <div class="page report">
      <div class="toolbar wrap no-print">
        <div class="seg" id="presets">${PRESETS.map(([l], i) => `<button data-p="${i}">${l}</button>`).join('')}</div>
        <label>From <input type="date" id="r-from" value="${f.from}"></label>
        <label>To <input type="date" id="r-to" value="${f.to}"></label>
        <span class="grow"></span>
        <button class="btn ghost" id="r-csv">⇩ Item sales CSV</button>
        <button class="btn ghost" id="r-print">⎙ Print</button>
      </div>
      <div id="r-body"></div>
    </div>`;
  root = $('.report', el);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
    if (!b) return;
    [f.from, f.to] = PRESETS[Number(b.dataset.p)]![1]();
    $<HTMLInputElement>('#r-from', root!).value = f.from;
    $<HTMLInputElement>('#r-to', root!).value = f.to;
    load();
  });
  $('#r-from', root).addEventListener('change', (e) => {
    f.from = (e.target as HTMLInputElement).value;
    load();
  });
  $('#r-to', root).addEventListener('change', (e) => {
    f.to = (e.target as HTMLInputElement).value;
    load();
  });
  $('#r-print', root).addEventListener('click', () => window.print());
  $('#r-csv', root).addEventListener('click', () =>
    downloadCSV(`item-sales-${f.from}-to-${f.to}.csv`, [['Item', 'Category', 'Qty sold', 'Amount'], ...data.items.map((i) => [i.name, i.category, i.qty, i.amount])]),
  );
  await load();
}

async function load() {
  data = await api.get<Report>(`/reports?from=${f.from}&to=${f.to}`);
  const d = data;
  const s = d.summary;
  const net = s.gross - s.discount;
  const expenses = d.expenses.reduce((a, e) => a + e.amount, 0);
  const profit = net - d.foodCost - d.wastage - expenses;

  // Fill gaps so the chart shows every day in the range
  const days: string[] = [];
  for (let x = f.from; x <= f.to && days.length < 92; x = addDays(x, 1)) days.push(x);
  const daily = days.map((day) => {
    const r = d.daily.find((x) => x.day === day);
    return { label: days.length > 10 ? day.slice(8) : new Date(day + 'T00:00:00').toLocaleDateString(UI_CONFIG.locale, { day: '2-digit', month: 'short' }), value: r?.sales || 0, tip: `${fmtDate(day)}: ${money0(r?.sales || 0)} · ${r?.orders || 0} orders` };
  });
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 8 || d.hourly.some((x) => x.hour === h));
  const hourly = hours.map((h) => {
    const r = d.hourly.find((x) => x.hour === h);
    return { label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`, value: r?.sales || 0, tip: `${h}:00 – ${r?.orders || 0} orders, ${money0(r?.sales || 0)}` };
  });

  $('#r-body', root!).innerHTML = `
    <h2 class="print-only">Sales report: ${fmtDate(f.from)} – ${fmtDate(f.to)}</h2>
    <div class="kpis">
      <div class="kpi accent"><small>Total collection</small><b>${money0(s.total)}</b><span>${s.orders} bills</span></div>
      <div class="kpi"><small>Net sales (excl. tax)</small><b>${money0(net)}</b><span>Gross ${money0(s.gross)} − disc ${money0(s.discount)}</span></div>
      <div class="kpi"><small>Avg bill value</small><b>${money0(s.orders ? s.total / s.orders : 0)}</b><span>${s.guests} dine-in covers</span></div>
      <div class="kpi"><small>GST collected</small><b>${money0(s.tax)}</b><span>CGST ${money0(s.tax / 2)} · SGST ${money0(s.tax / 2)}</span></div>
      <div class="kpi ${profit < 0 ? 'danger' : 'ok'}"><small>Est. operating profit</small><b>${money0(profit)}</b><span>after food cost &amp; expenses</span></div>
    </div>

    <div class="grid-2 wide-left">
      <div class="card"><div class="card-head"><h3>Daily sales</h3></div>${barChart(daily, { height: 220 })}</div>
      <div class="card"><div class="card-head"><h3>Profit &amp; loss (estimate)</h3></div>
        <table class="table compact pl">
          <tr><td>Gross sales</td><td class="num">${money(s.gross)}</td></tr>
          <tr><td>− Discounts</td><td class="num">${money(s.discount)}</td></tr>
          <tr class="b"><td>Net sales</td><td class="num">${money(net)}</td></tr>
          <tr><td>− Food cost (recipe usage)</td><td class="num">${money(d.foodCost)}</td></tr>
          <tr><td>− Wastage</td><td class="num">${money(d.wastage)}</td></tr>
          <tr class="b"><td>Gross margin</td><td class="num">${money(net - d.foodCost - d.wastage)} <small class="muted">(${net ? (((net - d.foodCost - d.wastage) / net) * 100).toFixed(0) : 0}%)</small></td></tr>
          <tr><td>− Operating expenses</td><td class="num">${money(expenses)}</td></tr>
          <tr class="b grand"><td>Operating profit</td><td class="num">${money(profit)}</td></tr>
          <tr class="muted"><td>Tax collected (payable)</td><td class="num">${money(s.tax)}</td></tr>
          <tr class="muted"><td>Service / packaging charges</td><td class="num">${money(s.service_charge + s.packaging)}</td></tr>
          <tr class="muted"><td>Stock purchased</td><td class="num">${money(d.purchases)}</td></tr>
        </table>
      </div>
    </div>

    <div class="grid-3">
      <div class="card"><div class="card-head"><h3>Payment modes</h3></div>${hbars(d.payments.map((p) => ({ label: label(PAYMENT_MODE_LABELS, p.mode), value: p.amount })))}</div>
      <div class="card"><div class="card-head"><h3>Order types</h3></div>${hbars(d.byType.map((t) => ({ label: `${label(ORDER_TYPE_LABELS, t.type)} (${t.orders})`, value: t.sales })))}</div>
      <div class="card"><div class="card-head"><h3>Leakage watch</h3></div>
        <table class="table compact">
          <tr><td>Cancelled orders</td><td class="num">${d.cancelled.n}</td><td class="num">${money0(d.cancelled.value)}</td></tr>
          <tr><td>Voided items</td><td class="num">${d.voids.n}</td><td class="num">${money0(d.voids.value)}</td></tr>
          <tr><td>Discounts given</td><td></td><td class="num">${money0(s.discount)}</td></tr>
          <tr><td>Wastage value</td><td></td><td class="num">${money0(d.wastage)}</td></tr>
        </table>
      </div>
    </div>

    <div class="card"><div class="card-head"><h3>Sales by hour</h3><span class="muted small">When orders were placed</span></div>${barChart(hourly, { height: 170 })}</div>

    <div class="grid-2">
      <div class="card flush"><div class="card-head pad"><h3>Item-wise sales</h3><span class="muted small">${d.items.length} items</span></div>
        ${d.items.length ? `<div class="scroll-y"><table class="table compact"><thead><tr><th>#</th><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>
          ${d.items.map((i, n) => `<tr><td class="rank">${n + 1}</td><td>${esc(i.name)}</td><td class="muted">${esc(i.category)}</td><td class="num">${qtyFmt(i.qty)}</td><td class="num">${money0(i.amount)}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState('No item sales')}
      </div>
      <div>
        <div class="card"><div class="card-head"><h3>Category-wise sales</h3></div>${hbars(d.categories.map((c) => ({ label: `${c.category} (${qtyFmt(c.qty)})`, value: c.amount })))}</div>
        <div class="card"><div class="card-head"><h3>Expenses by category</h3><b>${money0(expenses)}</b></div>${hbars(d.expenses.map((e) => ({ label: e.category, value: e.amount })))}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card flush"><div class="card-head pad"><h3>Staff performance</h3></div>
        ${d.staff.length ? `<table class="table compact"><thead><tr><th>Staff</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Avg</th></tr></thead><tbody>
          ${d.staff.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.orders}</td><td class="num">${money0(x.sales)}</td><td class="num">${money0(x.sales / x.orders)}</td></tr>`).join('')}</tbody></table>` : emptyState('No data')}
      </div>
      <div class="card flush"><div class="card-head pad"><h3>Top customers</h3></div>
        ${d.topCustomers.length ? `<table class="table compact"><thead><tr><th>Customer</th><th class="num">Orders</th><th class="num">Spent</th></tr></thead><tbody>
          ${d.topCustomers.map((c) => `<tr><td>${esc(c.name)}<div class="muted small">${esc(c.phone)}</div></td><td class="num">${c.orders}</td><td class="num">${money0(c.spent)}</td></tr>`).join('')}</tbody></table>` : emptyState('No tagged customers in this period')}
      </div>
    </div>`;
}
