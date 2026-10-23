// POS dialogs: settlement, discount, move table, customer lookup.
import type { Customer } from '../../core/types/people.js';
import type { FloorData } from '../../core/types/floor.js';
import type { Order } from '../../core/types/orders.js';
import { $$, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { label, money } from '../../core/format.js';
import { printInvoice } from '../../core/print.js';
import { S, setOrder } from './state.js';
import { UI_CONFIG } from '../../config.js';
import { afterClose } from './actions.js';
import { emptyState, guard, modal, toast } from '../../ui/index.js';
import { renderCart } from './cart-panel.js';

export function openSettle(o: Order) {
  const total = o.total;
  const m = modal({
    title: `Settle ${o.order_no}`,
    size: 'sm',
    body: `
      <div class="settle-total"><small>Amount payable</small><b>${money(total)}</b></div>
      <div class="pay-modes" id="pay-modes">
        ${['cash', 'upi', 'card', 'other', 'split'].map((p, i) => `<button class="pay-mode ${i === 0 ? 'on' : ''}" data-mode="${p}">${label({ cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other', split: 'Split' }, p)}</button>`).join('')}
      </div>
      <div id="pay-cash" class="field"><label>Cash received</label><input id="cash-in" type="number" min="0" step="1" value="${total}">
        <div class="quick-cash">${[...new Set([total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 2000) * 2000])]
          .map((v) => `<button type="button" class="chip" data-cash="${v}">${money(v)}</button>`)
          .join('')}</div>
        <div class="change" id="change">Change to return: <b>${money(0)}</b></div></div>
      <div id="pay-split" hidden>
        ${['cash', 'upi', 'card'].map((p) => `<div class="field inline"><label>${p.toUpperCase()}</label><input type="number" min="0" step="0.01" data-split="${p}" value="0"></div>`).join('')}
        <div class="change" id="split-left"></div>
      </div>
      <label class="check"><input type="checkbox" id="print-bill" ${o.bill_printed && S.ctx.settings.bill_auto_print !== '1' ? '' : 'checked'}> Print bill after settling</label>
      <p class="muted small">Payment is recorded only — no card/UPI gateway is charged.</p>`,
    footer: `<button class="btn ghost" data-close>Back</button><button class="btn primary" id="do-settle">Confirm payment</button>`,
  });
  let mode = 'cash';
  const cashIn = m.$<HTMLInputElement>('#cash-in');
  const updateChange = () => {
    const ch = Number(cashIn.value || 0) - total;
    m.$('#change').innerHTML = ch >= 0 ? `Change to return: <b>${money(ch)}</b>` : `<span class="danger-text">Short by ${money(-ch)}</span>`;
  };
  const splitInputs = $$<HTMLInputElement>('[data-split]', m.el);
  const updateSplit = () => {
    const sum = splitInputs.reduce((a, i) => a + Number(i.value || 0), 0);
    const left = Math.round((total - sum) * 100) / 100;
    m.$('#split-left').innerHTML = left === 0 ? '<span class="ok-text">Fully allocated ✓</span>' : `Remaining: <b>${money(left)}</b>`;
  };
  cashIn.addEventListener('input', updateChange);
  splitInputs.forEach((i) => i.addEventListener('input', updateSplit));
  $$<HTMLButtonElement>('[data-cash]', m.el).forEach((b) =>
    b.addEventListener('click', () => {
      cashIn.value = b.dataset.cash!;
      updateChange();
    }),
  );
  $$<HTMLButtonElement>('[data-mode]', m.el).forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode!;
      $$('[data-mode]', m.el).forEach((x) => x.classList.toggle('on', x === b));
      m.$('#pay-cash').hidden = mode !== 'cash';
      m.$('#pay-split').hidden = mode !== 'split';
      if (mode === 'split') updateSplit();
    }),
  );
  m.$('#do-settle').addEventListener(
    'click',
    guard(async () => {
      let payments: { mode: string; amount: number }[];
      if (mode === 'split') {
        payments = splitInputs.map((i) => ({ mode: i.dataset.split!, amount: Number(i.value || 0) })).filter((p) => p.amount > 0);
        const sum = payments.reduce((a, p) => a + p.amount, 0);
        if (Math.abs(sum - total) > 0.5) throw new Error('Split amounts must add up to the bill total');
      } else {
        if (mode === 'cash' && Number(cashIn.value || 0) < total) throw new Error('Cash received is less than the bill');
        payments = [{ mode, amount: total }];
      }
      const done = await api.post<Order>(`/orders/${o.id}/settle`, { payments });
      if (m.$<HTMLInputElement>('#print-bill').checked) printInvoice(done, S.ctx.settings);
      m.close();
      toast(`${done.order_no} settled · ${money(done.total)}`);
      afterClose();
    }),
  );
}

export function openDiscount() {
  const m = modal({
    title: 'Apply discount',
    size: 'sm',
    body: `<div class="seg wide" id="disc-type"><button data-dt="flat" class="${S.discount_type === 'flat' ? 'on' : ''}">Flat amount</button><button data-dt="percent" class="${S.discount_type === 'percent' ? 'on' : ''}">Percentage %</button></div>
      <div class="field"><label>Value</label><input id="disc-val" type="number" min="0" step="0.01" value="${S.discount_value || ''}" autofocus></div>
      <div class="chips">${UI_CONFIG.presets.discountPercents.map((p) => `<button class="chip" data-pct="${p}">${p}%</button>`).join('')}</div>`,
    footer: `<button class="btn ghost" data-act="remove">Remove discount</button><button class="btn primary" data-act="apply">Apply</button>`,
  });
  let type = S.discount_type;
  $$<HTMLButtonElement>('[data-dt]', m.el).forEach((b) =>
    b.addEventListener('click', () => {
      type = b.dataset.dt as 'flat' | 'percent';
      $$('[data-dt]', m.el).forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  const apply = guard(async (t: 'flat' | 'percent', v: number) => {
    S.discount_type = t;
    S.discount_value = v;
    if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { discount_type: t, discount_value: v }));
    m.close();
    renderCart();
  });
  $$<HTMLButtonElement>('[data-pct]', m.el).forEach((b) => b.addEventListener('click', () => apply('percent', Number(b.dataset.pct))));
  m.$('[data-act=apply]').addEventListener('click', () => apply(type, Number(m.$<HTMLInputElement>('#disc-val').value || 0)));
  m.$('[data-act=remove]').addEventListener('click', () => apply('flat', 0));
}

export function openMove() {
  if (!S.order) return;
  const free = S.floor.tables.filter((t) => !t.order_id);
  const m = modal({
    title: `Move ${S.order.order_no} to another table`,
    body: free.length
      ? `<div class="table-pick">${free.map((t) => `<button class="chip lg" data-t="${t.id}">${esc(t.name)}<small>${t.seats} seats</small></button>`).join('')}</div>`
      : emptyState('No free tables'),
  });
  $$<HTMLButtonElement>('[data-t]', m.el).forEach((b) =>
    b.addEventListener(
      'click',
      guard(async () => {
        setOrder(await api.post<Order>(`/orders/${S.order!.id}/move`, { table_id: Number(b.dataset.t) }));
        S.floor = await api.get<FloorData>('/tables');
        m.close();
        toast(`Moved to ${S.order!.table_name}`);
        renderCart();
      }),
    ),
  );
}

export function openCustomer() {
  const m = modal({
    title: 'Customer',
    body: `
      <div class="field"><label>Search by phone or name</label><input id="cust-q" type="search" placeholder="e.g. 98100…" autocomplete="off"></div>
      <div id="cust-results" class="pick-list"></div>
      <details class="new-cust" id="new-cust"><summary>+ New customer</summary>
        <form class="form-grid" id="cust-form">
          <div class="field half"><label>Name</label><input name="name" required></div>
          <div class="field half"><label>Phone</label><input name="phone" type="tel" required></div>
          <div class="field half"><label>Email</label><input name="email" type="email"></div>
          <div class="field half"><label>Birthday</label><input name="birthday" type="date"></div>
          <div class="field"><label>Address</label><input name="address"></div>
          <button class="btn primary" type="submit">Save &amp; select</button>
        </form>
      </details>`,
    footer: S.customer ? `<button class="btn ghost danger-text" id="cust-remove">Remove ${esc(S.customer.name)} from order</button>` : '',
  });
  const q = m.$<HTMLInputElement>('#cust-q');
  let timer = 0;
  const select = guard(async (c: Customer) => {
    S.customer = { id: c.id, name: c.name, phone: c.phone, points: c.points };
    if (S.type === 'delivery' && !S.delivery_address && c.address) S.delivery_address = c.address;
    if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { customer_id: c.id, ...(S.type === 'delivery' ? { delivery_address: S.delivery_address } : {}) }));
    m.close();
    renderCart();
  });
  const search = async () => {
    const list = await api.get<Customer[]>(`/customers?limit=8&q=${encodeURIComponent(q.value.trim())}`);
    m.$('#cust-results').innerHTML = list.length
      ? list
          .map((c) => `<button data-c="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.phone)}</span><small>${c.visits} visits · ${Math.round(c.points)} pts</small></button>`)
          .join('')
      : '<div class="muted small">No match — add them as a new customer below.</div>';
    $$<HTMLButtonElement>('[data-c]', m.el).forEach((b) => b.addEventListener('click', () => select(list.find((c) => c.id === Number(b.dataset.c))!)));
    if (!list.length && /^\d{6,}$/.test(q.value.trim())) {
      m.$<HTMLDetailsElement>('#new-cust').open = true;
      m.$<HTMLInputElement>('#cust-form [name=phone]').value = q.value.trim();
    }
  };
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(search, UI_CONFIG.timing.searchDebounceMs);
  });
  search();
  m.$<HTMLFormElement>('#cust-form').addEventListener(
    'submit',
    guard(async (e: Event) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target as HTMLFormElement));
      const c = await api.post<Customer>('/customers', body);
      toast('Customer added');
      await select(c);
    }),
  );
  m.el.querySelector('#cust-remove')?.addEventListener(
    'click',
    guard(async () => {
      S.customer = null;
      if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { customer_id: null }));
      m.close();
      renderCart();
    }),
  );
}
