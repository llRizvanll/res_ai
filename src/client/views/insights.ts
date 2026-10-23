import { api } from '../api.js';
import { $, esc, money0, barChart, lineChart, deltaBadge, emptyState, label, ORDER_TYPES, fmtDate } from '../ui.js';
import type { AppCtx } from '../types.js';

interface Point {
  day: string;
  value: number;
  low: number;
  high: number;
}
interface Insights {
  today: string;
  kpis: Record<string, number | null>;
  history: { day: string; sales: number; orders: number; expenses: number }[];
  forecast: { points: Point[]; daily_trend: number; monthly_trend_pct: number; weekday_index: { day: string; index: number }[]; based_on_days: number } | null;
  month_end: Record<string, number | string>;
  break_even: { fixed_monthly: number; recurring_monthly: number; variable_daily: number; contribution_pct: number; monthly: number; daily: number; current_daily: number; safety_margin_pct: number | null };
  outlook: { month: string; sales: number; revenue: number; expenses: number; profit: number; partial: boolean }[];
  months: { month: string; sales: number; revenue: number; expenses: number; cogs: number; profit: number; orders: number }[];
  weekdays: { day: string; avg_sales: number }[];
  hours: { hour: number; orders: number; sales: number }[];
  rising: { name: string; now: number; before: number; change: number }[];
  falling: { name: string; now: number; before: number; change: number }[];
  channels: { type: string; now: number; before: number; change: number | null }[];
  advice: { tone: string; text: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const shortDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
let root: HTMLElement = document.createElement('div');

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = '<div class="page" id="ins"></div>';
  root = $('#ins', el);
  const d = await api.get<Insights>('/insights');
  const k = d.kpis;
  const me = d.month_end;
  const be = d.break_even;
  const f = d.forecast;

  // Actual (last 60 days) + forecast (next 90) on one timeline
  // Start the chart at the first day with sales (a new restaurant has nothing before that)
  const first = d.history.findIndex((h) => h.sales > 0);
  const history = first > 0 ? d.history.slice(first) : d.history;
  const labels = [...history.map((h) => h.day), ...(f ? f.points.map((p) => p.day) : [])];
  const nH = history.length;
  const pad = (n: number) => Array<null>(n).fill(null);
  const next30 = f ? f.points.slice(0, 30) : [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const beRatio = be.daily ? Math.min(2, be.current_daily / be.daily) : 0;
  const peakHour = [...d.hours].sort((a, b) => b.sales - a.sales)[0];

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><small>Sales · last 30 days</small><b>${money0(k.sales_30d)}</b><span>${deltaBadge(k.growth_30d)} vs previous 30 days</span></div>
      <div class="kpi"><small>Orders · last 30 days</small><b>${k.orders_30d}</b><span>${deltaBadge(k.orders_growth_30d)}</span></div>
      <div class="kpi"><small>Average bill</small><b>${money0(k.aov_30d)}</b><span>${deltaBadge(k.aov_growth)}</span></div>
      <div class="kpi"><small>This month so far</small><b>${money0(k.mtd_sales)}</b><span>${deltaBadge(k.mtd_vs_last_month)} vs same days last month</span></div>
      <div class="kpi ${Number(k.profit_margin_90d) < 0 ? 'danger' : 'ok'}"><small>Profit margin · 90 days</small><b>${k.profit_margin_90d}%</b><span>food cost ${k.food_cost_pct}% of sales</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Sales forecast — next 90 days</h3>
        ${f ? `<span class="muted small">Trend ${f.monthly_trend_pct >= 0 ? '+' : ''}${f.monthly_trend_pct}% a month · based on ${f.based_on_days} days of sales</span>` : ''}</div>
      ${f
        ? `${lineChart(labels.map(shortDay), [
            { name: 'Actual sales', color: 'var(--brand)', values: [...history.map((h) => h.sales), ...pad(f.points.length)] },
            { name: 'Forecast (shaded: likely range)', color: 'var(--info)', dashed: true, values: [...pad(nH), ...f.points.map((p) => p.value)],
              band: { low: [...pad(nH), ...f.points.map((p) => p.low)], high: [...pad(nH), ...f.points.map((p) => p.high)] } },
          ], { height: 260 })}
          <div class="figs mt" style="max-width:520px">
            <span>Expected sales in the next 30 days</span><b class="hl">${money0(sum(next30.map((p) => p.value)))}</b>
            <span>Likely range (80%)</span><b>${money0(sum(next30.map((p) => p.low)))} – ${money0(sum(next30.map((p) => p.high)))}</b>
          </div>`
        : emptyState('Not enough history yet', 'Forecasts start after 2 weeks of sales')}
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>This month — projected</h3><span class="muted small">${me.days_left} days left</span></div>
        <div class="figs">
          <span>Sales so far</span><b>${money0(Number(me.mtd_sales))}</b>
          <span>Projected month-end sales</span><b class="hl">${money0(Number(me.projected_sales))}</b>
          <span>Last month (full)</span><b>${money0(Number(me.last_month_sales))} ${me.last_month_comparable ? deltaBadge(Number(me.last_month_sales) ? ((Number(me.projected_sales) - Number(me.last_month_sales)) / Number(me.last_month_sales)) * 100 : null) : '<small class="muted">(too little history to compare)</small>'}</b>
          <span>Projected revenue (excl. GST)</span><b>${money0(Number(me.projected_revenue))}</b>
          <span>− Projected food cost</span><b>${money0(Number(me.projected_food_cost))}</b>
          <span>− Projected expenses <small class="muted">(incl. ${money0(Number(me.scheduled_expenses_left))} recurring still due)</small></span><b>${money0(Number(me.projected_expenses))}</b>
          <span><b>Projected profit</b></span><b class="${Number(me.projected_profit) < 0 ? 'danger-text' : 'ok-text'}">${money0(Number(me.projected_profit))}</b>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Break-even point</h3></div>
        <div class="figs">
          <span>Fixed costs per month <small class="muted">(recurring ${money0(be.recurring_monthly)} + other ~${money0(be.variable_daily)}/day)</small></span><b>${money0(be.fixed_monthly)}</b>
          <span>Kept from each sale after food cost</span><b>${be.contribution_pct}%</b>
          <span>Revenue needed to break even</span><b class="hl">${money0(be.monthly)}/month · ${money0(be.daily)}/day</b>
          <span>Your average daily revenue (30 days)</span><b>${money0(be.current_daily)}</b>
        </div>
        <div class="meter"><div class="${beRatio < 1 ? 'bad' : ''}" style="width:${(beRatio / 2) * 100}%"></div><span style="left:50%" title="Break-even"></span></div>
        <p class="note">${be.safety_margin_pct === null ? '' : be.safety_margin_pct >= 0 ? `You are <b>${be.safety_margin_pct}%</b> above break-even — sales could drop that much before you make a loss.` : `You are <b>${Math.abs(be.safety_margin_pct)}%</b> below break-even.`} The line marks break-even.</p>
      </div>
    </div>

    <div class="card"><div class="card-head"><h3>What the numbers suggest</h3></div>
      <div class="advice">${d.advice.map((a) => `<div class="${esc(a.tone)}">${esc(a.text)}</div>`).join('') || '<p class="muted">Not enough data for suggestions yet.</p>'}</div>
    </div>

    <div class="grid-2 wide-left">
      <div class="card"><div class="card-head"><h3>Last 12 months</h3></div>
        ${lineChart(d.months.map((m) => monthName(m.month)), [
          { name: 'Revenue', color: 'var(--brand)', values: d.months.map((m) => m.revenue) },
          { name: 'Expenses', color: 'var(--info)', values: d.months.map((m) => m.expenses) },
          { name: 'Net profit', color: 'var(--ok)', values: d.months.map((m) => m.profit) },
        ], { height: 220 })}
      </div>
      <div class="card flush"><div class="card-head pad"><h3>Next 3 months outlook</h3></div>
        <table class="table compact"><thead><tr><th>Month</th><th class="num">Sales</th><th class="num">Expenses</th><th class="num">Profit</th></tr></thead><tbody>
          ${d.outlook.map((o) => `<tr><td>${monthName(o.month)}${o.partial ? ' <small class="muted">*</small>' : ''}</td><td class="num">${money0(o.sales)}</td><td class="num">${money0(o.expenses)}</td><td class="num ${o.profit < 0 ? 'danger-text' : 'ok-text'}"><b>${money0(o.profit)}</b></td></tr>`).join('')}
        </tbody></table>
        <p class="note pad">Estimates from your recent trend, weekly pattern, food-cost ratio and recurring expenses.${d.outlook.some((o) => o.partial) ? ' * partly beyond the 90-day forecast.' : ''}</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Average sales by weekday</h3><span class="muted small">last 90 days</span></div>
        ${barChart(d.weekdays.map((w) => ({ label: w.day.slice(0, 3), value: w.avg_sales })), { height: 190 })}</div>
      <div class="card"><div class="card-head"><h3>Busiest hours</h3><span class="muted small">last 30 days${peakHour ? ` · peak ${peakHour.hour}:00` : ''}</span></div>
        ${barChart(d.hours.map((h) => ({ label: `${h.hour % 12 || 12}${h.hour < 12 ? 'a' : 'p'}`, value: h.sales, tip: `${h.hour}:00 — ${h.orders} orders, ${money0(h.sales)}` })), { height: 190 })}</div>
    </div>

    <div class="grid-3">
      <div class="card"><div class="card-head"><h3>Rising dishes</h3><span class="muted small">30 days vs previous 30</span></div>
        ${d.rising.length ? `<table class="table compact"><tbody>${d.rising.map((r) => `<tr><td>${esc(r.name)}</td><td class="num muted">${r.before} → ${r.now}</td><td class="num">${deltaBadge(r.change)}</td></tr>`).join('')}</tbody></table>` : emptyState('No clear risers yet')}
      </div>
      <div class="card"><div class="card-head"><h3>Falling dishes</h3><span class="muted small">30 days vs previous 30</span></div>
        ${d.falling.length ? `<table class="table compact"><tbody>${d.falling.map((r) => `<tr><td>${esc(r.name)}</td><td class="num muted">${r.before} → ${r.now}</td><td class="num">${deltaBadge(r.change)}</td></tr>`).join('')}</tbody></table>` : emptyState('Nothing declining')}
      </div>
      <div class="card"><div class="card-head"><h3>Channels & customers</h3></div>
        <table class="table compact"><tbody>
          ${d.channels.map((c) => `<tr><td>${esc(label(ORDER_TYPES, c.type))}</td><td class="num">${money0(c.now)}</td><td class="num">${deltaBadge(c.change)}</td></tr>`).join('')}
        </tbody></table>
        <div class="figs mt">
          <span>Bills with a customer attached</span><b>${k.tagged_share ?? '—'}%</b>
          <span>Known customers who came back</span><b>${k.repeat_rate ?? '—'}%</b>
          <span>New customers this month</span><b>${k.new_customers_mtd}</b>
        </div>
      </div>
    </div>
    <p class="note">Projections are estimates based on your own past sales and expenses up to ${fmtDate(d.today)} — not a guarantee. They get more accurate with more history and when menu items have recipes.</p>`;
}
