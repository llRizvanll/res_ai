// Recurring expenses tab: templates that post automatically, with pause / resume / stop.
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { fmtDate, money, money0 } from '../../core/format.js';
import { today } from '../../core/dates.js';
import { E, type Recurring } from './state.js';
import { badge, emptyState, formModal, toast } from '../../ui/index.js';
import { reload } from './index.js';
import { EXPENSE_CATEGORIES, FREQUENCY_LABELS, FREQUENCY_PER_YEAR } from '../../../shared/domain.js';

export async function paintRecurring() {
  const rows = await api.get<Recurring[]>('/expenses/recurring');
  const monthly = rows.filter((r) => r.active).reduce((a, r) => a + (r.amount * FREQUENCY_PER_YEAR[r.frequency]) / 12, 0);
  $('#e-body', E.root).innerHTML = `
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
              <td>${FREQUENCY_LABELS[r.frequency]}<div class="muted small">since ${fmtDate(r.start_date)}</div></td><td class="num"><b>${money(r.amount)}</b></td>
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
  E.recurring = rows;
}

export function editRecurring(r?: Recurring) {
  formModal({
    title: r ? `Edit recurring: ${r.category}` : 'Add recurring expense',
    values: r || { start_date: today(), frequency: 'monthly', category: 'Rent' },
    intro: r ? '<p class="muted small">Changes apply from the next due date. Entries already added are not changed.</p>' : '',
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES.map((c) => [c, c]), half: true },
      { name: 'amount', label: 'Amount each time', type: 'number', step: '0.01', min: 0, required: true, half: true },
      { name: 'frequency', label: 'Repeats', type: 'select', options: Object.entries(FREQUENCY_LABELS) as [string, string][], half: true },
      { name: 'paid_to', label: 'Paid to', half: true },
      { name: 'start_date', label: 'First / anchor date', type: 'date', required: true, half: true, hint: 'Monthly items repeat on this day of the month' },
      { name: 'end_date', label: 'Ends on (optional)', type: 'date', half: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      if (r) await api.put(`/expenses/recurring/${r.id}`, v);
      else await api.post('/expenses/recurring', v);
      toast('Recurring expense saved');
      await reload();
    },
  });
}
