import { api } from '../api.js';
import {
  $, esc, money, money0, fmtDate, formModal, confirmDialog, toast, guard, emptyState, hbars, barChart, today, addDays, downloadCSV, badge,
  deltaBadge, pctChange,
} from '../ui.js';
import type { AppCtx, Expense } from '../types.js';

export const CATEGORIES = ['Groceries & Vegetables', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Marketing', 'Packaging', 'Licences & Taxes', 'Equipment', 'Other'];

type Unit = 'day' | 'week' | 'month' | 'year' | 'custom';
type Freq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const FREQ_LABEL: Record<Freq, string> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
const PER_MONTH: Record<Freq, number> = { daily: 30.42, weekly: 4.345, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

interface Recurring {
  id: number;
  category: string;
  amount: number;
  paid_to: string | null;
  note: string | null;
  frequency: Freq;
  start_date: string;
  end_date: string | null;
  next_date: string;
  active: number;
  posted: number;
  posted_total: number;
}
interface ExpenseRow extends Expense {
  recurring_id: number | null;
}

// ---------------------------------------------------------------- period maths (shared with the P&L page)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toD = (d: string) => new Date(d + 'T00:00:00');
const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export function periodRange(unit: Exclude<Unit, 'custom'> | 'quarter', anchor: string): [string, string] {
  const d = toD(anchor);
  if (unit === 'day') return [anchor, anchor];
  if (unit === 'week') {
    const start = addDays(anchor, -((d.getDay() + 6) % 7)); // weeks start on Monday
    return [start, addDays(start, 6)];
  }
  if (unit === 'month') return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (unit === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) * 3;
    return [iso(new Date(d.getFullYear(), q, 1)), iso(new Date(d.getFullYear(), q + 3, 0))];
  }
  return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
}
export function shiftAnchor(unit: Exclude<Unit, 'custom'> | 'quarter', anchor: string, n: number): string {
  const d = toD(anchor);
  if (unit === 'day') return addDays(anchor, n);
  if (unit === 'week') return addDays(anchor, 7 * n);
  if (unit === 'month') return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
  if (unit === 'quarter') return iso(new Date(d.getFullYear(), d.getMonth() + 3 * n, 1));
  return iso(new Date(d.getFullYear() + n, 0, 1));
}
export function periodLabel(unit: Unit | 'quarter', from: string, to: string): string {
  const f = toD(from);
  if (unit === 'day') return f.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  if (unit === 'month') return `${MONTHS[f.getMonth()]} ${f.getFullYear()}`;
  if (unit === 'quarter') return `Q${Math.floor(f.getMonth() / 3) + 1} ${f.getFullYear()} (${MONTHS[f.getMonth()]}–${MONTHS[toD(to).getMonth()]})`;
  if (unit === 'year') return String(f.getFullYear());
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

// ---------------------------------------------------------------- state
let root: HTMLElement = document.createElement('div');
let tab: 'list' | 'recurring' = 'list';
let unit: Unit = 'month';
let anchor = today();
let custom: [string, string] = [addDays(today(), -29), today()];
let catFilter = '';
let q = '';
let list: ExpenseRow[] = [];

const range = (): [string, string] => (unit === 'custom' ? custom : periodRange(unit, anchor));

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = `
    <div class="page expenses">
      <div class="toolbar wrap">
        <div class="seg" id="e-unit">${(['day', 'week', 'month', 'year', 'custom'] as Unit[]).map((u) => `<button data-unit="${u}">${u[0]!.toUpperCase() + u.slice(1)}</button>`).join('')}</div>
        <div class="period-bar" id="e-period"></div>
        <span class="grow"></span>
        <button class="btn ghost" data-a="csv">⇩ Export</button>
        <button class="btn primary" data-a="add">+ Add expense</button>
      </div>
      <div class="tabs"><button data-tab="list">Expenses</button><button data-tab="recurring">Recurring expenses</button></div>
      <div id="e-body"></div>
    </div>`;
  root = $('.expenses', el);
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.custom) {
      custom[t.dataset.custom === 'from' ? 0 : 1] = t.value;
      if (custom[1] < custom[0]) custom = [custom[1], custom[0]];
      load();
    } else if (t.id === 'e-cat') {
      catFilter = t.value;
      paintList();
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'e-q') {
      q = t.value.toLowerCase();
      paintList();
    }
  });
  await load();
}

