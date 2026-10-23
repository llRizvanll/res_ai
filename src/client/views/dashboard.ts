import { api, download } from '../api.js';
import { $, esc, money, money0, barChart, hbars, addDays, today, fmtTime, label, ORDER_TYPES, PAY_MODES, statusBadge, qtyFmt, emptyState, toast } from '../ui.js';
import { STEPS, type SetupStatus } from './setup.js';
import type { Health } from './data-tools.js';
import type { AppCtx, InventoryItem, Reservation } from '../types.js';

interface Dash {
  today: { orders: number; sales: number; guests: number };
  yesterday: { orders: number; sales: number; guests: number };
  running: { n: number; value: number };
  tables: { total: number; occupied: number };
  kots: number;
  last7: { day: string; sales: number; orders: number }[];
  topItems: { name: string; qty: number; amount: number }[];
  payments: { mode: string; amount: number }[];
  byType: { type: string; orders: number; sales: number }[];
  lowStock: InventoryItem[];
  reservations: Reservation[];
  recent: { id: number; order_no: string; type: string; status: string; total: number; created_at: string; table_name: string | null }[];
}

let dashCtx: AppCtx | null = null;
interface Reminder {
  closing_time: string;
  closing: { name: string; created: string } | null;
  downloaded: { at: string; user_name: string } | null;
}
let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then

export async function render(el: HTMLElement, _p: Record<string, string>, ctx: AppCtx) {
  el.innerHTML = '<div class="page" id="dash"></div>';
  root = $('#dash', el);
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-dl-closing]');
    if (!b) return;
    try {
      await download('/admin/backups/' + encodeURIComponent(b.dataset.dlClosing!), b.dataset.dlClosing!);
      toast('Backup downloaded — keep it somewhere safe');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
  await load(ctx);
}

export function onEvent(type: string) {
  if (root?.isConnected && (type === 'orders' || type === 'tables')) load();
}

