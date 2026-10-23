import { api } from '../api.js';
import { printInvoice } from '../print.js';
import {
  $, esc, money, fmtDateTime, today, label, ORDER_TYPES, PAY_MODES, statusBadge, modal, toast, guard, promptDialog, confirmDialog, downloadCSV, emptyState, qtyFmt,
} from '../ui.js';
import type { AppCtx, Order, OrderRow } from '../types.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
const f = { from: today(), to: today(), status: '', type: '', q: '' };
let rows: OrderRow[] = [];

export async function render(el: HTMLElement, params: Record<string, string>, c: AppCtx) {
  ctx = c;
  el.innerHTML = `
    <div class="page">
      <div class="toolbar wrap">
        <label>From <input type="date" id="o-from" value="${f.from}"></label>
        <label>To <input type="date" id="o-to" value="${f.to}"></label>
        <select id="o-status"><option value="">All statuses</option><option value="open">Running</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        <select id="o-type"><option value="">All types</option>${Object.entries(ORDER_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input type="search" id="o-q" placeholder="Order no, customer, phone, table…" value="${esc(f.q)}">
        <button class="btn ghost" id="o-csv">⇩ Export CSV</button>
      </div>
      <div id="o-summary" class="stats-inline"></div>
      <div class="card flush"><div id="o-table"></div></div>
    </div>`;
  root = $('.page', el);
  ($('#o-status', root) as HTMLSelectElement).value = f.status;
  ($('#o-type', root) as HTMLSelectElement).value = f.type;
  const bind = (id: string, key: keyof typeof f, ev = 'change') =>
    $(id, root!).addEventListener(ev, (e) => {
      f[key] = (e.target as HTMLInputElement).value;
      load();
    });
  bind('#o-from', 'from');
  bind('#o-to', 'to');
  bind('#o-status', 'status');
  bind('#o-type', 'type');
  bind('#o-q', 'q', 'input');
  $('#o-csv', root).addEventListener('click', () =>
    downloadCSV(`orders-${f.from}-to-${f.to}.csv`, [
      ['Order', 'Date', 'Type', 'Table', 'Customer', 'Phone', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Payment', 'Status', 'Staff'],
      ...rows.map((o) => [o.order_no, o.created_at, label(ORDER_TYPES, o.type), o.table_name, o.customer_name, o.customer_phone, o.item_count, o.subtotal, o.discount, o.tax, o.total, o.payment_mode, o.status, o.created_by_name]),
    ]),
  );
  root.addEventListener('click', (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (tr) openOrder(Number(tr.dataset.id));
  });
  await load();
  if (params.id) openOrder(Number(params.id));
}

export function onEvent(type: string) {
  if (root?.isConnected && type === 'orders') load();
}

async function load() {
  if (!root) return;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  rows = await api.get<OrderRow[]>('/orders?' + qs);
  const done = rows.filter((r) => r.status === 'completed');
  $('#o-summary', root).innerHTML = `<span><b>${rows.length}</b> orders</span><span><b>${done.length}</b> completed</span>
    <span>Sales <b>${money(done.reduce((a, r) => a + r.total, 0))}</b></span><span><b>${rows.filter((r) => r.status === 'cancelled').length}</b> cancelled</span>`;
  $('#o-table', root).innerHTML = rows.length
    ? `<table class="table"><thead><tr><th>Order</th><th>Date &amp; time</th><th>Type</th><th>Table</th><th>Customer</th><th class="num">Items</th><th>Payment</th><th>Status</th><th class="num">Total</th></tr></thead>
      <tbody>${rows
        .map(
          (o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.order_no)}</b></td><td>${fmtDateTime(o.created_at)}</td><td>${esc(label(ORDER_TYPES, o.type))}</td>
          <td>${esc(o.table_name || '—')}</td><td>${esc(o.customer_name || '—')}<div class="muted small">${esc(o.customer_phone || '')}</div></td>
          <td class="num">${o.item_count}</td><td>${esc(label(PAY_MODES, o.payment_mode))}</td><td>${statusBadge(o.status)}</td><td class="num"><b>${money(o.total)}</b></td></tr>`,
        )
        .join('')}</tbody></table>`
    : emptyState('No orders match these filters');
}

async function openOrder(id: number) {
  const o = await api.get<Order>('/orders/' + id);
  const canFront = ctx.can(['admin', 'manager', 'cashier']);
  const m = modal({
    title: `Order ${o.order_no}`,
    size: 'lg',
    body: `
      <div class="detail-grid">
        <div><small>Status</small>${statusBadge(o.status)}</div>
        <div><small>Type</small><b>${esc(label(ORDER_TYPES, o.type))}${o.table_name ? ` · ${esc(o.table_name)}` : ''}</b></div>
        <div><small>Created</small><b>${fmtDateTime(o.created_at)}</b><span class="muted small">${esc(o.created_by_name || '')}</span></div>
        <div><small>Closed</small><b>${fmtDateTime(o.closed_at)}</b><span class="muted small">${esc(o.settled_by_name || '')}</span></div>
        <div><small>Customer</small><b>${esc(o.customer_name || '—')}</b><span class="muted small">${esc(o.customer_phone || '')}</span></div>
        <div><small>Payment</small><b>${o.payments.length ? o.payments.map((p) => `${esc(label(PAY_MODES, p.mode))} ${money(p.amount)}`).join(' + ') : '—'}</b></div>
      </div>
      ${o.cancel_reason ? `<div class="alert">Cancelled: ${esc(o.cancel_reason)}</div>` : ''}
      ${o.notes ? `<div class="order-note">Note: ${esc(o.notes)}</div>` : ''}
      ${o.delivery_address ? `<div class="order-note">Deliver to: ${esc(o.delivery_address)}</div>` : ''}
      <table class="table compact"><thead><tr><th>Item</th><th>KOT</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${o.items
        .map(
          (i) => `<tr class="${i.cancelled ? 'void' : ''}"><td>${esc(i.name)}${i.variant ? ` <small>(${esc(i.variant)})</small>` : ''}${i.notes ? `<div class="muted small">» ${esc(i.notes)}</div>` : ''}${i.cancelled ? `<div class="danger-text small">Voided ${esc(i.cancel_reason || '')}</div>` : ''}</td>
          <td>${i.kot_no ? '#' + i.kot_no : '—'}</td><td class="num">${qtyFmt(i.qty)}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.qty * i.price)}</td></tr>`,
        )
        .join('')}</tbody></table>
      <div class="totals-box">
        <div><span>Sub total</span><span>${money(o.subtotal)}</span></div>
        ${o.discount ? `<div><span>Discount</span><span>− ${money(o.discount)}</span></div>` : ''}
        <div><span>Tax (GST)</span><span>${money(o.tax)}</span></div>
        ${o.service_charge ? `<div><span>Service charge</span><span>${money(o.service_charge)}</span></div>` : ''}
        ${o.packaging ? `<div><span>Packaging</span><span>${money(o.packaging)}</span></div>` : ''}
        ${o.round_off ? `<div><span>Round off</span><span>${money(o.round_off)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
      </div>`,
    footer: `
      ${ctx.can(['admin']) ? '<button class="btn ghost danger-text" data-a="delete">Delete permanently</button>' : ''}
      ${o.status === 'open' && canFront ? '<button class="btn ghost danger-text" data-a="cancel">Cancel order</button>' : ''}
      <span class="grow"></span>
      ${o.status !== 'cancelled' ? '<button class="btn" data-a="print">⎙ Print bill</button>' : ''}
      ${o.status === 'open' ? `<a class="btn primary" href="#/pos?order=${o.id}">Open in POS</a>` : ''}`,
  });
  m.el.querySelector('[data-a=print]')?.addEventListener('click', () => printInvoice(o, ctx.settings));
  m.el.querySelector('a.btn')?.addEventListener('click', () => m.close());
  m.el.querySelector('[data-a=delete]')?.addEventListener(
    'click',
    guard(async () => {
      const msg = `Delete ${o.order_no} permanently? It disappears from all reports${o.status === 'completed' ? ', stock used by it is added back and the customer’s totals are reduced' : ''}. This cannot be undone.`;
      if (!(await confirmDialog(msg, { okLabel: 'Delete order', danger: true }))) return;
      await api.del('/orders/' + o.id);
      toast('Order deleted');
      m.close();
      load();
    }),
  );
  m.el.querySelector('[data-a=cancel]')?.addEventListener(
    'click',
    guard(async () => {
      const reason = await promptDialog('Cancel order', 'Reason', { chips: ['Customer left', 'Wrong order', 'Duplicate order'] });
      if (!reason) return;
      await api.post(`/orders/${o.id}/cancel`, { reason });
      toast('Order cancelled');
      m.close();
      load();
    }),
  );
}
