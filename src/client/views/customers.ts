import { api } from '../api.js';
import { $, esc, money, money0, fmtDate, fmtDateTime, formModal, modal, confirmDialog, toast, guard, emptyState, statusBadge, label, ORDER_TYPES, downloadCSV, type Field } from '../ui.js';
import type { AppCtx, Customer } from '../types.js';

interface CustomerDetail extends Customer {
  orders: { id: number; order_no: string; type: string; total: number; status: string; created_at: string }[];
  favourites: { name: string; qty: number }[];
}

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let list: Customer[] = [];
let q = '';
let timer = 0;
const selected = new Set<number>();

const FIELDS: Field[] = [
  { name: 'name', label: 'Name', required: true, half: true },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, half: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'birthday', label: 'Birthday', type: 'date', half: true },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'notes', label: 'Notes / preferences', type: 'textarea', placeholder: 'e.g. prefers window seat, allergic to nuts' },
];

export async function render(el: HTMLElement, _p: Record<string, string>, c: AppCtx) {
  ctx = c;
  el.innerHTML = `
    <div class="page">
      <div class="toolbar">
        <input type="search" id="c-q" placeholder="Search name, phone or email…" value="${esc(q)}">
        <span class="grow"></span>
        <button class="btn danger" data-a="bulk-del" hidden></button>
        <button class="btn ghost" data-a="csv">⇩ Export</button>
        <button class="btn primary" data-a="add">+ Add customer</button>
      </div>
      <div id="c-kpis" class="kpis small"></div>
      <div class="card flush" id="c-table"></div>
    </div>`;
  root = $('.page', el);
  $('#c-q', root).addEventListener('input', (e) => {
    q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(timer);
    timer = window.setTimeout(load, 200);
  });
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.sel) {
      if (t.checked) selected.add(Number(t.dataset.sel));
      else selected.delete(Number(t.dataset.sel));
    } else if ('selAll' in t.dataset) {
      root.querySelectorAll<HTMLInputElement>('[data-sel]').forEach((cb) => {
        cb.checked = t.checked;
        if (t.checked) selected.add(Number(cb.dataset.sel));
        else selected.delete(Number(cb.dataset.sel));
      });
    } else return;
    paintBulk();
  });
  await load();
}

