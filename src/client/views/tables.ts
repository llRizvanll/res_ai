import type { AppCtx } from '../core/types/app.js';
import type { FloorData } from '../core/types/floor.js';
import { $, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { elapsed, label, minutesSince, money, ORDER_TYPE_LABELS } from '../core/format.js';
import { UI_CONFIG } from '../config.js';
import { emptyState } from '../ui/index.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let areaFilter: number | 'all' = 'all';

export async function render(el: HTMLElement, _params: Record<string, string>, ctx: AppCtx) {
  el.innerHTML = `<div class="page" id="floor"></div>`;
  root = $('#floor', el);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-area]');
    if (b) {
      areaFilter = b.dataset.area === 'all' ? 'all' : Number(b.dataset.area);
      load(ctx);
    }
  });
  await load(ctx);
  const t = window.setInterval(() => load(ctx), UI_CONFIG.timing.tablesRefreshMs);
  return () => clearInterval(t);
}

export function onEvent(type: string) {
  if (root?.isConnected && (type === 'tables' || type === 'orders')) load();
}

async function load(_ctx?: AppCtx) {
  if (!root) return;
  const f = await api.get<FloorData>('/tables');
  const occupied = f.tables.filter((t) => t.order_id);
  const running = occupied.reduce((a, t) => a + (t.total || 0), 0) + f.open.reduce((a, o) => a + o.total, 0);

  const areas = f.areas.filter((a) => areaFilter === 'all' || a.id === areaFilter);
  root.innerHTML = `
    <div class="page-head">
      <div class="stats-inline">
        <span><b>${f.tables.length - occupied.length}</b> free</span>
        <span><b>${occupied.length}</b> occupied</span>
        <span><b>${f.open.length}</b> takeaway / delivery</span>
        <span>Running value <b>${money(running)}</b></span>
      </div>
      <div class="actions">
        <a class="btn" href="#/pos?type=takeaway">+ Takeaway</a>
        <a class="btn" href="#/pos?type=delivery">+ Delivery</a>
      </div>
    </div>
    <div class="toolbar">
      <div class="seg">
        <button data-area="all" class="${areaFilter === 'all' ? 'on' : ''}">All areas</button>
        ${f.areas.map((a) => `<button data-area="${a.id}" class="${areaFilter === a.id ? 'on' : ''}">${esc(a.name)}</button>`).join('')}
      </div>
      <div class="legend"><span class="lg free"></span>Free <span class="lg busy"></span>Running <span class="lg billed"></span>Bill printed <span class="lg late"></span>Over 60 min</div>
    </div>
    ${areas
      .map((a) => {
        const tables = f.tables.filter((t) => t.area_id === a.id);
        return `<section class="area"><h3>${esc(a.name)} <small>${tables.length} tables</small></h3>
          <div class="table-grid">${
            tables
              .map((t) => {
                const late = t.order_time && minutesSince(t.order_time) > UI_CONFIG.tableOverdueMin;
                const cls = !t.order_id ? 'free' : t.bill_printed ? 'billed' : late ? 'busy late' : 'busy';
                return `<a class="table-card ${cls}" href="#/pos?table=${t.id}">
                  <div class="tc-top"><b>${esc(t.name)}</b><small>${t.seats} seats</small></div>
                  ${t.order_id
                    ? `<div class="tc-amt">${money(t.total)}</div>
                       <div class="tc-meta"><span>⏱ ${elapsed(t.order_time!)}</span><span>${t.item_count} items</span>${t.guests ? `<span>👥 ${t.guests}</span>` : ''}</div>
                       ${t.bill_printed ? '<div class="tc-flag">Bill printed</div>' : ''}`
                    : '<div class="tc-free">Available</div>'}
                </a>`;
              })
              .join('') || emptyState('No tables in this area')
          }</div></section>`;
      })
      .join('')}
    <section class="area"><h3>Takeaway &amp; Delivery <small>${f.open.length} running</small></h3>
      <div class="table-grid">${
        f.open
          .map(
            (o) => `<a class="table-card busy ${o.bill_printed ? 'billed' : ''}" href="#/pos?order=${o.id}">
              <div class="tc-top"><b>${esc(label(ORDER_TYPE_LABELS, o.type))}</b><small>${esc(o.order_no)}</small></div>
              <div class="tc-amt">${money(o.total)}</div>
              <div class="tc-meta"><span>⏱ ${elapsed(o.created_at)}</span><span>${o.item_count} items</span></div>
              ${o.customer_name ? `<div class="tc-flag">${esc(o.customer_name)}</div>` : ''}
            </a>`,
          )
          .join('') || '<div class="muted small">No running takeaway or delivery orders.</div>'
      }</div></section>`;
}
