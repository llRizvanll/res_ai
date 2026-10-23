import { api, download } from '../api.js';
import { $, esc, readForm, toast, guard, formModal, confirmDialog, today, emptyState, type Field } from '../ui.js';
import type { AppCtx, Area, DiningTable, FloorData, Settings } from '../types.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let tab: 'profile' | 'billing' | 'floor' | 'data' = 'profile';

const PROFILE: Field[] = [
  { name: 'name', label: 'Restaurant name', required: true, half: true },
  { name: 'tagline', label: 'Tagline', half: true },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'phone', label: 'Phone', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'gstin', label: 'GSTIN', half: true },
  { name: 'fssai', label: 'FSSAI licence no.', half: true },
];

const BILLING: Field[] = [
  { name: 'currency', label: 'Currency symbol', half: true },
  { name: 'invoice_prefix', label: 'Invoice number prefix', half: true, hint: 'Applies to new orders' },
  { name: 'service_charge', label: 'Service charge % (dine-in)', type: 'number', step: '0.1', min: 0, half: true },
  { name: 'packaging_charge', label: 'Packaging charge (takeaway / delivery)', type: 'number', step: '0.01', min: 0, half: true },
  { name: 'loyalty_rate', label: 'Loyalty points per 100 spent', type: 'number', step: '0.1', min: 0, half: true },
  { name: 'round_off', label: 'Round off bill total', type: 'select', options: [['1', 'Yes — nearest rupee'], ['0', 'No']], half: true },
  { name: 'kot_auto_print', label: 'Auto-print KOT when sent', type: 'select', options: [['0', 'No'], ['1', 'Yes']], half: true },
  { name: 'bill_auto_print', label: 'Always print bill on settle', type: 'select', options: [['0', 'Ask (checkbox)'], ['1', 'Yes']], half: true },
  { name: 'invoice_footer', label: 'Bill footer message', type: 'textarea' },
];

export async function render(el: HTMLElement, _p: Record<string, string>, c: AppCtx) {
  ctx = c;
  el.innerHTML = `
    <div class="page settings">
      <div class="tabs">
        <button data-tab="profile">Restaurant profile</button><button data-tab="billing">Billing &amp; tax</button>
        <button data-tab="floor">Floor &amp; tables</button><button data-tab="data">Data &amp; backup</button>
      </div>
      <div id="s-body"></div>
    </div>`;
  root = $('.settings', el);
  root.addEventListener('click', onClick);
  await paint();
}

export function onEvent(type: string) {
  if (root?.isConnected && type === 'tables' && tab === 'floor') paint();
}

async function paint() {
  root!.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#s-body', root!);
  if (tab === 'profile' || tab === 'billing') {
    const s = await api.get<Settings>('/settings');
    const fields = tab === 'profile' ? PROFILE : BILLING;
    body.innerHTML = `<div class="card narrow"><form id="s-form" class="form-grid">${formFields(fields, s)}</form>
      <div class="form-actions"><button class="btn primary" id="s-save">Save changes</button></div>
      ${tab === 'billing' ? '<p class="muted small">Item-level GST rates are set per dish in Menu. Bills show CGST and SGST as equal halves.</p>' : ''}</div>`;
    $('#s-save', body).addEventListener(
      'click',
      guard(async () => {
        const form = $<HTMLFormElement>('#s-form', body);
        if (!form.reportValidity()) return;
        const saved = await api.put<Settings>('/settings', readForm(form, fields));
        ctx.refreshSettings(saved);
        toast('Settings saved');
      }),
    );
  } else if (tab === 'floor') {
    const f = await api.get<FloorData>('/tables');
    body.innerHTML = `
      <div class="toolbar"><span class="muted">Organise your dining areas and tables. Table names appear on KOTs and bills.</span><span class="grow"></span>
        <button class="btn primary" data-a="add-area">+ Add area</button></div>
      ${f.areas.length ? f.areas.map((a) => areaCard(a, f.tables.filter((t) => t.area_id === a.id))).join('') : emptyState('No areas yet')}`;
    (root as HTMLElement & { _floor?: FloorData })._floor = f;
  } else {
    body.innerHTML = `<div class="card narrow">
      <h3>Backup</h3>
      <p class="muted">Download a complete copy of your restaurant data (orders, menu, customers, inventory). Keep a backup at least once a week.</p>
      <button class="btn primary" data-a="backup">⇩ Download backup</button>
      <h3 class="mt">Restore</h3>
      <p class="muted small">To restore, stop the server and replace <code>data/restaurant.db</code> with a backup file, then start it again.</p>
      <h3 class="mt">Connect other devices</h3>
      <p class="muted small">Tablets and phones on the same Wi-Fi can open the address shown in the server window (e.g. <code>http://192.168.x.x:3000</code>). Use the Kitchen login on a kitchen screen and Captain logins on waiter phones.</p>
    </div>`;
  }
}