async function load() {
  list = await api.get<Customer[]>(`/customers?limit=1000&q=${encodeURIComponent(q)}`);
  const repeat = list.filter((c) => c.visits > 1).length;
  const thisMonth = new Date().toISOString().slice(5, 7);
  const bdays = list.filter((c) => c.birthday && c.birthday.slice(5, 7) === thisMonth).length;
  $('#c-kpis', root!).innerHTML = `
    <div class="kpi"><small>Customers</small><b>${list.length}</b></div>
    <div class="kpi"><small>Repeat customers</small><b>${repeat}</b></div>
    <div class="kpi"><small>Lifetime revenue</small><b>${money0(list.reduce((a, c) => a + c.total_spent, 0))}</b></div>
    <div class="kpi"><small>Birthdays this month</small><b>${bdays}</b></div>`;
  $('#c-table', root!).innerHTML = list.length
    ? `<table class="table"><thead><tr>${canBulk() ? '<th class="sel"><input type="checkbox" data-sel-all aria-label="Select all"></th>' : ''}<th>Name</th><th>Phone</th><th class="num">Visits</th><th class="num">Total spent</th><th class="num">Avg bill</th><th class="num">Points</th><th>Last visit</th><th>Birthday</th></tr></thead>
      <tbody>${list
        .map(
          (c) => `<tr class="click" data-id="${c.id}">${canBulk() ? `<td class="sel"><input type="checkbox" data-sel="${c.id}" ${selected.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></td>` : ''}<td><b>${esc(c.name)}</b>${c.email ? `<div class="muted small">${esc(c.email)}</div>` : ''}</td><td>${esc(c.phone)}</td>
          <td class="num">${c.visits}</td><td class="num">${money0(c.total_spent)}</td><td class="num">${c.visits ? money0(c.total_spent / c.visits) : '—'}</td>
          <td class="num">${Math.round(c.points)}</td><td>${fmtDate(c.last_visit)}</td><td>${c.birthday ? fmtDate(c.birthday) : '—'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : emptyState('No customers found', 'Customers are added from the POS or here');
  paintBulk();
}

const canBulk = () => ctx.can(['admin', 'manager']);

function paintBulk() {
  const btn = $<HTMLButtonElement>('[data-a=bulk-del]', root);
  btn.hidden = !selected.size;
  btn.textContent = `Delete selected (${selected.size})`;
}

const onClick = guard(async (e: Event) => {
  const el = e.target as HTMLElement;
  if (el.closest('td.sel, th.sel')) return;
  const a = el.closest<HTMLElement>('[data-a]')?.dataset.a;
  if (a === 'add') return edit();
  if (a === 'bulk-del') {
    if (!(await confirmDialog(`Delete ${selected.size} customer(s)? Their past orders stay but lose the customer link.`, { okLabel: 'Delete', danger: true }))) return;
    await api.post('/customers/bulk-delete', { ids: [...selected] });
    toast(`${selected.size} customers deleted`);
    selected.clear();
    return load();
  }
  if (a === 'csv') {
    return downloadCSV('customers.csv', [
      ['Name', 'Phone', 'Email', 'Birthday', 'Visits', 'Total spent', 'Points', 'Last visit'],
      ...list.map((c) => [c.name, c.phone, c.email, c.birthday, c.visits, c.total_spent, c.points, c.last_visit]),
    ]);
  }
  const row = el.closest<HTMLElement>('[data-id]');
  if (row) await detail(Number(row.dataset.id));
});

function edit(c?: Customer) {
  formModal({
    title: c ? `Edit ${c.name}` : 'New customer',
    values: c || {},
    fields: c ? [...FIELDS, { name: 'points', label: 'Loyalty points', type: 'number', min: 0, half: true }] : FIELDS,
    onSubmit: async (v) => {
      if (c) await api.put('/customers/' + c.id, v);
      else await api.post('/customers', v);
      toast('Customer saved');
      await load();
    },
  });
}

async function detail(id: number) {
  const c = await api.get<CustomerDetail>('/customers/' + id);
  const m = modal({
    title: c.name,
    size: 'lg',
    body: `
      <div class="detail-grid">
        <div><small>Phone</small><b>${esc(c.phone)}</b></div>
        <div><small>Email</small><b>${esc(c.email || '—')}</b></div>
        <div><small>Birthday</small><b>${c.birthday ? fmtDate(c.birthday) : '—'}</b></div>
        <div><small>Visits</small><b>${c.visits}</b></div>
        <div><small>Total spent</small><b>${money(c.total_spent)}</b></div>
        <div><small>Loyalty points</small><b>${Math.round(c.points)}</b></div>
      </div>
      ${c.address ? `<div class="order-note">Address: ${esc(c.address)}</div>` : ''}
      ${c.notes ? `<div class="order-note">Notes: ${esc(c.notes)}</div>` : ''}
      ${c.favourites.length ? `<h4>Favourite dishes</h4><div class="chips">${c.favourites.map((f) => `<span class="chip">${esc(f.name)} × ${f.qty}</span>`).join('')}</div>` : ''}
      <h4>Order history</h4>
      ${c.orders.length
        ? `<table class="table compact"><thead><tr><th>Order</th><th>Date</th><th>Type</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>${c.orders
            .map((o) => `<tr class="click" onclick="location.hash='#/orders?id=${o.id}'"><td>${esc(o.order_no)}</td><td>${fmtDateTime(o.created_at)}</td><td>${esc(label(ORDER_TYPES, o.type))}</td><td>${statusBadge(o.status)}</td><td class="num">${money(o.total)}</td></tr>`)
            .join('')}</tbody></table>`
        : emptyState('No orders yet')}`,
    footer: `${ctx.can(['admin', 'manager']) ? '<button class="btn ghost danger-text" data-a="del">Delete</button>' : ''}<span class="grow"></span><button class="btn" data-a="edit">Edit</button>`,
  });
  m.el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('tr.click')) m.close();
  });
  m.$('[data-a=edit]').addEventListener('click', () => {
    m.close();
    edit(c);
  });
  m.el.querySelector('[data-a=del]')?.addEventListener(
    'click',
    guard(async () => {
      if (!(await confirmDialog(`Delete ${c.name}? Their past orders stay but lose the customer link.`, { okLabel: 'Delete', danger: true }))) return;
      await api.del('/customers/' + c.id);
      m.close();
      toast('Customer deleted');
      await load();
    }),
  );
}
