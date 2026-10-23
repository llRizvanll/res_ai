// Billing / POS page: entry point that sets up state, wires events and reacts to live updates.
import type { AppCtx } from '../../core/types/app.js';
import type { FloorData } from '../../core/types/floor.js';
import type { Menu } from '../../core/types/menu.js';
import type { Order } from '../../core/types/orders.js';
import { $, $$ } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ACTIONS, resetOrder, voidItem } from './actions.js';
import { cartChanged, draftKey, loadOrder, NOTE_CHIPS, type PosState, restoreDraft, S, saveDraft, setOrder } from './state.js';
import { pickItem, renderCats, renderItems, visibleItems } from './menu-panel.js';
import { promptDialog, toast, vegDot } from '../../ui/index.js';
import { renderCart } from './cart-panel.js';
import type { OrderType } from '../../../shared/domain.js';
import { ROLE_GROUPS } from '../../../shared/domain.js';

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
  // Fresh state for this visit (the object itself is shared with the panels)
  for (const k of Object.keys(S)) delete (S as unknown as Record<string, unknown>)[k];
  Object.assign(S, {
    root, ctx, menu, floor, order: null, cart: [], type: (params.type as OrderType) || 'dine_in',
    table_id: params.table ? Number(params.table) : null, customer: null, guests: 2,
    discount_type: 'flat', discount_value: 0, notes: '', delivery_address: '', cat: 'all', q: '', veg: 'all',
    kotRef: null, orderRef: null,
  } satisfies PosState);

  if (params.order) {
    await loadOrder(Number(params.order));
  } else if (S.table_id) {
    const t = floor.tables.find((t) => t.id === S.table_id);
    S.type = 'dine_in';
    if (t?.order_id) await loadOrder(t.order_id);
    else if (t) S.guests = Math.min(t.seats, 2);
  }
  if (!ctx.can(ROLE_GROUPS.FRONT) && S.type !== 'dine_in' && !params.type) S.type = 'dine_in';

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
  if (!S.root?.isConnected) return;
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
