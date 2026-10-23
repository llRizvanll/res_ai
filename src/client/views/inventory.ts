import type { AppCtx } from '../core/types/app.js';
import type { InventoryItem, StockMove } from '../core/types/operations.js';
import { $, esc } from '../core/dom.js';
import { addDays, today } from '../core/dates.js';
import { api } from '../core/api.js';
import { fmtDateTime, money, money0, qtyFmt } from '../core/format.js';
import { badge, confirmDialog, emptyState, formModal, guard, toast } from '../ui/index.js';
import { STOCK_UNITS } from '../../shared/domain.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let items: InventoryItem[] = [];
let tab: 'stock' | 'moves' = 'stock';
let lowOnly = false;
let q = '';
const mf = { type: '', from: addDays(today(), -7), to: today(), inventory_id: '' };

const MOVE_LABEL: Record<string, [string, string]> = {
  purchase: ['Purchase', 'ok'], consumption: ['Sale usage', 'info'], wastage: ['Wastage', 'danger'], adjust: ['Adjustment', 'warn'],
};

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = '<div class="page" id="inv"></div>';
  root = $('#inv', el);
  root.addEventListener('click', onClick);
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'inv-q') {
      q = t.value.toLowerCase();
      paintStock();
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'low-only') {
      lowOnly = t.checked;
      paintStock();
    } else if (t.dataset.mf) {
      mf[t.dataset.mf as keyof typeof mf] = t.value;
      paintMoves();
    }
  });
  await load();
}

async function load() {
  items = await api.get<InventoryItem[]>('/inventory');
  shell();
  if (tab === 'stock') paintStock();
  else paintMoves();
}

function shell() {
  const low = items.filter((i) => i.stock <= i.min_stock);
  const value = items.reduce((a, i) => a + Math.max(0, i.stock) * i.cost, 0);
  root!.innerHTML = `
    <div class="kpis small">
      <div class="kpi"><small>Raw materials</small><b>${items.length}</b></div>
      <div class="kpi"><small>Stock value</small><b>${money0(value)}</b></div>
      <div class="kpi ${low.length ? 'danger' : ''}"><small>Low / out of stock</small><b>${low.length}</b></div>
    </div>
    <div class="tabs"><button class="${tab === 'stock' ? 'on' : ''}" data-tab="stock">Current stock</button><button class="${tab === 'moves' ? 'on' : ''}" data-tab="moves">Stock movements</button></div>
    <div id="inv-body"></div>`;
}

function paintStock() {
  const list = items.filter((i) => (!lowOnly || i.stock <= i.min_stock) && (!q || i.name.toLowerCase().includes(q)));
  $('#inv-body', root!).innerHTML = `
    <div class="toolbar">
      <input type="search" id="inv-q" placeholder="Search raw material…" value="${esc(q)}">
      <label class="check"><input type="checkbox" id="low-only" ${lowOnly ? 'checked' : ''}> Low stock only</label>
      <span class="grow"></span>
      <button class="btn primary" data-a="add">+ Add raw material</button>
    </div>
    <div class="card flush">${
      list.length
        ? `<table class="table"><thead><tr><th>Material</th><th class="num">In stock</th><th class="num">Min level</th><th class="num">Unit cost</th><th class="num">Value</th><th class="num">Used (7 days)</th><th>Status</th><th></th></tr></thead>
        <tbody>${list
          .map((i) => {
            const st = i.stock <= 0 ? badge('Out of stock', 'danger') : i.stock <= i.min_stock ? badge('Low', 'warn') : badge('OK', 'ok');
            return `<tr><td><b>${esc(i.name)}</b><div class="muted small">${i.used_in ? `Used in ${i.used_in} recipes` : 'Not linked to recipes'}</div></td>
            <td class="num"><b>${qtyFmt(i.stock)}</b> ${esc(i.unit)}</td><td class="num">${qtyFmt(i.min_stock)} ${esc(i.unit)}</td>
            <td class="num">${money(i.cost)}</td><td class="num">${money0(Math.max(0, i.stock) * i.cost)}</td><td class="num">${qtyFmt(i.used_7d || 0)} ${esc(i.unit)}</td><td>${st}</td>
            <td class="actions-cell">
              <button class="btn sm ok" data-move="purchase" data-id="${i.id}">+ Purchase</button>
              <button class="btn ghost sm" data-move="wastage" data-id="${i.id}">Wastage</button>
              <button class="btn ghost sm" data-move="adjust" data-id="${i.id}">Count</button>
              <button class="btn ghost sm" data-edit="${i.id}">Edit</button>
              <button class="btn ghost sm" data-hist="${i.id}">History</button>
            </td></tr>`;
          })
          .join('')}</tbody></table>`
        : emptyState('No materials found')
    }</div>`;
}

