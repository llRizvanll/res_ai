// Add / edit a dish: price, GST, portions (variants) and its recipe.
import type { MenuItem } from '../../core/types/menu.js';
import type { InventoryItem } from '../../core/types/operations.js';
import { $, $$, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { M } from './state.js';
import { guard, modal, toast } from '../../ui/index.js';
import { load } from './index.js';
import { GST_RATES } from '../../../shared/domain.js';

export async function editItem(item?: MenuItem) {
  const [inventory, recipe] = await Promise.all([
    api.get<InventoryItem[]>('/inventory'),
    item ? api.get<{ inventory_id: number; qty: number }[]>(`/items/${item.id}/recipe`) : Promise.resolve([]),
  ]);
  const v = item || ({ veg: 1, available: 1, tax_rate: 5, variants: [], category_id: M.cat === 'all' ? M.menu.categories[0]?.id : M.cat } as Partial<MenuItem>);
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
      <div class="field half"><label>Category</label><select name="category_id"><option value="">Uncategorised</option>${M.menu.categories.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field third"><label>Base price</label><input name="price" type="number" step="0.01" min="0" required value="${v.price ?? ''}"></div>
      <div class="field third"><label>GST %</label><select name="tax_rate">${GST_RATES.map((r) => `<option ${r === v.tax_rate ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
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

