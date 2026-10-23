import { api } from '../api.js';
import { $, $$, esc, money, modal, toast, guard, confirmDialog, formModal, vegDot, emptyState } from '../ui.js';
import type { AppCtx, Category, InventoryItem, Menu, MenuItem } from '../types.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let menu: Menu;
let cat: number | 'all' = 'all';
let q = '';
const selected = new Set<number>();

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
  root = $('.menu-page', el);
  $('#m-q', root).addEventListener('input', (e) => {
    q = (e.target as HTMLInputElement).value.toLowerCase();
    paintItems();
  });
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  await load();
}

export function onEvent(type: string) {
  if (root?.isConnected && type === 'menu') load();
}

async function load() {
  menu = await api.get<Menu>('/menu');
  for (const id of [...selected]) if (!menu.items.some((i) => i.id === id)) selected.delete(id);
  paintCats();
  paintItems();
}

function paintCats() {
  const n = (id: number) => menu.items.filter((i) => i.category_id === id).length;
  $('#cat-list', root!).innerHTML =
    `<button class="cat-row ${cat === 'all' ? 'on' : ''}" data-cat="all"><span>All items</span><small>${menu.items.length}</small></button>` +
    menu.categories
      .map(
        (c) => `<div class="cat-row ${cat === c.id ? 'on' : ''} ${c.active ? '' : 'muted'}"><button class="grow" data-cat="${c.id}"><span>${esc(c.name)}</span>${c.active ? '' : ' <small>(hidden)</small>'}</button><small>${n(c.id)}</small>
        <button class="icon-btn sm" data-edit-cat="${c.id}" title="Edit">✎</button></div>`,
      )
      .join('');
}

function paintItems() {
  const items = menu.items.filter(
    (i) => (cat === 'all' || i.category_id === cat) && (!q || i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q)),
  );
  const catName = (id: number | null) => menu.categories.find((c) => c.id === id)?.name || '—';
  $('#item-table', root!).innerHTML = items.length
    ? `<table class="table"><thead><tr><th class="sel"><input type="checkbox" data-sel-all aria-label="Select all" ${items.every((i) => selected.has(i.id)) ? 'checked' : ''}></th><th>Item</th><th>Code</th><th>Category</th><th class="num">Price</th><th class="num">GST</th><th>Variants</th><th>Available</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (i) => `<tr><td class="sel"><input type="checkbox" data-sel="${i.id}" ${selected.has(i.id) ? 'checked' : ''} aria-label="Select ${esc(i.name)}"></td><td>${vegDot(i.veg)} <b>${esc(i.name)}</b>${i.description ? `<div class="muted small">${esc(i.description)}</div>` : ''}</td>
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
  const btn = $<HTMLButtonElement>('[data-a=bulk-del]', root);
  btn.hidden = !selected.size;
  btn.textContent = `Delete selected (${selected.size})`;
}

// Selection is synchronous; only the availability toggle talks to the server
function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.dataset.sel) {
    if (t.checked) selected.add(Number(t.dataset.sel));
    else selected.delete(Number(t.dataset.sel));
    return paintBulk();
  }
  if ('selAll' in t.dataset) {
    $$<HTMLInputElement>('[data-sel]', root).forEach((cb) => {
      cb.checked = t.checked;
      if (t.checked) selected.add(Number(cb.dataset.sel));
      else selected.delete(Number(cb.dataset.sel));
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
    cat = d.cat === 'all' ? 'all' : Number(d.cat);
    paintCats();
    paintItems();
  } else if (d.a === 'add-cat') editCategory();
  else if (d.editCat) editCategory(menu.categories.find((c) => c.id === Number(d.editCat)));
  else if (d.a === 'add-item') editItem();
  else if (d.a === 'bulk-del') {
    if (!(await confirmDialog(`Delete ${selected.size} menu item(s)? Past bills keep their copy of these items.`, { okLabel: 'Delete', danger: true }))) return;
    await api.post('/items/bulk-delete', { ids: [...selected] });
    toast(`${selected.size} items deleted`);
    selected.clear();
    await load();
  }
  else if (d.edit) editItem(menu.items.find((i) => i.id === Number(d.edit)));
  else if (d.del) {
    const it = menu.items.find((i) => i.id === Number(d.del))!;
    if (!(await confirmDialog(`Delete “${it.name}”? Past bills keep their copy of the item.`, { okLabel: 'Delete', danger: true }))) return;
    await api.del('/items/' + it.id);
    toast('Item deleted');
    await load();
  }
});

function editCategory(c?: Category) {
  const m = formModal({
    title: c ? 'Edit category' : 'New category',
    size: 'sm',
    values: c ? { ...c, active: !!c.active } : { active: true, sort: menu.categories.length + 1 },
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'sort', label: 'Display order', type: 'number', half: true },
      { name: 'active', label: 'Show on POS', type: 'checkbox', half: true },
    ],
    onSubmit: async (v) => {
      if (c) await api.put('/categories/' + c.id, v);
      else await api.post('/categories', v);
      toast('Category saved');
      await load();
    },
  });
  if (c) {
    const del = document.createElement('button');
    del.className = 'btn ghost danger-text';
    del.textContent = 'Delete';
    del.style.marginRight = 'auto';
    m.$('.modal-foot').prepend(del);
    del.addEventListener(
      'click',
      guard(async () => {
        if (!(await confirmDialog(`Delete category “${c.name}”? Its items become uncategorised.`, { okLabel: 'Delete', danger: true }))) return;
        await api.del('/categories/' + c.id);
        m.close();
        if (cat === c.id) cat = 'all';
        await load();
      }),
    );
  }
}

