// POS state: the current order, the unsent cart, and its on-device draft (survives refresh / dropped Wi-Fi).
import type { AppCtx } from '../../core/types/app.js';
import type { Customer } from '../../core/types/people.js';
import type { FloorData } from '../../core/types/floor.js';
import type { Menu } from '../../core/types/menu.js';
import type { Order } from '../../core/types/orders.js';
import { api } from '../../core/api.js';
import { UI_CONFIG } from '../../config.js';
import { toast } from '../../ui/index.js';
import type { OrderType } from '../../../shared/domain.js';
import { ROLE_GROUPS } from '../../../shared/domain.js';

export interface CartLine {
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

export interface PosState {
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

export const NOTE_CHIPS = UI_CONFIG.presets.cookingNotes;
/** The single POS state object; render() fills it in, every panel reads it */
export const S = {} as PosState;

export async function loadOrder(id: number) {
  const o = await api.get<Order>('/orders/' + id);
  if (o.status !== 'open') {
    toast(`Order ${o.order_no} is ${o.status}. Starting a new order.`, 'info');
    return;
  }
  setOrder(o);
}

export function setOrder(o: Order) {
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

export const canFront = () => S.ctx.can(ROLE_GROUPS.FRONT);

// ---------------------------------------------------------------- unsent-items drafts
// Items not yet sent to the kitchen live only on this device, so they are saved locally
// and survive a refresh, a closed tab, a crash or a dropped connection.
const DRAFT_PREFIX = 'pos_draft:';
export const draftKey = () => DRAFT_PREFIX + (S.order ? `order:${S.order.id}` : `${S.type}:${S.table_id ?? ''}`);

export function saveDraft(key = draftKey()) {
  try {
    if (S.cart.length) localStorage.setItem(key, JSON.stringify({ cart: S.cart, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    /* storage full or blocked — the cart still works in memory */
  }
}

export function restoreDraft() {
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
export function cartChanged() {
  S.kotRef = null;
  saveDraft();
}
