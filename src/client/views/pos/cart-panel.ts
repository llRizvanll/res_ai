// Right side of the POS: order type, table/guests, customer, sent & new lines, totals and action buttons.
import type { OrderItem } from '../../core/types/orders.js';
import { $, esc } from '../../core/dom.js';
import { money, ORDER_TYPE_LABELS, qtyFmt } from '../../core/format.js';
import { emptyState, vegDot } from '../../ui/index.js';
import { canFront, S } from './state.js';
import type { OrderType } from '../../../shared/domain.js';
import { computeTotals } from '../../../shared/calc.js';

export function renderCart() {
  const o = S.order;
  const sent: OrderItem[] = o ? o.items : [];
  const t = computeTotals(
    [...sent, ...S.cart],
    { type: S.type, discount_type: S.discount_type, discount_value: S.discount_value },
    S.ctx.settings,
  );
  const halfTax = t.tax / 2;

  const tablesHTML = S.floor.areas
    .map((a) => {
      const opts = S.floor.tables
        .filter((tb) => tb.area_id === a.id)
        .map((tb) => {
          const busy = tb.order_id && tb.order_id !== o?.id;
          return `<option value="${tb.id}" ${tb.id === S.table_id ? 'selected' : ''}>${esc(tb.name)} · ${tb.seats} seats${busy ? ' • running' : ''}</option>`;
        })
        .join('');
      return `<optgroup label="${esc(a.name)}">${opts}</optgroup>`;
    })
    .join('');

  const kotGroups = new Map<number, OrderItem[]>();
  for (const i of sent) {
    const k = i.kot_no ?? 0;
    if (!kotGroups.has(k)) kotGroups.set(k, []);
    kotGroups.get(k)!.push(i);
  }

  const sentHTML = [...kotGroups.entries()]
    .map(
      ([kotNo, items]) => `<div class="kot-group"><div class="kot-label">KOT #${kotNo} <span class="kot-st ${esc(items[0]!.kot_status || '')}">${esc(items[0]!.kot_status || '')}</span></div>
      ${items
        .map(
          (i) => `<div class="line sent ${i.cancelled ? 'void' : ''}">
            <div class="line-main"><div class="line-name">${esc(i.name)}${i.variant ? ` <small>(${esc(i.variant)})</small>` : ''}</div>
              ${i.notes ? `<div class="line-note">» ${esc(i.notes)}</div>` : ''}
              ${i.cancelled ? `<div class="line-note">Voided${i.cancel_reason ? `: ${esc(i.cancel_reason)}` : ''}</div>` : ''}</div>
            <div class="line-qty">${qtyFmt(i.qty)} × ${money(i.price)}</div>
            <div class="line-amt">${money(i.qty * i.price)}</div>
            ${canFront() && !i.cancelled ? `<button class="icon-btn sm" data-void="${i.id}" title="Void item">✕</button>` : '<span class="icon-sp"></span>'}
          </div>`,
        )
        .join('')}</div>`,
    )
    .join('');

  const newHTML = S.cart.length
    ? `<div class="kot-group new"><div class="kot-label">New items (not sent)</div>${S.cart
        .map(
          (l, idx) => `<div class="line">
            <div class="line-main"><div class="line-name">${vegDot(l.veg)} ${esc(l.name)}${l.variant ? ` <small>(${esc(l.variant)})</small>` : ''}</div>
              <button class="link sm" data-note="${idx}">${l.notes ? `» ${esc(l.notes)}` : '+ note'}</button></div>
            <div class="stepper"><button data-dec="${idx}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-inc="${idx}" aria-label="Increase">+</button></div>
            <div class="line-amt">${money(l.qty * l.price)}</div>
            <button class="icon-btn sm" data-remove="${idx}" title="Remove">✕</button>
          </div>`,
        )
        .join('')}</div>`
    : '';

  const hasItems = sent.some((i) => !i.cancelled) || S.cart.length > 0;
  $('#pos-cart', S.root).innerHTML = `
    <div class="cart-head">
      <div class="seg type-seg">
        ${(['dine_in', 'takeaway', 'delivery'] as OrderType[])
          .map((ty) => `<button data-type="${ty}" class="${S.type === ty ? 'on' : ''}" ${o ? 'disabled' : ''}>${ORDER_TYPE_LABELS[ty]}</button>`)
          .join('')}
      </div>
      ${o ? `<div class="order-tag"><b>${esc(o.order_no)}</b>${o.bill_printed ? '<span class="badge info">Bill printed</span>' : '<span class="badge warn">Running</span>'}</div>` : '<div class="order-tag muted">New order</div>'}
    </div>
    <div class="cart-ctx">
      ${S.type === 'dine_in'
        ? `<div class="ctx-row"><label>Table<select id="pos-table" ${o ? 'disabled' : ''}><option value="">Select table…</option>${tablesHTML}</select></label>
           <label class="guests">Guests<input id="pos-guests" type="number" min="1" max="99" value="${S.guests || ''}"></label></div>`
        : ''}
      ${S.type === 'delivery' ? `<label class="block">Delivery address<textarea id="pos-address" rows="2" placeholder="House no, street, landmark">${esc(S.delivery_address)}</textarea></label>` : ''}
      <button class="customer-btn" data-act="customer">
        ${S.customer ? `<span class="avatar sm">${esc(S.customer.name.charAt(0))}</span><span><b>${esc(S.customer.name)}</b><small>${esc(S.customer.phone)} · ${Math.round(S.customer.points || 0)} pts</small></span>` : '<span class="avatar sm ghost">+</span><span>Add customer <small>for loyalty &amp; CRM</small></span>'}
      </button>
      ${S.notes ? `<div class="order-note">Note: ${esc(S.notes)}</div>` : ''}
    </div>
    <div class="cart-lines">${sentHTML}${newHTML}${hasItems ? '' : emptyState('No items yet', 'Tap a dish on the left to add it')}</div>
    <div class="cart-totals">
      <div><span>Sub total</span><span>${money(t.subtotal)}</span></div>
      ${t.discount ? `<div class="disc"><span>Discount${S.discount_type === 'percent' ? ` (${S.discount_value}%)` : ''}</span><span>− ${money(t.discount)}</span></div>` : ''}
      ${t.tax ? `<div><span>CGST + SGST</span><span>${money(halfTax)} + ${money(halfTax)}</span></div>` : ''}
      ${t.service_charge ? `<div><span>Service charge</span><span>${money(t.service_charge)}</span></div>` : ''}
      ${t.packaging ? `<div><span>Packaging</span><span>${money(t.packaging)}</span></div>` : ''}
      ${t.round_off ? `<div class="muted"><span>Round off</span><span>${money(t.round_off)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
    </div>
    <div class="cart-actions">
      <div class="mini-actions">
        ${canFront() ? `<button class="btn ghost sm" data-act="discount">％ Discount</button>` : ''}
        <button class="btn ghost sm" data-act="notes">✎ Note</button>
        ${o && S.type === 'dine_in' ? `<button class="btn ghost sm" data-act="move">⇄ Move</button>` : ''}
        ${o && canFront() ? `<button class="btn ghost sm danger-text" data-act="cancel">Cancel order</button>` : ''}
        ${!o && S.cart.length ? `<button class="btn ghost sm danger-text" data-act="clear">Clear</button>` : ''}
      </div>
      <div class="main-actions">
        <button class="btn" data-act="kot" ${S.cart.length ? '' : 'disabled'}>Save &amp; KOT</button>
        <button class="btn" data-act="kot-print" ${S.cart.length ? '' : 'disabled'}>KOT &amp; Print</button>
        <button class="btn info" data-act="bill" ${hasItems ? '' : 'disabled'}>Print Bill</button>
        ${canFront() ? `<button class="btn primary" data-act="settle" ${hasItems ? '' : 'disabled'}>Settle ${money(t.total)}</button>` : ''}
      </div>
    </div>`;
}
