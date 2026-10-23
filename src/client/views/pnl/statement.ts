// The P&L statement for the chosen period, compared side by side, plus key ratios.
import { $, esc } from '../../core/dom.js';
import { money, money0, pctChange } from '../../core/format.js';
import { periodLabel, today } from '../../core/dates.js';
import { P, type PnL, range } from './state.js';
import { deltaBadge } from '../../ui/index.js';
import { BENCHMARKS } from '../../../shared/benchmarks.js';

export function paint() {
  const body = $('#p-body', P.root);
  if (!P.data) {
    body.innerHTML = '<div class="card"><p class="muted">This period hasn’t started yet.</p></div>';
    return;
  }
  const c = P.data.current;
  const p = P.compare === 'previous' ? P.data.previous : P.data.last_year;
  const cmpLabel = P.compare === 'previous' ? `Previous (${p.days} days)` : 'Same period last year';
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
        <div class="card-head pad"><h3>Profit &amp; Loss statement</h3><span class="muted small">${esc(periodLabel(P.unit, c.from, c.to))}${P.unit !== 'custom' && range()[1] > today() ? ' (to date)' : ''}</span></div>
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
        <div class="card"><div class="card-head"><h3>Where each ${esc(P.ctxRef?.settings.currency || '₹')}100 of revenue went</h3></div>${waterfall(c)}</div>
        <div class="card"><div class="card-head"><h3>Key ratios</h3></div>
          <div class="figs">
            <span>Food cost % of net sales</span><b class="${c.food_cost_pct > BENCHMARKS.foodCostPct.high ? 'danger-text' : ''}">${c.food_cost_pct}%</b>
            <span>Gross margin</span><b>${c.gross_margin}%</b>
            <span>Expenses % of revenue</span><b>${c.total_revenue ? ((c.total_expenses / c.total_revenue) * 100).toFixed(1) : '—'}%</b>
            <span>Net margin</span><b class="${c.net_margin < 0 ? 'danger-text' : 'ok-text'}">${c.net_margin}%</b>
            <span>Discounts % of gross sales</span><b>${c.gross_sales ? ((c.discounts / c.gross_sales) * 100).toFixed(1) : '—'}%</b>
            <span>Revenue per day</span><b>${money0(c.total_revenue / c.days)}</b>
            <span>Profit per day</span><b>${money0(c.operating_profit / c.days)}</b>
          </div>
          <p class="note">Healthy restaurant benchmarks: food cost ${BENCHMARKS.foodCostPct.low}–${BENCHMARKS.foodCostPct.high}%, net margin ${BENCHMARKS.netMarginPct.low}–${BENCHMARKS.netMarginPct.high}%.</p>
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
