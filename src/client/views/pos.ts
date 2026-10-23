import { api, requestRef } from '../api.js';
import { computeTotals } from '../../shared/calc.js';
import { printInvoice, printKot } from '../print.js';
import {
  $, $$, esc, money, toast, modal, promptDialog, guard, vegDot, label, ORDER_TYPES, qtyFmt, emptyState,
} from '../ui.js';
import type { AppCtx, Customer, FloorData, Kot, Menu, MenuItem, Order, OrderItem, OrderType, Role } from '../types.js';

interface CartLine {
  key: string;
  item_id: number;
  name: string;
  variant: string | null;
  price: number;
  qty: number;
  tax_rate: number;
  notes: string;
  veg: number;
}

interface PosState {
  root: HTMLElement;
  ctx: AppCtx;
  menu: Menu;
  floor: FloorData;
  order: Order | null;
  cart: CartLine[];
  type: OrderType;
  table_id: number | null;
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'points'> | null;
  guests: number;
  discount_type: 'flat' | 'percent';
  discount_value: number;
  notes: string;
  delivery_address: string;
  cat: number | 'all';
  q: string;
  veg: 'all' | 'veg' | 'nonveg';
  /** Retry-safe ids: kept while a send is unconfirmed, renewed when the cart changes */
  kotRef: string | null;
  orderRef: string | null;
}

const FRONT: Role[] = ['admin', 'manager', 'cashier'];
const NOTE_CHIPS = ['Less spicy', 'Extra spicy', 'No onion', 'No garlic', 'Jain', 'Less oil', 'Parcel'];
let S: PosState;