async function editItem(item?: MenuItem) {
  const [inventory, recipe] = await Promise.all([
    api.get<InventoryItem[]>('/inventory'),
    item ? api.get<{ inventory_id: number; qty: number }[]>(`/items/${item.id}/recipe`) : Promise.resolve([]),
  ]);
  const v = item || ({ veg: 1, available: 1, tax_rate: 5, variants: [], category_id: cat === 'all' ? menu.categories[0]?.id : cat } as Partial<MenuItem>);
  const invOptions = (sel?: number) =>
    `<option value="">Select ingredient…</option>${inventory.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('')}`;
  const variantRow = (name = '', price: number | string = '') =>
    `<div class="rep-row"><input placeholder="e.g. Half / Full" data-vn value="${esc(name)}"><input type="number" step="0.01" min="0" placeholder="Price" data-vp value="${price}"><button type="button" class="icon-btn sm" data-rm>✕</button></div>`;
  const recipeRow = (inv?: number, qty: number | string = '') =>
    `<div class="rep-row"><select data-ri>${invOptions(inv)}</select><input type="number" step="0.001" min="0" placeholder="Qty per plate" data-rq value="${qty}"><button type="button" class="icon-btn sm" data-rm>✕</button></div>`;

  const m = modal({
    title: item ? `Edit ${item.name}` : 'New menu item',
    size: 'lg',
    body: `<form id="item-form" class="form-grid">
      <div class="field half"><label>Item name</label><input name="name" required value="${esc(v.name || '')}"></div>
      <div class="field half"><label>Category</label><select name="category_id"><option value="">Uncategorised</option>${menu.categories.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field third"><label>Base price</label><input name="price" type="number" step="0.01" min="0" required value="${v.price ?? ''}"></div>
      <div class="field third"><label>GST %</label><select name="tax_rate">${[0, 5, 12, 18, 28].map((r) => `<option ${r === v.tax_rate ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field third"><label>Short code</label><input name="code" value="${esc(v.code || '')}" placeholder="e.g. PBM"></div>
      <div class="field"><label>Description</label><input name="description" value="${esc(v.description || '')}"></div>
      <label class="check half"><input type="checkbox" name="veg" ${v.veg ? 'checked' : ''}> Vegetarian</label>
      <label class="check half"><input type="checkbox" name="available" ${v.available ? 'checked' : ''}> Available for ordering</label>
      <div class="field"><label>Variants / portions <small class="muted">(optional — overrides base price)</small></label>
        <div id="variants">${(v.variants || []).map((x) => variantRow(x.name, x.price)).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-variant">+ Add variant</button></div>
      <div class="field"><label>Recipe — raw material used per portion <small class="muted">(auto-deducted from inventory when billed)</small></label>
        <div id="recipe">${recipe.map((r) => recipeRow(r.inventory_id, r.qty)).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-recipe">+ Add ingredient</button></div>
    </form>`,
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="save-item">Save item</button>`,
  });
  m.$('#add-variant').addEventListener('click', () => m.$('#variants').insertAdjacentHTML('beforeend', variantRow()));
  m.$('#add-recipe').addEventListener('click', () => m.$('#recipe').insertAdjacentHTML('beforeend', recipeRow()));
  m.el.addEventListener('click', (e) => {
    const rm = (e.target as HTMLElement).closest('[data-rm]');
    if (rm) rm.parentElement!.remove();
  });
  m.$('#save-item').addEventListener(
    'click',
    guard(async () => {
      const form = m.$<HTMLFormElement>('#item-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'),
        category_id: fd.get('category_id') ? Number(fd.get('category_id')) : null,
        price: Number(fd.get('price')),
        tax_rate: Number(fd.get('tax_rate')),
        code: fd.get('code'),
        description: fd.get('description'),
        veg: fd.get('veg') === 'on',
        available: fd.get('available') === 'on',
        sort: item?.sort ?? 0,
        variants: $$('#variants .rep-row', m.el).map((r) => ({
          name: $<HTMLInputElement>('[data-vn]', r).value,
          price: Number($<HTMLInputElement>('[data-vp]', r).value),
        })),
      };
      const saved = item ? await api.put<MenuItem>('/items/' + item.id, body) : await api.post<MenuItem>('/items', body);
      const lines = $$('#recipe .rep-row', m.el).map((r) => ({
        inventory_id: Number($<HTMLSelectElement>('[data-ri]', r).value),
        qty: Number($<HTMLInputElement>('[data-rq]', r).value),
      }));
      await api.put(`/items/${saved.id}/recipe`, { lines });
      toast('Item saved');
      m.close();
      await load();
    }),
  );
}