async function paintMoves() {
  const qs = new URLSearchParams(Object.entries(mf).filter(([, v]) => v)).toString();
  const moves = await api.get<StockMove[]>('/stock-moves?' + qs);
  const purchaseTotal = moves.filter((m) => m.type === 'purchase').reduce((a, m) => a + m.qty * m.cost, 0);
  $('#inv-body', root!).innerHTML = `
    <div class="toolbar wrap">
      <label>From <input type="date" data-mf="from" value="${mf.from}"></label>
      <label>To <input type="date" data-mf="to" value="${mf.to}"></label>
      <select data-mf="type"><option value="">All movement types</option>${Object.entries(MOVE_LABEL).map(([k, [l]]) => `<option value="${k}" ${mf.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-mf="inventory_id"><option value="">All materials</option>${items.map((i) => `<option value="${i.id}" ${String(i.id) === mf.inventory_id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
      <span class="grow"></span><span class="muted">Purchases in range: <b>${money(purchaseTotal)}</b></span>
    </div>
    <div class="card flush">${
      moves.length
        ? `<table class="table compact"><thead><tr><th>When</th><th>Material</th><th>Type</th><th class="num">Qty</th><th class="num">Unit cost</th><th>Supplier / ref</th><th>Note</th><th>By</th></tr></thead>
        <tbody>${moves
          .map((m) => {
            const [l, tone] = MOVE_LABEL[m.type] || [m.type, ''];
            return `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(m.name)}</td><td>${badge(l, tone)}</td>
            <td class="num ${m.qty < 0 ? 'danger-text' : 'ok-text'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty)} ${esc(m.unit)}</td><td class="num">${money(m.cost)}</td>
            <td>${esc(m.supplier || m.order_no || '')}</td><td>${esc(m.note || '')}</td><td>${esc(m.user_name || '')}</td></tr>`;
          })
          .join('')}</tbody></table>`
        : emptyState('No stock movements in this range')
    }</div>`;
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.tab) {
    tab = d.tab as typeof tab;
    shell();
    if (tab === 'stock') paintStock();
    else await paintMoves();
  } else if (d.a === 'add') edit();
  else if (d.edit) edit(items.find((i) => i.id === Number(d.edit)));
  else if (d.move) move(items.find((i) => i.id === Number(d.id))!, d.move);
  else if (d.hist) {
    mf.inventory_id = d.hist;
    mf.type = '';
    mf.from = addDays(today(), -30);
    tab = 'moves';
    shell();
    await paintMoves();
  }
});

function edit(i?: InventoryItem) {
  const m = formModal({
    title: i ? `Edit ${i.name}` : 'New raw material',
    values: i || { unit: 'kg', stock: 0, min_stock: 0, cost: 0 },
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'unit', label: 'Unit', type: 'select', half: true, options: STOCK_UNITS.map((u) => [u, u]) },
      { name: 'cost', label: 'Cost per unit', type: 'number', step: '0.01', min: 0, half: true },
      ...(i ? [] : [{ name: 'stock', label: 'Opening stock', type: 'number' as const, step: '0.001', min: 0, half: true }]),
      { name: 'min_stock', label: 'Reorder (minimum) level', type: 'number', step: '0.001', min: 0, half: true, hint: 'You get a low-stock alert at or below this level' },
    ],
    onSubmit: async (v) => {
      if (i) await api.put('/inventory/' + i.id, v);
      else await api.post('/inventory', v);
      toast('Saved');
      await load();
    },
  });
  if (i) {
    const del = document.createElement('button');
    del.className = 'btn ghost danger-text';
    del.textContent = 'Delete';
    del.style.marginRight = 'auto';
    m.$('.modal-foot').prepend(del);
    del.addEventListener(
      'click',
      guard(async () => {
        if (!(await confirmDialog(`Delete ${i.name}? It will be removed from all recipes and its history deleted.`, { okLabel: 'Delete', danger: true }))) return;
        await api.del('/inventory/' + i.id);
        m.close();
        await load();
      }),
    );
  }
}

function move(i: InventoryItem, type: string) {
  const titles: Record<string, string> = { purchase: `Purchase / stock in — ${i.name}`, wastage: `Record wastage — ${i.name}`, adjust: `Physical count — ${i.name}` };
  formModal({
    title: titles[type]!,
    size: 'sm',
    intro: `<p class="muted small">Current stock: <b>${qtyFmt(i.stock)} ${esc(i.unit)}</b></p>`,
    values: { cost: i.cost },
    submitLabel: type === 'purchase' ? 'Add stock' : type === 'wastage' ? 'Record wastage' : 'Set stock',
    fields: [
      { name: 'qty', label: type === 'adjust' ? `Actual quantity counted (${i.unit})` : `Quantity (${i.unit})`, type: 'number', step: '0.001', min: 0, required: true },
      ...(type === 'purchase'
        ? [
            { name: 'cost', label: 'Cost per unit', type: 'number' as const, step: '0.01', min: 0, half: true },
            { name: 'supplier', label: 'Supplier', half: true },
          ]
        : []),
      { name: 'note', label: 'Note', placeholder: type === 'wastage' ? 'e.g. spoiled, spilled' : '' },
    ],
    onSubmit: async (v) => {
      await api.post(`/inventory/${i.id}/move`, { ...v, type });
      toast('Stock updated');
      await load();
    },
  });
}