export async function render(el: HTMLElement, params: Record<string, string>, ctx: AppCtx) {
  const [menu, floor] = await Promise.all([api.get<Menu>('/menu'), api.get<FloorData>('/tables')]);
  el.innerHTML = `
    <div class="pos">
      <div class="pos-cats" id="pos-cats"></div>
      <section class="pos-menu">
        <div class="pos-toolbar">
          <input id="pos-search" type="search" placeholder="Search dish or short code…  ( / )" autocomplete="off">
          <div class="seg" id="veg-seg">
            <button data-veg="all" class="on">All</button><button data-veg="veg">${vegDot(1)} Veg</button><button data-veg="nonveg">${vegDot(0)} Non-veg</button>
          </div>
        </div>
        <div class="item-grid" id="item-grid"></div>
      </section>
      <aside class="pos-cart" id="pos-cart"></aside>
    </div>`;
  const root = $('.pos', el);
  S = {
    root, ctx, menu, floor, order: null, cart: [], type: (params.type as OrderType) || 'dine_in',
    table_id: params.table ? Number(params.table) : null, customer: null, guests: 2,
    discount_type: 'flat', discount_value: 0, notes: '', delivery_address: '', cat: 'all', q: '', veg: 'all',
    kotRef: null, orderRef: null,
  };

  if (params.order) {
    await loadOrder(Number(params.order));
  } else if (S.table_id) {
    const t = floor.tables.find((t) => t.id === S.table_id);
    S.type = 'dine_in';
    if (t?.order_id) await loadOrder(t.order_id);
    else if (t) S.guests = Math.min(t.seats, 2);
  }
  if (!ctx.can(FRONT) && S.type !== 'dine_in' && !params.type) S.type = 'dine_in';

  restoreDraft();
  renderCats();
  renderItems();
  renderCart();
  wire();

  const onKey = (e: KeyboardEvent) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !document.querySelector('.modal-backdrop')) {
      e.preventDefault();
      $<HTMLInputElement>('#pos-search', S.root).focus();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

export function onEvent(type: string) {
  if (!S?.root.isConnected) return;
  if (type === 'menu') {
    api.get<Menu>('/menu').then((m) => {
      S.menu = m;
      renderCats();
      renderItems();
    });
  }
  if (type === 'tables') {
    api.get<FloorData>('/tables').then((f) => {
      S.floor = f;
      if (!S.order) renderCart();
    });
  }
  if ((type === 'kot' || type === 'orders') && S.order) {
    api.get<Order>('/orders/' + S.order.id).then((o) => {
      if (!S.order || o.id !== S.order.id) return;
      if (o.status !== 'open') {
        toast(`Order ${o.order_no} was ${o.status} on another device`, 'info');
        resetOrder(S.type);
      } else {
        setOrder(o);
        renderCart();
      }
    });
  }
}

// ---------------------------------------------------------------- state
async function loadOrder(id: number) {
  const o = await api.get<Order>('/orders/' + id);
  if (o.status !== 'open') {
    toast(`Order ${o.order_no} is ${o.status}. Starting a new order.`, 'info');
    return;
  }
  setOrder(o);
}

function setOrder(o: Order) {
  S.order = o;
  S.type = o.type;
  S.table_id = o.table_id;
  S.customer = o.customer_id ? { id: o.customer_id, name: o.customer_name || '', phone: o.customer_phone || '', points: o.customer_points || 0 } : null;
  S.guests = o.guests;
  S.discount_type = o.discount_type;
  S.discount_value = o.discount_value;
  S.notes = o.notes || '';
  S.delivery_address = o.delivery_address || '';
  history.replaceState(null, '', `#/pos?order=${o.id}`);
}

function resetOrder(type: OrderType = S.type) {
  if (!S.root.isConnected) return;
  Object.assign(S, {
    order: null, cart: [], type, table_id: null, customer: null, guests: 2, discount_type: 'flat',
    discount_value: 0, notes: '', delivery_address: '',
  });
  history.replaceState(null, '', `#/pos?type=${type}`);
  api.get<FloorData>('/tables').then((f) => {
    S.floor = f;
    renderCart();
  });
  renderCart();
}

const canFront = () => S.ctx.can(FRONT);

// ---------------------------------------------------------------- unsent-items drafts
// Items not yet sent to the kitchen live only on this device, so they are saved locally
// and survive a refresh, a closed tab, a crash or a dropped connection.
const DRAFT_PREFIX = 'pos_draft:';
const draftKey = () => DRAFT_PREFIX + (S.order ? `order:${S.order.id}` : `${S.type}:${S.table_id ?? ''}`);

function saveDraft(key = draftKey()) {
  try {
    if (S.cart.length) localStorage.setItem(key, JSON.stringify({ cart: S.cart, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    /* storage full or blocked — the cart still works in memory */
  }
}

function restoreDraft() {
  if (S.cart.length) return;
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return;
    const d = JSON.parse(raw) as { cart: CartLine[]; at: number };
    if (Date.now() - d.at > 2 * 86400_000 || !d.cart?.length) return localStorage.removeItem(draftKey());
    S.cart = d.cart;
    toast(`Restored ${d.cart.length} unsent item(s) from before`, 'info');
  } catch {
    /* ignore a corrupt draft */
  }
}

/** Call after every cart edit: renews the retry id and saves the draft */
function cartChanged() {
  S.kotRef = null;
  saveDraft();
}

// ---------------------------------------------------------------- menu panel
function renderCats() {
  const cats = S.menu.categories.filter((c) => c.active);
  const count = (id: number) => S.menu.items.filter((i) => i.category_id === id).length;
  $('#pos-cats', S.root).innerHTML =
    `<button class="${S.cat === 'all' ? 'on' : ''}" data-cat="all">All items <small>${S.menu.items.length}</small></button>` +
    cats.map((c) => `<button class="${S.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)} <small>${count(c.id)}</small></button>`).join('');
}

function visibleItems(): MenuItem[] {
  const q = S.q.toLowerCase();
  const activeCats = new Set(S.menu.categories.filter((c) => c.active).map((c) => c.id));
  return S.menu.items.filter(
    (i) =>
      (i.category_id === null || activeCats.has(i.category_id)) &&
      (S.cat === 'all' || i.category_id === S.cat || !!q) &&
      (S.veg === 'all' || (S.veg === 'veg' ? i.veg : !i.veg)) &&
      (!q || i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase() === q || (i.code || '').toLowerCase().startsWith(q)),
  );
}

function renderItems() {
  const items = visibleItems();
  $('#item-grid', S.root).innerHTML = items.length
    ? items
        .map(
          (i) => `<button class="item-card ${i.available ? '' : 'off'}" data-item="${i.id}" ${i.available ? '' : 'disabled'}>
            <div class="item-top">${vegDot(i.veg)}${i.code ? `<span class="code">${esc(i.code)}</span>` : ''}</div>
            <div class="item-name">${esc(i.name)}</div>
            <div class="item-price">${i.variants.length ? `${money(Math.min(...i.variants.map((v) => v.price)))}+` : money(i.price)}</div>
            ${i.available ? '' : '<div class="sold-out">Out of stock</div>'}
          </button>`,
        )
        .join('')
    : emptyState('No items found', 'Try a different search or category');
}

function addToCart(item: MenuItem, variant: string | null = null) {
  const price = variant ? item.variants.find((v) => v.name === variant)!.price : item.price;
  const key = `${item.id}|${variant || ''}`;
  const line = S.cart.find((l) => l.key === key && !l.notes);
  if (line) line.qty += 1;
  else S.cart.push({ key, item_id: item.id, name: item.name, variant, price, qty: 1, tax_rate: item.tax_rate, notes: '', veg: item.veg });
  cartChanged();
  renderCart();
  const box = S.root.querySelector('.cart-lines');
  if (box) box.scrollTop = box.scrollHeight;
}

function pickItem(item: MenuItem) {
  if (!item.variants.length) return addToCart(item);
  const m = modal({
    title: item.name,
    size: 'sm',
    body: `<div class="variant-grid">${item.variants
      .map((v) => `<button class="variant-btn" data-v="${esc(v.name)}"><b>${esc(v.name)}</b><span>${money(v.price)}</span></button>`)
      .join('')}</div>`,
  });
  $$<HTMLButtonElement>('[data-v]', m.el).forEach((b) =>
    b.addEventListener('click', () => {
      addToCart(item, b.dataset.v!);
      m.close();
    }),
  );
}

// ---------------------------------------------------------------- cart panel
function renderCart() {
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
          .map((ty) => `<button data-type="${ty}" class="${S.type === ty ? 'on' : ''}" ${o ? 'disabled' : ''}>${ORDER_TYPES[ty]}</button>`)
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

// ---------------------------------------------------------------- wiring
function wire() {
  const root = S.root;
  const search = $<HTMLInputElement>('#pos-search', root);
  search.addEventListener('input', () => {
    S.q = search.value.trim();
    renderItems();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const items = visibleItems().filter((i) => i.available);
      const exact = items.find((i) => (i.code || '').toLowerCase() === S.q.toLowerCase());
      const target = exact || (items.length === 1 ? items[0] : null);
      if (target) {
        pickItem(target);
        search.value = '';
        S.q = '';
        renderItems();
      }
    }
  });

  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.cat) {
      S.cat = d.cat === 'all' ? 'all' : Number(d.cat);
      renderCats();
      renderItems();
    } else if (d.veg) {
      S.veg = d.veg as PosState['veg'];
      $$('#veg-seg button', root).forEach((b) => b.classList.toggle('on', b === t));
      renderItems();
    } else if (d.item) {
      pickItem(S.menu.items.find((i) => i.id === Number(d.item))!);
    } else if (d.type) {
      S.type = d.type as OrderType;
      renderCart();
    } else if (d.inc) {
      S.cart[Number(d.inc)]!.qty += 1;
      cartChanged();
      renderCart();
    } else if (d.dec) {
      const l = S.cart[Number(d.dec)]!;
      l.qty -= 1;
      if (l.qty <= 0) S.cart.splice(Number(d.dec), 1);
      cartChanged();
      renderCart();
    } else if (d.remove) {
      S.cart.splice(Number(d.remove), 1);
      cartChanged();
      renderCart();
    } else if (d.note) {
      const l = S.cart[Number(d.note)]!;
      promptDialog('Cooking instruction', `${l.name}`, { value: l.notes, required: false, chips: NOTE_CHIPS }).then((v) => {
        if (v === null) return;
        l.notes = v;
        cartChanged();
        renderCart();
      });
    } else if (d.void) {
      voidItem(Number(d.void));
    } else if (d.act) {
      ACTIONS[d.act]?.();
    }
  });

  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'pos-table') {
      const oldKey = draftKey();
      S.table_id = t.value ? Number(t.value) : null;
      try {
        localStorage.removeItem(oldKey);
      } catch {
        /* ignore */
      }
      const tb = S.floor.tables.find((x) => x.id === S.table_id);
      if (tb?.order_id) {
        await loadOrder(tb.order_id);
        toast(`Opened running order on ${tb.name}`, 'info');
      }
      saveDraft();
      renderCart();
    } else if (t.id === 'pos-guests') {
      S.guests = Number(t.value) || 0;
      if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { guests: S.guests }));
    } else if (t.id === 'pos-address') {
      S.delivery_address = t.value.trim();
      if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { delivery_address: S.delivery_address }));
    }
  });
}

