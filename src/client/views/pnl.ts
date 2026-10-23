import { api } from '../api.js';
import { $, esc, money, money0, today, addDays, downloadCSV, lineChart, deltaBadge, pctChange, compact } from '../ui.js';
import { periodRange, shiftAnchor, periodLabel } from './expenses.js';
import type { AppCtx } from '../types.js';

interface PnL {
  from: string;
  to: string;
  days: number;
  orders: number;
  covers: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  service_charge: number;
  packaging: number;
  round_off: number;
  other_income: number;
  total_revenue: number;
  tax_collected: number;
  food_cost: number;
  wastage: number;
  cogs: number;
  gross_profit: number;
  gross_margin: number;
  expenses: { category: string; amount: number }[];
  total_expenses: number;
  operating_profit: number;
  net_margin: number;
  avg_order_value: number;
  food_cost_pct: number;
  cancelled_value: number;
  void_value: number;
}

type Unit = 'month' | 'quarter' | 'year' | 'custom';
let root: HTMLElement = document.createElement('div');
let ctxRef: AppCtx | null = null;
let unit: Unit = 'month';
let anchor = today();
let custom: [string, string] = [addDays(today(), -29), today()];
let compare: 'previous' | 'last_year' = 'previous';
let year = Number(today().slice(0, 4));
let data: { current: PnL; previous: PnL; last_year: PnL } | null = null;

const range = (): [string, string] => (unit === 'custom' ? custom : periodRange(unit, anchor));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function render(el: HTMLElement, _p: Record<string, string>, ctx: AppCtx) {
  ctxRef = ctx;
  el.innerHTML = `
    <div class="page pnl">
      <div class="toolbar wrap no-print">
        <div class="seg">${(['month', 'quarter', 'year', 'custom'] as Unit[]).map((u) => `<button data-unit="${u}">${u[0]!.toUpperCase() + u.slice(1)}</button>`).join('')}</div>
        <div class="period-bar" id="p-period"></div>
        <label>Compare with <select id="p-compare"><option value="previous">Previous period</option><option value="last_year">Same period last year</option></select></label>
        <span class="grow"></span>
        <button class="btn ghost" data-a="csv">⇩ CSV</button><button class="btn ghost" data-a="print">⎙ Print</button>
      </div>
      <div id="p-body"></div>
      <div class="card flush" id="p-year"></div>
    </div>`;
  root = $('.pnl', el);
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.unit) {
      unit = d.unit as Unit;
      anchor = today();
      await load();
    } else if (d.shift !== undefined) {
      anchor = d.shift === '0' ? today() : shiftAnchor(unit as Exclude<Unit, 'custom'>, anchor, Number(d.shift));
      await load();
    } else if (d.year) {
      year += Number(d.year);
      await loadYear();
    } else if (d.a === 'print') window.print();
    else if (d.a === 'csv') exportCSV();
  });
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'p-compare') {
      compare = t.value as typeof compare;
      paint();
    } else if (t.dataset.custom) {
      custom[t.dataset.custom === 'from' ? 0 : 1] = t.value;
      if (custom[1] < custom[0]) custom = [custom[1], custom[0]];
      await load();
    }
  });
  await Promise.all([load(), loadYear()]);
}

async function load() {
  root.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => b.classList.toggle('on', b.dataset.unit === unit));
  const [from, to] = range();
  $('#p-period', root).innerHTML =
    unit === 'custom'
      ? `<label>From <input type="date" data-custom="from" value="${from}"></label><label>To <input type="date" data-custom="to" value="${to}"></label>`
      : `<button class="btn ghost sm" data-shift="-1" aria-label="Previous">‹</button><span class="period-label">${esc(periodLabel(unit, from, to))}</span>
         <button class="btn ghost sm" data-shift="1" aria-label="Next">›</button><button class="btn ghost sm" data-shift="0">Current</button>`;
  // Don't count days that haven't happened yet
  const end = to > today() ? today() : to;
  data = from > today() ? null : await api.get(`/pnl?from=${from}&to=${end}`);
  paint();
}