function formFields(fields: Field[], s: Settings) {
  // Reuse the shared form renderer through a throwaway container
  const tmp = document.createElement('div');
  tmp.innerHTML = fields
    .map((f) => {
      const v = s[f.name] ?? '';
      if (f.type === 'select') {
        return `<div class="field ${f.half ? 'half' : ''}"><label>${esc(f.label)}</label><select name="${f.name}">${f.options!.map(([o, l]) => `<option value="${o}" ${String(o) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="2">${esc(v)}</textarea></div>`;
      return `<div class="field ${f.half ? 'half' : ''}"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.required ? 'required' : ''} value="${esc(v)}">${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    })
    .join('');
  return tmp.innerHTML;
}

function areaCard(a: Area, tables: DiningTable[]) {
  return `<div class="card"><div class="card-head"><h3>${esc(a.name)} <small class="muted">${tables.length} tables · ${tables.reduce((x, t) => x + t.seats, 0)} seats</small></h3>
    <div><button class="btn ghost sm" data-edit-area="${a.id}">Rename</button><button class="btn ghost sm danger-text" data-del-area="${a.id}">Delete</button><button class="btn sm" data-add-table="${a.id}">+ Table</button></div></div>
    <div class="table-pick">${tables.map((t) => `<button class="chip lg" data-edit-table="${t.id}">${esc(t.name)}<small>${t.seats} seats${t.order_id ? ' • running' : ''}</small></button>`).join('') || '<span class="muted small">No tables yet</span>'}</div></div>`;
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  const floor = (root as HTMLElement & { _floor?: FloorData })._floor;
  if (d.tab) {
    tab = d.tab as typeof tab;
    await paint();
  } else if (d.a === 'backup') {
    await download('/backup', `dineflow-backup-${today()}.db`);
    toast('Backup downloaded');
  } else if (d.a === 'add-area' || d.editArea) {
    const a = floor?.areas.find((x) => x.id === Number(d.editArea));
    formModal({
      title: a ? 'Rename area' : 'New area',
      size: 'sm',
      values: a || { sort: (floor?.areas.length || 0) + 1 },
      fields: [{ name: 'name', label: 'Area name', required: true, placeholder: 'e.g. Rooftop, AC Hall' }, { name: 'sort', label: 'Display order', type: 'number' }],
      onSubmit: async (v) => {
        if (a) await api.put('/areas/' + a.id, v);
        else await api.post('/areas', v);
        await paint();
      },
    });
  } else if (d.delArea) {
    if (!(await confirmDialog('Delete this area and all its tables?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/areas/' + d.delArea);
    await paint();
  } else if (d.addTable || d.editTable) {
    const t = floor?.tables.find((x) => x.id === Number(d.editTable));
    const m = formModal({
      title: t ? `Edit table ${t.name}` : 'New table',
      size: 'sm',
      values: t || { area_id: Number(d.addTable), seats: 4, sort: (floor?.tables.length || 0) + 1 },
      fields: [
        { name: 'name', label: 'Table name / number', required: true, half: true },
        { name: 'seats', label: 'Seats', type: 'number', min: 1, half: true },
        { name: 'area_id', label: 'Area', type: 'select', options: (floor?.areas || []).map((a) => [a.id, a.name]), half: true },
        { name: 'sort', label: 'Display order', type: 'number', half: true },
      ],
      onSubmit: async (v) => {
        const body = { ...v, area_id: Number(v.area_id) };
        if (t) await api.put('/tables/' + t.id, body);
        else await api.post('/tables', body);
        await paint();
      },
    });
    if (t) {
      const del = document.createElement('button');
      del.className = 'btn ghost danger-text';
      del.textContent = 'Delete table';
      del.style.marginRight = 'auto';
      m.$('.modal-foot').prepend(del);
      del.addEventListener(
        'click',
        guard(async () => {
          await api.del('/tables/' + t.id);
          m.close();
          await paint();
        }),
      );
    }
  }
});
