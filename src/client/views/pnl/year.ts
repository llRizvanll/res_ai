// Month-by-month P&L table and chart for one year.
import { $ } from '../../core/dom.js';
import { MONTH_NAMES, today } from '../../core/dates.js';
import { api } from '../../core/api.js';
import { compact, money0 } from '../../core/format.js';
import { P, type PnL } from './state.js';
import { lineChart } from '../../ui/index.js';

export async function loadYear() {
  const r = await api.get<{ year: number; months: (PnL | null)[] }>(`/pnl/monthly?year=${P.year}`);
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
  $('#p-year', P.root).innerHTML = `
    <div class="card-head pad"><h3>Month by month — ${r.year}</h3>
      <div class="actions"><button class="btn ghost sm" data-year="-1">‹ ${r.year - 1}</button>${r.year < Number(today().slice(0, 4)) ? `<button class="btn ghost sm" data-year="1">${r.year + 1} ›</button>` : ''}</div></div>
    <div class="pad">${lineChart(MONTH_NAMES, [
      { name: 'Revenue', color: 'var(--brand)', values: val((p) => p.total_revenue) },
      { name: 'Expenses + cost of goods', color: 'var(--warn)', values: val((p) => p.total_expenses + p.cogs) },
      { name: 'Net profit', color: 'var(--ok)', values: val((p) => p.operating_profit) },
    ], { height: 220 })}</div>
    <div style="overflow-x:auto"><table class="table compact statement months-table"><thead><tr><th></th>${MONTH_NAMES.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Year</th></tr></thead><tbody>
      ${rows
        .map(
          ([label, f, cls]) => `<tr class="${cls || ''}"><td>${label}</td>${ms.map((m) => `<td class="num ${m && f(m) < 0 ? 'neg' : ''}">${m ? (cls === 'memo' ? f(m) : compact(f(m))) : '<span class="muted">—</span>'}</td>`).join('')}
          <td class="num"><b>${cls === 'memo' ? sumOf(f) : money0(sumOf(f))}</b></td></tr>`,
        )
        .join('')}
      <tr class="memo"><td>Net margin</td>${ms.map((m) => `<td class="num">${m ? `${m.net_margin}%` : ''}</td>`).join('')}<td class="num"><b>${totalRev ? ((totalProfit / totalRev) * 100).toFixed(1) : 0}%</b></td></tr>
    </tbody></table></div>`;
  (P.root as HTMLElement & { _year?: (PnL | null)[] })._year = ms;
}