function paintHeader() {
  root.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => b.classList.toggle('on', b.dataset.unit === unit));
  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const [from, to] = range();
  $('#e-period', root).innerHTML =
    unit === 'custom'
      ? `<label>From <input type="date" data-custom="from" value="${from}"></label><label>To <input type="date" data-custom="to" value="${to}"></label>`
      : `<button class="btn ghost sm" data-shift="-1" aria-label="Previous">‹</button><span class="period-label">${esc(periodLabel(unit, from, to))}</span>
         <button class="btn ghost sm" data-shift="1" aria-label="Next">›</button><button class="btn ghost sm" data-shift="0">Today</button>`;
  $('#e-period', root).hidden = tab === 'recurring';
  $('#e-unit', root).hidden = tab === 'recurring';
}

async function load() {
  paintHeader();
  if (tab === 'recurring') return paintRecurring();
  const [from, to] = range();
  const days = Math.round((toD(to).getTime() - toD(from).getTime()) / 86400_000) + 1;
  const [prevFrom, prevTo] = unit === 'custom' ? [addDays(from, -days), addDays(from, -1)] : periodRange(unit, shiftAnchor(unit, anchor, -1));
  const [cur, prev] = await Promise.all([
    api.get<ExpenseRow[]>(`/expenses?from=${from}&to=${to}`),
    api.get<ExpenseRow[]>(`/expenses?from=${prevFrom}&to=${prevTo}`),
  ]);
  list = cur;
  const total = cur.reduce((a, e) => a + e.amount, 0);
  const prevTotal = prev.reduce((a, e) => a + e.amount, 0);
  const cats: Record<string, number> = {};
  for (const e of cur) cats[e.category] = (cats[e.category] || 0) + e.amount;
  const catRows = Object.entries(cats).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const recurringTotal = cur.filter((e) => e.recurring_id).reduce((a, e) => a + e.amount, 0);
  const elapsed = Math.min(days, Math.max(1, Math.round((toD(today()).getTime() - toD(from).getTime()) / 86400_000) + 1));

  // Breakdown over the period: days for week/month/custom, months for a year
  let chart = '';
  if (unit === 'year' || (unit === 'custom' && days > 62)) {
    const byMonth = new Map<string, number>();
    for (const e of cur) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) || 0) + e.amount);
    const keys: string[] = [];
    for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = shiftAnchor('month', d + '-01', 1).slice(0, 7)) keys.push(d);
    chart = barChart(keys.map((k) => ({ label: `${MONTHS[Number(k.slice(5)) - 1]}${unit === 'custom' ? ` ${k.slice(2, 4)}` : ''}`, value: byMonth.get(k) || 0, tip: `${k}: ${money0(byMonth.get(k) || 0)}` })), { height: 200 });
  } else if (unit !== 'day') {
    const byDay = new Map<string, number>();
    for (const e of cur) byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount);
    const pts = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dt = toD(d);
      pts.push({ label: unit === 'week' ? dt.toLocaleDateString('en-IN', { weekday: 'short' }) : String(dt.getDate()), value: byDay.get(d) || 0, tip: `${fmtDate(d)}: ${money0(byDay.get(d) || 0)}` });
    }
    chart = barChart(pts, { height: 200 });
  }

  $('#e-body', root).innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><small>Total spent</small><b>${money0(total)}</b><span>${deltaBadge(pctChange(total, prevTotal), true)} vs previous ${unit === 'custom' ? 'period' : unit} (${money0(prevTotal)})</span></div>
      <div class="kpi"><small>Average per day</small><b>${money0(total / elapsed)}</b><span>over ${elapsed} day${elapsed > 1 ? 's' : ''}</span></div>
      <div class="kpi"><small>Biggest category</small><b>${esc(catRows[0]?.label || '—')}</b><span>${catRows[0] ? `${money0(catRows[0].value)} · ${Math.round((catRows[0].value / total) * 100)}%` : ''}</span></div>
      <div class="kpi"><small>From recurring</small><b>${money0(recurringTotal)}</b><span>${total ? Math.round((recurringTotal / total) * 100) : 0}% of spending · ${cur.length} entries</span></div>
    </div>
    <div class="grid-2 wide-left">
      <div class="card"><div class="card-head"><h3>${unit === 'year' ? 'By month' : unit === 'day' ? 'Entries' : 'By day'}</h3></div>${chart || '<p class="muted small">Switch to Week, Month or Year to see a breakdown over time.</p>'}</div>
      <div class="card"><div class="card-head"><h3>By category</h3></div>${hbars(catRows)}</div>
    </div>
    <div class="card flush">
      <div class="toolbar pad"><select id="e-cat"><option value="">All categories</option>${[...new Set([...CATEGORIES, ...Object.keys(cats)])].map((c) => `<option ${c === catFilter ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input type="search" id="e-q" placeholder="Search paid to / note…" value="${esc(q)}"></div>
      <div id="e-list"></div>
    </div>`;
  paintList();
}

function paintList() {
  const rows = list.filter((e) => (!catFilter || e.category === catFilter) && (!q || `${e.paid_to} ${e.note}`.toLowerCase().includes(q)));
  const total = rows.reduce((a, e) => a + e.amount, 0);
  $('#e-list', root).innerHTML = rows.length
    ? `<table class="table"><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${rows
        .map(
          (e) => `<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${esc(e.category)} ${e.recurring_id ? badge('recurring', 'info') : ''}</td><td>${esc(e.paid_to || '—')}</td>
          <td class="small">${esc(e.note || '')}</td><td class="num"><b>${money(e.amount)}</b></td>
          <td class="actions-cell"><button class="btn ghost sm" data-edit="${e.id}">Edit</button><button class="btn ghost sm danger-text" data-del="${e.id}">Delete</button></td></tr>`,
        )
        .join('')}
      <tr><td colspan="4"><b>Total (${rows.length})</b></td><td class="num"><b>${money(total)}</b></td><td></td></tr></tbody></table>`
    : emptyState('No expenses in this period', 'Add one with “+ Add expense”');
}

async function paintRecurring() {
  const rows = await api.get<Recurring[]>('/expenses/recurring');
  const monthly = rows.filter((r) => r.active).reduce((a, r) => a + r.amount * PER_MONTH[r.frequency], 0);
  $('#e-body', root).innerHTML = `
    <div class="kpis small">
      <div class="kpi"><small>Active recurring</small><b>${rows.filter((r) => r.active).length}</b></div>
      <div class="kpi"><small>Monthly equivalent</small><b>${money0(monthly)}</b><span>your fixed costs per month</span></div>
      <div class="kpi"><small>Yearly equivalent</small><b>${money0(monthly * 12)}</b></div>
    </div>
    <div class="card flush">
      <div class="toolbar pad"><span class="muted small">Recurring expenses are added automatically on their due date (rent, salaries, EMIs, subscriptions, weekly gas…).</span>
        <span class="grow"></span><button class="btn primary" data-a="add-rec">+ Add recurring</button></div>
      ${rows.length
        ? `<table class="table"><thead><tr><th>Expense</th><th>Repeats</th><th class="num">Amount</th><th>Next due</th><th>Ends</th><th class="num">Posted so far</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows
            .map(
              (r) => `<tr class="${r.active ? '' : 'muted'}"><td><b>${esc(r.category)}</b><div class="muted small">${esc(r.paid_to || '')}${r.note ? ` · ${esc(r.note)}` : ''}</div></td>
              <td>${FREQ_LABEL[r.frequency]}<div class="muted small">since ${fmtDate(r.start_date)}</div></td><td class="num"><b>${money(r.amount)}</b></td>
              <td>${r.active ? fmtDate(r.next_date) : '—'}</td><td>${r.end_date ? fmtDate(r.end_date) : 'No end'}</td>
              <td class="num">${r.posted}× <div class="muted small">${money0(r.posted_total)}</div></td>
              <td>${r.active ? badge('Active', 'ok') : badge('Paused', 'warn')}</td>
              <td class="actions-cell"><button class="btn ghost sm" data-rec-edit="${r.id}">Edit</button>
                <button class="btn ghost sm" data-rec-toggle="${r.id}">${r.active ? 'Pause' : 'Resume'}</button>
                <button class="btn ghost sm danger-text" data-rec-del="${r.id}">Stop</button></td></tr>`,
            )
            .join('')}</tbody></table>`
        : emptyState('No recurring expenses yet', 'Add rent, salaries, subscriptions or any bill that repeats')}
    </div>`;
  (root as HTMLElement & { _rec?: Recurring[] })._rec = rows;
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.unit) {
    unit = d.unit as Unit;
    anchor = today();
    await load();
  } else if (d.tab) {
    tab = d.tab as typeof tab;
    await load();
  } else if (d.shift !== undefined) {
    anchor = d.shift === '0' ? today() : shiftAnchor(unit as Exclude<Unit, 'custom'>, anchor, Number(d.shift));
    await load();
  } else if (d.a === 'add') editExpense();
  else if (d.a === 'add-rec') editRecurring();
  else if (d.a === 'csv') {
    const [from, to] = range();
    downloadCSV(`expenses-${from}-to-${to}.csv`, [['Date', 'Category', 'Paid to', 'Note', 'Amount', 'Recurring'], ...list.map((x) => [x.date, x.category, x.paid_to, x.note, x.amount, x.recurring_id ? 'yes' : ''])]);
  } else if (d.edit) editExpense(list.find((x) => x.id === Number(d.edit)));
  else if (d.del) {
    if (!(await confirmDialog('Delete this expense?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/expenses/' + d.del);
    await load();
  } else if (d.recEdit || d.recToggle || d.recDel) {
    const rec = ((root as HTMLElement & { _rec?: Recurring[] })._rec || []).find((r) => r.id === Number(d.recEdit || d.recToggle || d.recDel))!;
    if (d.recEdit) editRecurring(rec);
    else if (d.recToggle) {
      await api.put(`/expenses/recurring/${rec.id}`, { active: !rec.active });
      toast(rec.active ? 'Paused — no new entries will be added' : 'Resumed');
      await load();
    } else {
      if (!(await confirmDialog(`Stop “${rec.category}” (${money(rec.amount)} ${FREQ_LABEL[rec.frequency].toLowerCase()})? Entries already added stay in your expenses.`, { okLabel: 'Stop it', danger: true }))) return;
      await api.del(`/expenses/recurring/${rec.id}`);
      await load();
    }
  }
});

