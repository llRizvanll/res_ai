// Expenses page: Day / Week / Month / Year / Custom views of spending, plus recurring expenses.
import type { AppCtx } from '../../core/types/app.js';
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { downloadCSV } from '../../core/csv.js';
import { money } from '../../core/format.js';
import { periodLabel, shiftAnchor, today } from '../../core/dates.js';
import { E, range, type Unit } from './state.js';
import { confirmDialog, guard, toast } from '../../ui/index.js';
import { editExpense, loadList, paintList } from './list.js';
import { editRecurring, paintRecurring } from './recurring.js';
import { FREQUENCY_LABELS } from '../../../shared/domain.js';

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
  E.root = $('.expenses', el);
  E.root.addEventListener('click', onClick);
  E.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.custom) {
      E.custom[t.dataset.custom === 'from' ? 0 : 1] = t.value;
      if (E.custom[1] < E.custom[0]) E.custom = [E.custom[1], E.custom[0]];
      reload();
    } else if (t.id === 'e-cat') {
      E.catFilter = t.value;
      paintList();
    }
  });
  E.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'e-q') {
      E.q = t.value.toLowerCase();
      paintList();
    }
  });
  await reload();
}

function paintHeader() {
  E.root.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => b.classList.toggle('on', b.dataset.unit === E.unit));
  E.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === E.tab));
  const [from, to] = range();
  $('#e-period', E.root).innerHTML =
    E.unit === 'custom'
      ? `<label>From <input type="date" data-custom="from" value="${from}"></label><label>To <input type="date" data-custom="to" value="${to}"></label>`
      : `<button class="btn ghost sm" data-shift="-1" aria-label="Previous">‹</button><span class="period-label">${esc(periodLabel(E.unit, from, to))}</span>
         <button class="btn ghost sm" data-shift="1" aria-label="Next">›</button><button class="btn ghost sm" data-shift="0">Today</button>`;
  $('#e-period', E.root).hidden = E.tab === 'recurring';
  $('#e-unit', E.root).hidden = E.tab === 'recurring';
}

/** Redraws the header and the open tab */
export async function reload() {
  paintHeader();
  if (E.tab === 'recurring') return paintRecurring();
  return loadList();
}
const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.unit) {
    E.unit = d.unit as Unit;
    E.anchor = today();
    await reload();
  } else if (d.tab) {
    E.tab = d.tab as typeof E.tab;
    await reload();
  } else if (d.shift !== undefined) {
    E.anchor = d.shift === '0' ? today() : shiftAnchor(E.unit as Exclude<Unit, 'custom'>, E.anchor, Number(d.shift));
    await reload();
  } else if (d.a === 'add') editExpense();
  else if (d.a === 'add-rec') editRecurring();
  else if (d.a === 'csv') {
    const [from, to] = range();
    downloadCSV(`expenses-${from}-to-${to}.csv`, [['Date', 'Category', 'Paid to', 'Note', 'Amount', 'Recurring'], ...E.list.map((x) => [x.date, x.category, x.paid_to, x.note, x.amount, x.recurring_id ? 'yes' : ''])]);
  } else if (d.edit) editExpense(E.list.find((x) => x.id === Number(d.edit)));
  else if (d.del) {
    if (!(await confirmDialog('Delete this expense?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/expenses/' + d.del);
    await reload();
  } else if (d.recEdit || d.recToggle || d.recDel) {
    const rec = E.recurring.find((r) => r.id === Number(d.recEdit || d.recToggle || d.recDel))!;
    if (d.recEdit) editRecurring(rec);
    else if (d.recToggle) {
      await api.put(`/expenses/recurring/${rec.id}`, { active: !rec.active });
      toast(rec.active ? 'Paused — no new entries will be added' : 'Resumed');
      await reload();
    } else {
      if (!(await confirmDialog(`Stop “${rec.category}” (${money(rec.amount)} ${FREQUENCY_LABELS[rec.frequency].toLowerCase()})? Entries already added stay in your expenses.`, { okLabel: 'Stop it', danger: true }))) return;
      await api.del(`/expenses/recurring/${rec.id}`);
      await reload();
    }
  }
});
