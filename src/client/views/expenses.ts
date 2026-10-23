import { api } from '../api.js';
import { $, esc, money, money0, fmtDate, formModal, confirmDialog, toast, guard, emptyState, hbars, today, addDays, downloadCSV } from '../ui.js';
import type { AppCtx, Expense } from '../types.js';

const CATEGORIES = ['Groceries & Vegetables', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Marketing', 'Packaging', 'Licences & Taxes', 'Other'];

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let list: Expense[] = [];
const f = { from: addDays(today(), -29), to: today() };

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = `
    <div class="page">
      <div class="toolbar wrap">
        <label>From <input type="date" data-f="from" value="${f.from}"></label>
        <label>To <input type="date" data-f="to" value="${f.to}"></label>
        <span class="grow"></span>
        <button class="btn ghost" data-a="csv">⇩ Export</button>
        <button class="btn primary" data-a="add">+ Add expense</button>
      </div>
      <div class="grid-2 wide-left">
        <div class="card flush" id="e-table"></div>
        <div class="card"><div class="card-head"><h3>By category</h3><b id="e-total"></b></div><div id="e-cats"></div></div>
      </div>
    </div>`;
  root = $('.page', el);
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.f) {
      f[t.dataset.f as 'from' | 'to'] = t.value;
      load();
    }
  });
  root.addEventListener('click', onClick);
  await load();
}

async function load() {
  list = await api.get<Expense[]>(`/expenses?from=${f.from}&to=${f.to}`);
  const cats: Record<string, number> = {};
  for (const e of list) cats[e.category] = (cats[e.category] || 0) + e.amount;
  $('#e-total', root!).textContent = money0(list.reduce((a, e) => a + e.amount, 0));
  $('#e-cats', root!).innerHTML = hbars(Object.entries(cats).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value));
  $('#e-table', root!).innerHTML = list.length
    ? `<table class="table"><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list
        .map(
          (e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.category)}</td><td>${esc(e.paid_to || '—')}</td><td class="small">${esc(e.note || '')}</td>
          <td class="num"><b>${money(e.amount)}</b></td><td class="actions-cell"><button class="btn ghost sm" data-edit="${e.id}">Edit</button><button class="btn ghost sm danger-text" data-del="${e.id}">Delete</button></td></tr>`,
        )
        .join('')}</tbody></table>`
    : emptyState('No expenses in this period');
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.a === 'add') edit();
  else if (d.a === 'csv') downloadCSV(`expenses-${f.from}-to-${f.to}.csv`, [['Date', 'Category', 'Paid to', 'Note', 'Amount'], ...list.map((x) => [x.date, x.category, x.paid_to, x.note, x.amount])]);
  else if (d.edit) edit(list.find((x) => x.id === Number(d.edit)));
  else if (d.del) {
    if (!(await confirmDialog('Delete this expense?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/expenses/' + d.del);
    await load();
  }
});

function edit(x?: Expense) {
  formModal({
    title: x ? 'Edit expense' : 'Add expense',
    values: x || { date: today(), category: CATEGORIES[0] },
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true, half: true },
      { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.map((c) => [c, c]), half: true },
      { name: 'paid_to', label: 'Paid to', half: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      if (x) await api.put('/expenses/' + x.id, v);
      else await api.post('/expenses', v);
      toast('Expense saved');
      await load();
    },
  });
}