async function load(ctx?: AppCtx) {
  if (!root) return;
  const d = await api.get<Dash>('/dashboard');
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const series = days.map((day) => {
    const r = d.last7.find((x) => x.day === day);
    const dt = new Date(day + 'T00:00:00');
    return { label: dt.toLocaleDateString('en-IN', { weekday: 'short' }), value: r?.sales || 0, tip: `${day}: ${money0(r?.sales || 0)} · ${r?.orders || 0} orders` };
  });
  const avg = d.today.orders ? d.today.sales / d.today.orders : 0;
  const delta = d.yesterday.sales ? ((d.today.sales - d.yesterday.sales) / d.yesterday.sales) * 100 : 0;
  const isMgr = ctx ? ctx.can(['admin', 'manager']) : true;
  if (ctx) dashCtx = ctx;
  const isAdmin = !!dashCtx?.can(['admin']);
  const [setup, health, reminder] = isAdmin
    ? await Promise.all([
        api.get<SetupStatus>('/admin/setup').catch(() => null),
        api.get<Health>('/admin/health').catch(() => null),
        api.get<Reminder>('/admin/backup-reminder').catch(() => null),
      ])
    : [null, null, null];
  const closingBanner =
    reminder?.closing && !reminder.downloaded
      ? `<div class="card banner"><div><b>Today’s closing backup is ready</b><p class="muted">Saved at ${fmtTime(reminder.closing.created)}. Download it and keep it off this computer (phone, USB drive or email).</p></div>
         <button class="btn primary" data-dl-closing="${esc(reminder.closing.name)}">⇩ Download today’s backup</button></div>`
      : '';
  const safety = health?.warnings.length
    ? `<div class="card banner danger-banner"><div><b>Data safety needs attention</b>${health.warnings.map((w) => `<p class="muted">${esc(w)}</p>`).join('')}</div>
       <a class="btn" href="#/settings?tab=data">Open Data safety</a></div>`
    : '';
  const required = STEPS.filter((x) => !x.optional);
  const doneSteps = setup ? required.filter((x) => setup.steps[x.key]).length : required.length;
  const banner = !setup
    ? ''
    : setup.demo
      ? `<div class="card banner"><div><b>You're exploring demo data.</b><p class="muted">Try billing, tables, kitchen and reports freely. When you're ready, erase the demo and set up your own restaurant.</p></div>
         <div class="actions"><a class="btn" href="#/setup">Setup guide</a><a class="btn primary" href="#/settings?tab=data">Start fresh</a></div></div>`
      : doneSteps < required.length
        ? `<div class="card banner"><div><b>Finish setting up your restaurant</b><p class="muted">${doneSteps} of ${required.length} steps done.</p><div class="progress"><div style="width:${(doneSteps / required.length) * 100}%"></div></div></div>
           <a class="btn primary" href="#/setup">Continue setup →</a></div>`
        : '';

  root.innerHTML = `${safety}${closingBanner}${banner}
    <div class="kpis">
      <div class="kpi accent"><small>Today's sales</small><b>${money0(d.today.sales)}</b>
        <span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs yesterday (${money0(d.yesterday.sales)})</span></div>
      <div class="kpi"><small>Orders settled</small><b>${d.today.orders}</b><span>Avg bill ${money0(avg)}</span></div>
      <div class="kpi"><small>Running orders</small><b>${d.running.n}</b><span>Value ${money0(d.running.value)}</span></div>
      <div class="kpi"><small>Tables occupied</small><b>${d.tables.occupied}/${d.tables.total}</b><span>${d.kots} KOTs in kitchen</span></div>
      <div class="kpi"><small>Guests served</small><b>${d.today.guests}</b><span>Dine-in covers today</span></div>
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Sales — last 7 days</h3>${isMgr ? '<a href="#/reports" class="link">Full reports →</a>' : ''}</div>${barChart(series, { height: 220 })}</div>
      <div class="card"><div class="card-head"><h3>Today by payment mode</h3></div>
        ${hbars(d.payments.map((p) => ({ label: label(PAY_MODES, p.mode), value: p.amount })))}
        <div class="card-head mt"><h3>Today by order type</h3></div>
        ${hbars(d.byType.map((t) => ({ label: `${label(ORDER_TYPES, t.type)} (${t.orders})`, value: t.sales })))}
      </div>
    </div>

    <div class="grid-3">
      <div class="card"><div class="card-head"><h3>Top items today</h3></div>
        ${d.topItems.length ? `<table class="table compact"><tbody>${d.topItems.map((i, n) => `<tr><td class="rank">${n + 1}</td><td>${esc(i.name)}</td><td class="num">${qtyFmt(i.qty)}</td><td class="num">${money0(i.amount)}</td></tr>`).join('')}</tbody></table>` : emptyState('No sales yet today')}
      </div>
      <div class="card"><div class="card-head"><h3>Low stock</h3>${isMgr ? '<a href="#/inventory" class="link">Inventory →</a>' : ''}</div>
        ${d.lowStock.length ? `<table class="table compact"><tbody>${d.lowStock.map((i) => `<tr><td>${esc(i.name)}</td><td class="num danger-text">${qtyFmt(i.stock)} ${esc(i.unit)}</td><td class="num muted">min ${qtyFmt(i.min_stock)}</td></tr>`).join('')}</tbody></table>` : emptyState('All stock levels healthy')}
      </div>
      <div class="card"><div class="card-head"><h3>Today's reservations</h3><a href="#/reservations" class="link">All →</a></div>
        ${d.reservations.length ? `<table class="table compact"><tbody>${d.reservations.map((r) => `<tr><td><b>${esc(r.time || '')}</b></td><td>${esc(r.name)}<div class="muted small">${r.guests} guests${r.table_name ? ` · ${esc(r.table_name)}` : ''}</div></td></tr>`).join('')}</tbody></table>` : emptyState('No bookings today')}
      </div>
    </div>

    <div class="card"><div class="card-head"><h3>Recent orders</h3><a href="#/orders" class="link">All orders →</a></div>
      <table class="table"><thead><tr><th>Order</th><th>Type</th><th>Table</th><th>Time</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${d.recent.map((o) => `<tr class="click" onclick="location.hash='#/orders?id=${o.id}'"><td><b>${esc(o.order_no)}</b></td><td>${esc(label(ORDER_TYPES, o.type))}</td><td>${esc(o.table_name || '—')}</td><td>${fmtTime(o.created_at)}</td><td>${statusBadge(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}</tbody></table>
    </div>`;
}