function editExpense(x?: ExpenseRow) {
  formModal({
    title: x ? 'Edit expense' : 'Add expense',
    values: x || { date: today(), category: CATEGORIES[0], repeat: '' },
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true, half: true },
      { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.map((c) => [c, c]), half: true },
      { name: 'paid_to', label: 'Paid to', half: true },
      ...(x
        ? []
        : [{ name: 'repeat', label: 'Repeat', type: 'select' as const, options: [['', 'Does not repeat'], ...Object.entries(FREQ_LABEL)] as [string, string][], hint: 'Repeating expenses are added automatically on each due date' }]),
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      if (x) await api.put('/expenses/' + x.id, v);
      else if (v.repeat) {
        await api.post('/expenses/recurring', { ...v, frequency: v.repeat, start_date: v.date });
        toast(`Saved — repeats ${FREQ_LABEL[v.repeat as Freq].toLowerCase()}`);
      } else await api.post('/expenses', v);
      if (!x && !v.repeat) toast('Expense saved');
      await load();
    },
  });
}

function editRecurring(r?: Recurring) {
  formModal({
    title: r ? `Edit recurring: ${r.category}` : 'Add recurring expense',
    values: r || { start_date: today(), frequency: 'monthly', category: 'Rent' },
    intro: r ? '<p class="muted small">Changes apply from the next due date. Entries already added are not changed.</p>' : '',
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.map((c) => [c, c]), half: true },
      { name: 'amount', label: 'Amount each time', type: 'number', step: '0.01', min: 0, required: true, half: true },
      { name: 'frequency', label: 'Repeats', type: 'select', options: Object.entries(FREQ_LABEL) as [string, string][], half: true },
      { name: 'paid_to', label: 'Paid to', half: true },
      { name: 'start_date', label: 'First / anchor date', type: 'date', required: true, half: true, hint: 'Monthly items repeat on this day of the month' },
      { name: 'end_date', label: 'Ends on (optional)', type: 'date', half: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      if (r) await api.put(`/expenses/recurring/${r.id}`, v);
      else await api.post('/expenses/recurring', v);
      toast('Recurring expense saved');
      await load();
    },
  });
}