function paint() {
  const body = $('#p-body', root);
  if (!data) {
    body.innerHTML = '<div class="card"><p class="muted">This period hasn’t started yet.</p></div>';
    return;
  }
  const c = data.current;
  const p = compare === 'previous' ? data.previous : data.last_year;
  const cmpLabel = compare === 'previous' ? `Previous (${p.days} days)` : 'Same period last year';
  const cats = [...new Set([...c.expenses.map((e) => e.category), ...p.expenses.map((e) => e.category)])];
  const exp = (x: PnL, cat: string) => x.expenses.find((e) => e.category === cat)?.amount || 0;
  const share = (v: number) => (c.total_revenue ? `${((v / c.total_revenue) * 100).toFixed(1)}%` : '—');
  type Line = [cls: string, label: string, now: number | null, before: number | null, invert?: boolean, sign?: string];
  const lines: Line[] = [
    ['sec', 'Income', null, null],
    ['sub', 'Gross sales', c.gross_sales, p.gross_sales],
    ['sub', 'Less: discounts', -c.discounts, -p.discounts, true],
    ['total', 'Net sales', c.net_sales, p.net_sales],
    ['sub', 'Service charge', c.service_charge, p.service_charge],
    ['sub', 'Packaging charges', c.packaging, p.packaging],
    ['sub', 'Round-off', c.round_off, p.round_off],
    ['total', 'Total revenue (excl. GST)', c.total_revenue, p.total_revenue],
    ['sec', 'Cost of goods sold', null, null],
    ['sub', 'Food cost (ingredients used, from recipes)', c.food_cost, p.food_cost, true],
    ['sub', 'Wastage', c.wastage, p.wastage, true],
    ['total', 'Total cost of goods', c.cogs, p.cogs, true],
    ['grand', `Gross profit  (${c.gross_margin}% margin)`, c.gross_profit, p.gross_profit],
    ['sec', 'Operating expenses', null, null],
    ...cats.map((cat): Line => ['sub', cat, exp(c, cat), exp(p, cat), true]),
    ['total', 'Total operating expenses', c.total_expenses, p.total_expenses, true],
    ['grand', `${c.operating_profit >= 0 ? 'Net profit' : 'Net loss'}  (${c.net_margin}% margin)`, c.operating_profit, p.operating_profit],
  ];
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><small>Revenue</small><b>${money0(c.total_revenue)}</b><span>${deltaBadge(pctChange(c.total_revenue, p.total_revenue))} vs ${money0(p.total_revenue)}</span></div>
      <div class="kpi"><small>Gross profit</small><b>${money0(c.gross_profit)}</b><span>${c.gross_margin}% margin · ${deltaBadge(pctChange(c.gross_profit, p.gross_profit))}</span></div>
      <div class="kpi"><small>Operating expenses</small><b>${money0(c.total_expenses)}</b><span>${deltaBadge(pctChange(c.total_expenses, p.total_expenses), true)} vs ${money0(p.total_expenses)}</span></div>
      <div class="kpi ${c.operating_profit >= 0 ? 'ok' : 'danger'}"><small>${c.operating_profit >= 0 ? 'Net profit' : 'Net loss'}</small><b>${money0(c.operating_profit)}</b><span>${c.net_margin}% margin · ${deltaBadge(pctChange(c.operating_profit, p.operating_profit))}</span></div>
    </div>
    <div class="grid-2 wide-left">
      <div class="card flush">
        <div class="card-head pad"><h3>Profit &amp; Loss statement</h3><span class="muted small">${esc(periodLabel(unit, c.from, c.to))}${unit !== 'custom' && range()[1] > today() ? ' (to date)' : ''}</span></div>
        <table class="table statement"><thead><tr><th></th><th class="num">This period</th><th class="num">${cmpLabel}</th><th class="num">Change</th><th class="num">% of revenue</th></tr></thead><tbody>
          ${lines
            .map(([cls, label, now, before, invert]) =>
              cls === 'sec'
                ? `<tr class="sec"><td colspan="5">${esc(label)}</td></tr>`
                : `<tr class="${cls}"><td>${esc(label)}</td><td class="num ${now! < 0 && cls === 'grand' ? 'neg' : ''}">${money(now)}</td><td class="num muted">${money(before)}</td>
                  <td class="num">${deltaBadge(pctChange(Math.abs(now!), Math.abs(before!)), invert)}</td><td class="num muted">${share(Math.abs(now!))}</td></tr>`,
            )
            .join('')}
          <tr class="sec"><td colspan="5">For reference (not in profit)</td></tr>
          <tr class="memo"><td>GST collected — payable to the government</td><td class="num">${money(c.tax_collected)}</td><td class="num">${money(p.tax_collected)}</td><td></td><td></td></tr>
          <tr class="memo"><td>Bills · average bill · dine-in covers</td><td class="num">${c.orders} · ${money0(c.avg_order_value)} · ${c.covers}</td><td class="num">${p.orders} · ${money0(p.avg_order_value)} · ${p.covers}</td><td class="num">${deltaBadge(pctChange(c.orders, p.orders))}</td><td></td></tr>
          <tr class="memo"><td>Cancelled orders / voided items (lost sales)</td><td class="num">${money0(c.cancelled_value)} / ${money0(c.void_value)}</td><td class="num">${money0(p.cancelled_value)} / ${money0(p.void_value)}</td><td></td><td></td></tr>
        </tbody></table>
        <p class="note pad">Food cost comes from the recipes set on menu items and the cost price of raw materials. Dishes without a recipe add no food cost — set recipes in Menu for an accurate gross profit.</p>
      </div>
      <div>
        <div class="card"><div class="card-head"><h3>Where each ${esc(ctxRef?.settings.currency || '₹')}100 of revenue went</h3></div>${waterfall(c)}</div>
        <div class="card"><div class="card-head"><h3>Key ratios</h3></div>
          <div class="figs">
            <span>Food cost % of net sales</span><b class="${c.food_cost_pct > 35 ? 'danger-text' : ''}">${c.food_cost_pct}%</b>
            <span>Gross margin</span><b>${c.gross_margin}%</b>
            <span>Expenses % of revenue</span><b>${c.total_revenue ? ((c.total_expenses / c.total_revenue) * 100).toFixed(1) : '—'}%</b>
            <span>Net margin</span><b class="${c.net_margin < 0 ? 'danger-text' : 'ok-text'}">${c.net_margin}%</b>
            <span>Discounts % of gross sales</span><b>${c.gross_sales ? ((c.discounts / c.gross_sales) * 100).toFixed(1) : '—'}%</b>
            <span>Revenue per day</span><b>${money0(c.total_revenue / c.days)}</b>
            <span>Profit per day</span><b>${money0(c.operating_profit / c.days)}</b>
          </div>
          <p class="note">Healthy restaurant benchmarks: food cost 28–35%, net margin 10–20%.</p>
        </div>
      </div>
    </div>`;
}


function waterfall(c: PnL): string {
  if (!c.total_revenue) return '<div class="empty">No revenue in this period</div>';
  const parts = [
    { label: 'Cost of goods', v: c.cogs, color: 'var(--warn)' },
    { label: 'Operating expenses', v: c.total_expenses, color: 'var(--info)' },
    { label: c.operating_profit >= 0 ? 'Profit' : 'Loss', v: Math.abs(c.operating_profit), color: c.operating_profit >= 0 ? 'var(--ok)' : 'var(--danger)' },
  ];
  const total = parts.reduce((a, x) => a + x.v, 0) || 1;
  return `<div class="stack-bar">${parts.map((x) => `<div style="width:${((x.v / total) * 100).toFixed(1)}%;background:${x.color}" title="${esc(x.label)}: ${money0(x.v)}"></div>`).join('')}</div>
    <div class="figs mt">${parts.map((x) => `<span><i class="dot" style="background:${x.color}"></i>${esc(x.label)}</span><b>${((x.v / c.total_revenue) * 100).toFixed(1)} per 100</b>`).join('')}</div>`;
}

async function loadYear() {
  const r = await api.get<{ year: number; months: (PnL | null)[] }>(`/pnl/monthly?year=${year}`);
  // Months before the restaurant had any activity are shown as blank rather than rows of zeros
  const ms = r.months.map((m) => (m && (m.orders || m.total_expenses || m.cogs) ? m : null));
  const val = (f: (p: PnL) => number) => ms.map((m) => (m ? f(m) : null));
  const sumOf = (f: (p: PnL) => number) => ms.reduce((a, m) => a + (m ? f(m) : 0), 0);
  type Row = [label: string, f: (p: PnL) => number, cls?: string];
  const rows: Row[] = [
    ['Revenue (excl. GST)', (p) => p.total_revenue],
    ['Cost of goods', (p) => p.cogs],
    ['Gross profit', (p) => p.gross_profit, 'total'],
    ['Operating expenses', (p) => p.total_expenses],
    ['Net profit / loss', (p) => p.operating_profit, 'grand'],
    ['Bills', (p) => p.orders, 'memo'],
  ];
  const totalRev = sumOf((p) => p.total_revenue);
  const totalProfit = sumOf((p) => p.operating_profit);
  $('#p-year', root).innerHTML = `
    <div class="card-head pad"><h3>Month by month — ${r.year}</h3>
      <div class="actions"><button class="btn ghost sm" data-year="-1">‹ ${r.year - 1}</button>${r.year < Number(today().slice(0, 4)) ? `<button class="btn ghost sm" data-year="1">${r.year + 1} ›</button>` : ''}</div></div>
    <div class="pad">${lineChart(MONTHS, [
      { name: 'Revenue', color: 'var(--brand)', values: val((p) => p.total_revenue) },
      { name: 'Expenses + cost of goods', color: 'var(--warn)', values: val((p) => p.total_expenses + p.cogs) },
      { name: 'Net profit', color: 'var(--ok)', values: val((p) => p.operating_profit) },
    ], { height: 220 })}</div>
    <div style="overflow-x:auto"><table class="table compact statement months-table"><thead><tr><th></th>${MONTHS.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Year</th></tr></thead><tbody>
      ${rows
        .map(
          ([label, f, cls]) => `<tr class="${cls || ''}"><td>${label}</td>${ms.map((m) => `<td class="num ${m && f(m) < 0 ? 'neg' : ''}">${m ? (cls === 'memo' ? f(m) : compact(f(m))) : '<span class="muted">—</span>'}</td>`).join('')}
          <td class="num"><b>${cls === 'memo' ? sumOf(f) : money0(sumOf(f))}</b></td></tr>`,
        )
        .join('')}
      <tr class="memo"><td>Net margin</td>${ms.map((m) => `<td class="num">${m ? `${m.net_margin}%` : ''}</td>`).join('')}<td class="num"><b>${totalRev ? ((totalProfit / totalRev) * 100).toFixed(1) : 0}%</b></td></tr>
    </tbody></table></div>`;
  (root as HTMLElement & { _year?: (PnL | null)[] })._year = ms;
}

function exportCSV() {
  if (!data) return;
  const c = data.current;
  const p = compare === 'previous' ? data.previous : data.last_year;
  const row = (l: string, a: number, b: number) => [l, a, b, b ? (((a - b) / Math.abs(b)) * 100).toFixed(1) + '%' : ''];
  downloadCSV(`profit-and-loss-${c.from}-to-${c.to}.csv`, [
    ['Line', `${c.from} to ${c.to}`, `${p.from} to ${p.to}`, 'Change'],
    row('Gross sales', c.gross_sales, p.gross_sales),
    row('Discounts', -c.discounts, -p.discounts),
    row('Net sales', c.net_sales, p.net_sales),
    row('Service charge', c.service_charge, p.service_charge),
    row('Packaging', c.packaging, p.packaging),
    row('Round-off', c.round_off, p.round_off),
    row('Total revenue (excl. GST)', c.total_revenue, p.total_revenue),
    row('Food cost', c.food_cost, p.food_cost),
    row('Wastage', c.wastage, p.wastage),
    row('Cost of goods', c.cogs, p.cogs),
    row('Gross profit', c.gross_profit, p.gross_profit),
    ...[...new Set([...c.expenses, ...p.expenses].map((e) => e.category))].map((cat) =>
      row(`Expense: ${cat}`, c.expenses.find((e) => e.category === cat)?.amount || 0, p.expenses.find((e) => e.category === cat)?.amount || 0),
    ),
    row('Total operating expenses', c.total_expenses, p.total_expenses),
    row('Net profit', c.operating_profit, p.operating_profit),
    row('GST collected (payable)', c.tax_collected, p.tax_collected),
    row('Bills', c.orders, p.orders),
  ]);
}