// ---------------------------------------------------------------- actions
async function ensureOrder(): Promise<Order> {
  if (S.order) return S.order;
  if (S.type === 'dine_in' && !S.table_id) throw new Error('Please select a table first');
  S.orderRef ??= requestRef();
  const body: Record<string, unknown> = {
    type: S.type, table_id: S.table_id, customer_id: S.customer?.id, guests: S.guests, notes: S.notes,
    delivery_address: S.delivery_address, client_ref: S.orderRef,
  };
  if (canFront()) Object.assign(body, { discount_type: S.discount_type, discount_value: S.discount_value });
  const oldKey = draftKey();
  const o = await api.post<Order>('/orders', body);
  S.orderRef = null;
  setOrder(o);
  // The unsent items now belong to the created order
  try {
    localStorage.removeItem(oldKey);
  } catch {
    /* ignore */
  }
  saveDraft();
  return o;
}

async function sendKot(print: boolean): Promise<Order> {
  const o = await ensureOrder();
  if (!S.cart.length) return o;
  S.kotRef ??= requestRef();
  const res = await api.post<{ order: Order; kot: Kot }>(`/orders/${o.id}/kot`, {
    items: S.cart.map((l) => ({ item_id: l.item_id, variant: l.variant, qty: l.qty, notes: l.notes })),
    client_ref: S.kotRef,
  });
  S.cart = [];
  S.kotRef = null;
  setOrder(res.order);
  saveDraft();
  if (print || S.ctx.settings.kot_auto_print === '1') printKot(res.kot, S.ctx.settings);
  toast(`KOT #${res.kot.kot_no} sent to kitchen`);
  return res.order;
}

