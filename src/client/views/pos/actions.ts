// What the POS buttons do: create order, send KOT, print bill, settle, void, cancel, notes.
import type { FloorData } from '../../core/types/floor.js';
import type { Kot, Order } from '../../core/types/orders.js';
import { api, requestRef } from '../../core/api.js';
import { printInvoice, printKot } from '../../core/print.js';
import { UI_CONFIG } from '../../config.js';
import { canFront, cartChanged, draftKey, S, saveDraft, setOrder } from './state.js';
import { guard, promptDialog, toast } from '../../ui/index.js';
import { openCustomer, openDiscount, openMove, openSettle } from './dialogs.js';
import { renderCart } from './cart-panel.js';
import type { OrderType } from '../../../shared/domain.js';
import { ROLE_GROUPS } from '../../../shared/domain.js';

export function resetOrder(type: OrderType = S.type) {
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

export async function ensureOrder(): Promise<Order> {
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

export async function sendKot(print: boolean): Promise<Order> {
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

export const ACTIONS: Record<string, () => void> = {
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
    promptDialog('Order note', 'Visible on KOT and bill', { value: S.notes, required: false, chips: UI_CONFIG.presets.orderNotes }).then(
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
      chips: UI_CONFIG.presets.cancelReasons,
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

export const voidItem = guard(async (id: number) => {
  const item = S.order?.items.find((i) => i.id === id);
  if (!item) return;
  const reason = await promptDialog(`Void ${item.name}?`, 'Reason', { chips: UI_CONFIG.presets.voidReasons });
  if (!reason) return;
  setOrder(await api.patch<Order>(`/order-items/${id}`, { cancelled: true, reason }));
  toast('Item voided — kitchen notified');
  renderCart();
});

export function afterClose() {
  // The order is settled or cancelled: drop its local draft
  S.cart = [];
  saveDraft();
  // Forget the closed order first so the live 'orders' event it triggers isn't mistaken for a remote change
  S.order = null;
  if (S.type === 'dine_in' && S.ctx.can(ROLE_GROUPS.SERVICE)) location.hash = '#/tables';
  else resetOrder(S.type);
}
