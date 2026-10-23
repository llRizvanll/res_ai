// Left side of the POS: category list, search and the item grid.
import type { MenuItem } from '../../core/types/menu.js';
import { $, $$, esc } from '../../core/dom.js';
import { money } from '../../core/format.js';
import { cartChanged, S } from './state.js';
import { emptyState, modal, vegDot } from '../../ui/index.js';
import { renderCart } from './cart-panel.js';

export function renderCats() {
  const cats = S.menu.categories.filter((c) => c.active);
  const count = (id: number) => S.menu.items.filter((i) => i.category_id === id).length;
  $('#pos-cats', S.root).innerHTML =
    `<button class="${S.cat === 'all' ? 'on' : ''}" data-cat="all">All items <small>${S.menu.items.length}</small></button>` +
    cats.map((c) => `<button class="${S.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)} <small>${count(c.id)}</small></button>`).join('');
}

export function visibleItems(): MenuItem[] {
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

export function renderItems() {
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

export function addToCart(item: MenuItem, variant: string | null = null) {
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

export function pickItem(item: MenuItem) {
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
