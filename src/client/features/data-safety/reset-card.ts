// Cards: demo notice, start fresh, and clear selected data.
import { $, $$ } from '../../core/dom.js';
import type { Card } from './card.js';
import { SCOPES } from './scopes.js';
import { confirmReset } from './dialogs.js';

export const resetCard: Card = {
  render: ({ summary: s }) => `    ${s.demo ? `<div class="card banner"><div><b>You're looking at demo data.</b><p class="muted">Explore everything freely. When you're ready to run your own restaurant, start fresh — the demo is saved as a backup you can restore any time.</p></div>
      <button class="btn primary" data-d="fresh">Start fresh with my restaurant</button></div>` : ''}

    <div class="card narrow">
      <div class="card-head"><h3>Start fresh</h3></div>
      <p class="muted">Erase <b>everything</b> — orders, menu, tables, inventory, customers, staff, settings and branding — and keep only your own login. Then the <a class="link" href="#/setup">Getting started</a> guide walks you through setting up your restaurant.</p>
      <button class="btn danger" data-d="fresh">Erase everything and start fresh</button>
    </div>

    <div class="card narrow">
      <div class="card-head"><h3>Clear selected data</h3><span class="muted small">Pick only what you want to remove</span></div>
      ${s.open_orders ? `<div class="order-note">${s.open_orders} running order(s) right now. Clearing the menu or tables needs “Orders & sales” cleared too, or those orders settled first.</div>` : ''}
      <div class="scope-list">
        ${SCOPES.map((x) => `<label class="scope-row"><input type="checkbox" value="${x.id}"><span><b>${x.label}</b><small>${x.desc}</small></span><em>${x.n(s)}</em></label>`).join('')}
      </div>
      <div class="form-actions"><button class="btn danger" data-d="selected" disabled>Clear selected</button></div>
    </div>`,
  wire: ({ body }) => {
    const boxes = $$<HTMLInputElement>('.scope-list input', body);
    const clearBtn = $<HTMLButtonElement>('[data-d=selected]', body);
    boxes.forEach((b) => b.addEventListener('change', () => (clearBtn.disabled = !boxes.some((x) => x.checked))));
  },
  actions: {
    fresh: (_b, c) => confirmReset({ everything: true }, c.data.summary, () => (location.hash = '#/setup')),
    selected: (_b, c) => {
      const scopes = $$<HTMLInputElement>('.scope-list input', c.body).filter((x) => x.checked).map((x) => x.value);
      return confirmReset({ scopes }, c.data.summary, () => void c.repaint());
    },
  },
};
