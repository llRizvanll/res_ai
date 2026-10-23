// Expenses tab: totals vs previous period, breakdown chart, categories and the list itself.
import { $, esc } from '../../core/dom.js';
import { addDays, MONTH_NAMES, parseDay, periodRange, shiftAnchor, today } from '../../core/dates.js';
import { api } from '../../core/api.js';
import { fmtDate, money, money0, pctChange } from '../../core/format.js';
import { E, type ExpenseRow, range } from './state.js';
import { UI_CONFIG } from '../../config.js';
import { badge, barChart, deltaBadge, emptyState, formModal, hbars, toast } from '../../ui/index.js';
import { reload } from './index.js';
import { EXPENSE_CATEGORIES, type Frequency, FREQUENCY_LABELS } from '../../../shared/domain.js';

export async function loadList() {
  const [from, to] = range();
  const days = Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400_000) + 1;
  const [prevFrom, prevTo] = E.unit === 'custom' ? [addDays(from, -days), addDays(from, -1)] : periodRange(E.unit, shiftAnchor(E.unit, E.anchor, -1));
  const [cur, prev] = await Promise.all([
    api.get<ExpenseRow[]>(`/expenses?from=${from}&to=${to}`),
    api.get<ExpenseRow[]>(`/expenses?from=${prevFrom}&to=${prevTo}`),
  ]);
  E.list = cur;
  const total = cur.reduce((a, e) => a + e.amount, 0);
  const prevTotal = prev.reduce((a, e) => a + e.amount, 0);
  const cats: Record<string, number> = {};
  for (const e of cur) cats[e.category] = (cats[e.category] || 0) + e.amount;
  const catRows = Object.entries(cats).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const recurringTotal = cur.filter((e) => e.recurring_id).reduce((a, e) => a + e.amount, 0);
  const elapsed = Math.min(days, Math.max(1, Math.round((parseDay(today()).getTime() - parseDay(from).getTime()) / 86400_000) + 1));

  // Breakdown over the period: days for week/month/E.custom, months for a year
  let chart = '';
  if (E.unit === 'year' || (E.unit === 'custom' && days > 62)) {
    const byMonth = new Map<string, number>();
    for (const e of cur) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) || 0) + e.amount);
    const keys: string[] = [];
    for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = shiftAnchor('month', d + '-01', 1).slice(0, 7)) keys.push(d);
    chart = barChart(keys.map((k) => ({ label: `${MONTH_NAMES[Number(k.slice(5)) - 1]}${E.unit === 'custom' ? ` ${k.slice(2, 4)}` : ''}`, value: byMonth.get(k) || 0, tip: `${k}: ${money0(byMonth.get(k) || 0)}` })), { height: 200 });
  } else if (E.unit !== 'day') {
    const byDay = new Map<string, number>();
    for (const e of cur) byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount);
    const pts = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dt = parseDay(d);
      pts.push({ label: E.unit === 'week' ? dt.toLocaleDateString(UI_CONFIG.locale, { weekday: 'short' }) : String(dt.getDate()), value: byDay.get(d) || 0, tip: `${fmtDate(d)}: ${money0(byDay.get(d) || 0)}` });
    }
    chart = barChart(pts, { height: 200 });
  }

  $('#e-body', E.root).innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><small>Total spent</small><b>${money0(total)}</b><span>${deltaBadge(pctChange(total, prevTotal), true)} vs previous ${E.unit === 'custom' ? 'period' : E.unit} (${money0(prevTotal)})</span></div>
      <div class="kpi"><small>Average per day</small><b>${money0(total / elapsed)}</b><span>over ${elapsed} day${elapsed > 1 ? 's' : ''}</span></div>
      <div class="kpi"><small>Biggest category</small><b>${esc(catRows[0]?.label || '—')}</b><span>${catRows[0] ? `${money0(catRows[0].value)} · ${Math.round((catRows[0].value / total) * 100)}%` : ''}</span></div>
      <div class="kpi"><small>From recurring</small><b>${money0(recurringTotal)}</b><span>${total ? Math.round((recurringTotal / total) * 100) : 0}% of spending · ${cur.length} entries</span></div>
    </div>
    <div class="grid-2 wide-left">
      <div class="card"><div class="card-head"><h3>${E.unit === 'year' ? 'By month' : E.unit === 'day' ? 'Entries' : 'By day'}</h3></div>${chart || '<p class="muted small">Switch to Week, Month or Year to see a breakdown over time.</p>'}</div>
      <div class="card"><div class="card-head"><h3>By category</h3></div>${hbars(catRows)}</div>
    </div>
    <div class="card flush">
      <div class="toolbar pad"><select id="e-cat"><option value="">All categories</option>${[...new Set([...EXPENSE_CATEGORIES, ...Object.keys(cats)])].map((c) => `<option ${c === E.catFilter ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input type="search" id="e-q" placeholder="Search paid to / note…" value="${esc(E.q)}"></div>
      <div id="e-list"></div>
    </div>`;
  paintList();
}

export function paintList() {
  const rows = E.list.filter((e) => (!E.catFilter || e.category === E.catFilter) && (!E.q || `${e.paid_to} ${e.note}`.toLowerCase().includes(E.q)));
  const total = rows.reduce((a, e) => a + e.amount, 0);
  $('#e-list', E.root).innerHTML = rows.length
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

export function editExpense(x?: ExpenseRow) {
  formModal({
    title: x ? 'Edit expense' : 'Add expense',
    values: x || { date: today(), category: EXPENSE_CATEGORIES[0], repeat: '' },
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true, half: true },
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES.map((c) => [c, c]), half: true },
      { name: 'paid_to', label: 'Paid to', half: true },
      ...(x
        ? []
        : [{ name: 'repeat', label: 'Repeat', type: 'select' as const, options: [['', 'Does not repeat'], ...Object.entries(FREQUENCY_LABELS)] as [string, string][], hint: 'Repeating expenses are added automatically on each due date' }]),
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      if (x) await api.put('/expenses/' + x.id, v);
      else if (v.repeat) {
        await api.post('/expenses/recurring', { ...v, frequency: v.repeat, start_date: v.date });
        toast(`Saved — repeats ${FREQUENCY_LABELS[v.repeat as Frequency].toLowerCase()}`);
      } else await api.post('/expenses', v);
      if (!x && !v.repeat) toast('Expense saved');
      await reload();
    },
  });
}
