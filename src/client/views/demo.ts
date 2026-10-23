// Demo restaurant: a fully set-up sample restaurant the owner can open any time for reference.
import type { AppCtx } from '../core/types/app.js';
import { $, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { guard, toast } from '../ui/index.js';

const TOUR: [string, string, string][] = [
  ['dashboard', 'Dashboard', 'Daily sales, running tables, top dishes, low stock'],
  ['pos', 'Billing / POS', 'Take an order, send a KOT, print and settle a bill'],
  ['tables', 'Tables', 'Live floor plan with running and billed tables'],
  ['kds', 'Kitchen display', 'KOTs moving from new → preparing → ready'],
  ['menu', 'Menu', 'Categories, dishes, portions and recipes'],
  ['inventory', 'Inventory', 'Raw materials, stock levels and movements'],
  ['customers', 'Customers', 'Visits, spend, loyalty points'],
  ['expenses', 'Expenses', 'Day/week/month/year views and recurring bills'],
  ['pnl', 'Profit & Loss', 'A month’s statement and the year by month'],
  ['insights', 'Growth & insights', 'Forecast, break-even and suggestions'],
  ['reports', 'Reports', 'Sales, items, payment modes, staff'],
  ['settings', 'Settings', 'Branding, billing, floor, data & backups'],
];

export async function render(el: HTMLElement, _p: Record<string, string>, ctx: AppCtx) {
  el.innerHTML = `
    <div class="page">
      <div class="card narrow">
        <div class="card-head"><h3>Demo restaurant</h3>${ctx.demo ? '<span class="badge warn">You are in the demo</span>' : ''}</div>
        <p class="muted">A fully set-up sample restaurant with a menu, tables, stock, customers, staff and 30 days of sales.
          Open it in a separate tab whenever you want to see how a screen looks with real-looking data, or to try something
          before doing it for real. <b>Nothing done in the demo touches your restaurant</b>, and you can reset it any time.</p>
        ${ctx.demo ? '' : '<button class="btn primary" data-open="dashboard">Open the demo in a new tab</button>'}
      </div>
      <div class="card narrow">
        <div class="card-head"><h3>Jump straight to a screen in the demo</h3></div>
        <div class="tour-grid">
          ${TOUR.map(([id, title, desc]) => `<button class="tour-card" data-open="${id}"><b>${esc(title)}</b><small>${esc(desc)}</small></button>`).join('')}
        </div>
        <p class="note">The demo refreshes its sample data automatically every week so dates stay current.</p>
      </div>
    </div>`;
  $('.page', el).addEventListener(
    'click',
    guard(async (e: Event) => {
      const view = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open;
      if (!view) return;
      if (ctx.demo) {
        location.hash = `#/${view}`;
        return;
      }
      // Open the tab right away (inside the click) so pop-up blockers allow it, then point it at the demo
      const tab = window.open('about:blank', '_blank');
      const { token } = await api.post<{ token: string }>('/demo/open');
      const url = `${location.pathname}#/${view}?demo_token=${encodeURIComponent(token)}`;
      if (tab) tab.location.href = url;
      else toast('Allow pop-ups for this site to open the demo in a new tab', 'info');
    }),
  );
}
