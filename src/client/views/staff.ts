import { api } from '../api.js';
import { $, esc, fmtDate, formModal, toast, guard, badge, confirmDialog, type Field } from '../ui.js';
import type { AppCtx, Role, StaffUser } from '../types.js';

const ROLES: [Role, string, string][] = [
  ['admin', 'Owner / Admin', 'Everything, including staff, settings and backups'],
  ['manager', 'Manager', 'Billing, menu, inventory, expenses and reports'],
  ['cashier', 'Cashier', 'Billing, settlements, discounts, customers, dashboard'],
  ['waiter', 'Captain / Waiter', 'Take orders, send KOTs, print bills, reservations'],
  ['kitchen', 'Kitchen', 'Kitchen display and dish availability only'],
];

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let users: StaffUser[] = [];

export async function render(el: HTMLElement, _p: Record<string, string>, c: AppCtx) {
  ctx = c;
  el.innerHTML = `
    <div class="page">
      <div class="grid-2 wide-left">
        <div class="card flush">
          <div class="card-head pad"><h3>Staff accounts</h3><button class="btn primary" data-a="add">+ Add staff</button></div>
          <div id="u-table"></div>
        </div>
        <div class="card"><div class="card-head"><h3>Roles &amp; access</h3></div>
          ${ROLES.map(([, l, d]) => `<div class="role-row"><b>${l}</b><p class="muted small">${d}</p></div>`).join('')}
        </div>
      </div>
    </div>`;
  root = $('.page', el);
  root.addEventListener('click', onClick);
  await load();
}

async function load() {
  users = await api.get<StaffUser[]>('/users');
  const roleLabel = (r: Role) => ROLES.find((x) => x[0] === r)?.[1] || r;
  $('#u-table', root!).innerHTML = `<table class="table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Phone</th><th>Since</th><th>Status</th><th></th></tr></thead><tbody>
    ${users
      .map(
        (u) => `<tr class="${u.active ? '' : 'muted'}"><td><b>${esc(u.name)}</b>${u.id === ctx.user.id ? ' <small>(you)</small>' : ''}</td><td>${esc(u.username)}</td>
        <td>${esc(roleLabel(u.role))}</td><td>${esc(u.phone || '—')}</td><td>${fmtDate(u.created_at)}</td>
        <td>${u.active ? badge('Active', 'ok') : badge('Disabled', 'danger')}</td>
        <td class="actions-cell"><button class="btn ghost sm" data-edit="${u.id}">Edit</button></td></tr>`,
      )
      .join('')}</tbody></table>`;
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.a === 'add') edit();
  else if (b.dataset.edit) edit(users.find((u) => u.id === Number(b.dataset.edit)));
});

function edit(u?: StaffUser) {
  const fields: Field[] = [
    { name: 'name', label: 'Full name', required: true, half: true },
    ...(u ? [] : [{ name: 'username', label: 'Username (for login)', required: true, half: true } as Field]),
    { name: 'role', label: 'Role', type: 'select', options: ROLES.map(([r, l]) => [r, l]), half: true },
    { name: 'phone', label: 'Phone', type: 'tel', half: true },
    { name: 'password', label: u ? 'New password (leave blank to keep)' : 'Password (min 6 chars)', type: 'password', required: !u, half: true },
    ...(u ? [{ name: 'active', label: 'Account active (can sign in)', type: 'checkbox', half: true } as Field] : []),
  ];
  const m = formModal({
    title: u ? `Edit ${u.name}` : 'Add staff member',
    values: u ? { ...u, active: !!u.active } : { role: 'waiter' },
    fields,
    onSubmit: async (v) => {
      if (u) await api.put('/users/' + u.id, v);
      else await api.post('/users', v);
      toast('Staff saved');
      await load();
    },
  });
  if (u && u.id !== ctx.user.id) {
    const del = document.createElement('button');
    del.className = 'btn ghost danger-text';
    del.textContent = 'Delete account';
    del.style.marginRight = 'auto';
    m.$('.modal-foot').prepend(del);
    del.addEventListener(
      'click',
      guard(async () => {
        if (!(await confirmDialog(`Delete ${u.name}'s login permanently? Their past orders and bills are kept.`, { okLabel: 'Delete', danger: true }))) return;
        await api.del('/users/' + u.id);
        m.close();
        toast('Account deleted');
        await load();
      }),
    );
  }
}
