// Profit & Loss page: period picker, comparison choice, statement and the year by month.
import type { AppCtx } from '../../core/types/app.js';
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { periodLabel, shiftAnchor, today } from '../../core/dates.js';
import { P, range, type Unit } from './state.js';
import { exportCSV } from './csv.js';
import { loadYear } from './year.js';
import { paint } from './statement.js';

export async function render(el: HTMLElement, _p: Record<string, string>, ctx: AppCtx) {
  P.ctxRef = ctx;
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
  P.root = $('.pnl', el);
  P.root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.unit) {
      P.unit = d.unit as Unit;
      P.anchor = today();
      await load();
    } else if (d.shift !== undefined) {
      P.anchor = d.shift === '0' ? today() : shiftAnchor(P.unit as Exclude<Unit, 'custom'>, P.anchor, Number(d.shift));
      await load();
    } else if (d.year) {
      P.year += Number(d.year);
      await loadYear();
    } else if (d.a === 'print') window.print();
    else if (d.a === 'csv') exportCSV();
  });
  P.root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'p-compare') {
      P.compare = t.value as typeof P.compare;
      paint();
    } else if (t.dataset.custom) {
      P.custom[t.dataset.custom === 'from' ? 0 : 1] = t.value;
      if (P.custom[1] < P.custom[0]) P.custom = [P.custom[1], P.custom[0]];
      await load();
    }
  });
  await Promise.all([load(), loadYear()]);
}

export async function load() {
  P.root.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => b.classList.toggle('on', b.dataset.unit === P.unit));
  const [from, to] = range();
  $('#p-period', P.root).innerHTML =
    P.unit === 'custom'
      ? `<label>From <input type="date" data-custom="from" value="${from}"></label><label>To <input type="date" data-custom="to" value="${to}"></label>`
      : `<button class="btn ghost sm" data-shift="-1" aria-label="Previous">‹</button><span class="period-label">${esc(periodLabel(P.unit, from, to))}</span>
         <button class="btn ghost sm" data-shift="1" aria-label="Next">›</button><button class="btn ghost sm" data-shift="0">Current</button>`;
  // Don't count days that haven't happened yet
  const end = to > today() ? today() : to;
  P.data = from > today() ? null : await api.get(`/pnl?from=${from}&to=${end}`);
  paint();
}