const ACTIONS: Record<string, () => void> = {
  kot: guard(async () => {
    await sendKot(false);
    if (S.ctx.user.role === 'waiter' && S.type === 'dine_in') location.hash = '#/tables';
    else renderCart();
  }),
  'kot-print': guard(async () => {
    await sendKot(true);
    renderCart();
  }),
  bill: guard(async () => {
    const o = await sendKot(false);
    const billed = await api.post<Order>(`/orders/${o.id}/bill`);
    setOrder(billed);
    printInvoice(billed, S.ctx.settings);
    renderCart();
  }),
  settle: guard(async () => {
    const o = await sendKot(false);
    renderCart();
    openSettle(o);
  }),
  customer: () => openCustomer(),
  discount: () => openDiscount(),
  notes: () => {
    promptDialog('Order note', 'Visible on KOT and bill', { value: S.notes, required: false, chips: ['Birthday', 'Rush order', 'VIP guest', 'Serve together'] }).then(
      guard(async (v: string | null) => {
        if (v === null) return;
        S.notes = v;
        if (S.order) setOrder(await api.put<Order>('/orders/' + S.order.id, { notes: v }));
        renderCart();
      }),
    );
  },
  move: () => openMove(),
  cancel: guard(async () => {
    if (!S.order) return;
    const reason = await promptDialog(`Cancel ${S.order.order_no}?`, 'Reason for cancellation', {
      chips: ['Customer left', 'Wrong order', 'Duplicate order', 'Kitchen unable to serve'],
    });
    if (!reason) return;
    await api.post(`/orders/${S.order.id}/cancel`, { reason });
    toast('Order cancelled');
    afterClose();
  }),
  clear: () => {
    S.cart = [];
    cartChanged();
    renderCart();
  },
};

const voidItem = guard(async (id: number) => {
  const item = S.order?.items.find((i) => i.id === id);
  if (!item) return;
  const reason = await promptDialog(`Void ${item.name}?`, 'Reason', { chips: ['Customer changed mind', 'Wrong item', 'Quality issue', 'Delay'] });
  if (!reason) return;
  setOrder(await api.patch<Order>(`/order-items/${id}`, { cancelled: true, reason }));
  toast('Item voided — kitchen notified');
  renderCart();
});

function afterClose() {
  // The order is settled or cancelled: drop its local draft
  S.cart = [];
  saveDraft();
  // Forget the closed order first so the live 'orders' event it triggers isn't mistaken for a remote change
  S.order = null;
  if (S.type === 'dine_in' && S.ctx.can(['admin', 'manager', 'cashier', 'waiter'])) location.hash = '#/tables';
  else resetOrder(S.type);
}

function openSettle(o: Order) {
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

function openDiscount() {
  const m = modal({
    title: 'Apply discount',
    size: 'sm',
    body: `<div class="seg wide" id="disc-type"><button data-dt="flat" class="${S.discount_type === 'flat' ? 'on' : ''}">Flat amount</button><button data-dt="percent" class="${S.discount_type === 'percent' ? 'on' : ''}">Percentage %</button></div>
      <div class="field"><label>Value</label><input id="disc-val" type="number" min="0" step="0.01" value="${S.discount_value || ''}" autofocus></div>
      <div class="chips">${[5, 10, 15, 20].map((p) => `<button class="chip" data-pct="${p}">${p}%</button>`).join('')}</div>`,
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

function openMove() {
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

function openCustomer() {
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
    timer = window.setTimeout(search, 200);
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
