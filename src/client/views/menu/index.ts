// Menu page: categories, searchable item list, availability switches and bulk delete.
import type { AppCtx } from '../../core/types/app.js';
import type { Menu } from '../../core/types/menu.js';
import { $, $$, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { money } from '../../core/format.js';
import { M } from './state.js';
import { confirmDialog, emptyState, guard, toast, vegDot } from '../../ui/index.js';
import { editCategory } from './category-dialog.js';
import { editItem } from './item-dialog.js';

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = `
    <div class="page menu-page">
      <aside class="card cat-panel">
        <div class="card-head"><h3>Categories</h3><button class="btn sm" data-a="add-cat">+ Add</button></div>
        <div id="cat-list" class="cat-list"></div>
      </aside>
      <section class="card flush">
        <div class="toolbar pad">
          <input type="search" id="m-q" placeholder="Search items or short codes…">
          <span class="grow"></span>
          <button class="btn danger" data-a="bulk-del" hidden>Delete selected</button>
          <button class="btn primary" data-a="add-item">+ Add item</button>
        </div>
        <div id="item-table"></div>
      </section>
    </div>`;
  M.root = $('.menu-page', el);
  $('#m-q', M.root).addEventListener('input', (e) => {
    M.q = (e.target as HTMLInputElement).value.toLowerCase();
    paintItems();
  });
  M.root.addEventListener('click', onClick);
  M.root.addEventListener('change', onChange);
  await load();
}

export function onEvent(type: string) {
  if (M.root?.isConnected && type === 'menu') load();
}

export async function load() {
  M.menu = await api.get<Menu>('/menu');
  for (const id of [...M.selected]) if (!M.menu.items.some((i) => i.id === id)) M.selected.delete(id);
  paintCats();
  paintItems();
}

function paintCats() {
  const n = (id: number) => M.menu.items.filter((i) => i.category_id === id).length;
  $('#cat-list', M.root!).innerHTML =
    `<button class="cat-row ${M.cat === 'all' ? 'on' : ''}" data-cat="all"><span>All items</span><small>${M.menu.items.length}</small></button>` +
    M.menu.categories
      .map(
        (c) => `<div class="cat-row ${M.cat === c.id ? 'on' : ''} ${c.active ? '' : 'muted'}"><button class="grow" data-cat="${c.id}"><span>${esc(c.name)}</span>${c.active ? '' : ' <small>(hidden)</small>'}</button><small>${n(c.id)}</small>
        <button class="icon-btn sm" data-edit-cat="${c.id}" title="Edit">✎</button></div>`,
      )
      .join('');
}

function paintItems() {
  const items = M.menu.items.filter(
    (i) => (M.cat === 'all' || i.category_id === M.cat) && (!M.q || i.name.toLowerCase().includes(M.q) || (i.code || '').toLowerCase().includes(M.q)),
  );
  const catName = (id: number | null) => M.menu.categories.find((c) => c.id === id)?.name || '—';
  $('#item-table', M.root!).innerHTML = items.length
    ? `<table class="table"><thead><tr><th class="sel"><input type="checkbox" data-sel-all aria-label="Select all" ${items.every((i) => M.selected.has(i.id)) ? 'checked' : ''}></th><th>Item</th><th>Code</th><th>Category</th><th class="num">Price</th><th class="num">GST</th><th>Variants</th><th>Available</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (i) => `<tr><td class="sel"><input type="checkbox" data-sel="${i.id}" ${M.selected.has(i.id) ? 'checked' : ''} aria-label="Select ${esc(i.name)}"></td><td>${vegDot(i.veg)} <b>${esc(i.name)}</b>${i.description ? `<div class="muted small">${esc(i.description)}</div>` : ''}</td>
          <td>${esc(i.code || '')}</td><td>${esc(catName(i.category_id))}</td><td class="num">${money(i.price)}</td><td class="num">${i.tax_rate}%</td>
          <td class="small">${i.variants.map((v) => `${esc(v.name)} ${money(v.price)}`).join('<br>') || '—'}</td>
          <td><input type="checkbox" class="switch" data-avail="${i.id}" ${i.available ? 'checked' : ''} aria-label="Available"></td>
          <td class="actions-cell"><button class="btn ghost sm" data-edit="${i.id}">Edit</button><button class="btn ghost sm danger-text" data-del="${i.id}">Delete</button></td></tr>`,
        )
        .join('')}</tbody></table>`
    : emptyState('No items here yet', 'Add your first dish with “+ Add item”');
  paintBulk();
}

function paintBulk() {
  const btn = $<HTMLButtonElement>('[data-a=bulk-del]', M.root);
  btn.hidden = !M.selected.size;
  btn.textContent = `Delete selected (${M.selected.size})`;
}

// Selection is synchronous; only the availability toggle talks to the server
function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.dataset.sel) {
    if (t.checked) M.selected.add(Number(t.dataset.sel));
    else M.selected.delete(Number(t.dataset.sel));
    return paintBulk();
  }
  if ('selAll' in t.dataset) {
    $$<HTMLInputElement>('[data-sel]', M.root).forEach((cb) => {
      cb.checked = t.checked;
      if (t.checked) M.selected.add(Number(cb.dataset.sel));
      else M.selected.delete(Number(cb.dataset.sel));
    });
    return paintBulk();
  }
  if (t.dataset.avail) toggleAvailability(t);
}

const toggleAvailability = guard(async (t: HTMLInputElement) => {
  await api.patch(`/items/${t.dataset.avail}/availability`, { available: t.checked });
  toast(t.checked ? 'Item available' : 'Item marked out of stock');
});

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.cat) {
    M.cat = d.cat === 'all' ? 'all' : Number(d.cat);
    paintCats();
    paintItems();
  } else if (d.a === 'add-cat') editCategory();
  else if (d.editCat) editCategory(M.menu.categories.find((c) => c.id === Number(d.editCat)));
  else if (d.a === 'add-item') editItem();
  else if (d.a === 'bulk-del') {
    if (!(await confirmDialog(`Delete ${M.selected.size} menu item(s)? Past bills keep their copy of these items.`, { okLabel: 'Delete', danger: true }))) return;
    await api.post('/items/bulk-delete', { ids: [...M.selected] });
    toast(`${M.selected.size} items deleted`);
    M.selected.clear();
    await load();
  }
  else if (d.edit) editItem(M.menu.items.find((i) => i.id === Number(d.edit)));
  else if (d.del) {
    const it = M.menu.items.find((i) => i.id === Number(d.del))!;
    if (!(await confirmDialog(`Delete “${it.name}”? Past bills keep their copy of the item.`, { okLabel: 'Delete', danger: true }))) return;
    await api.del('/items/' + it.id);
    toast('Item deleted');
    await load();
  }
});

