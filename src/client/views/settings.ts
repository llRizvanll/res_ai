import { api, auth } from '../api.js';
import { $, $$, esc, readForm, toast, guard, formModal, modal, confirmDialog, emptyState, type Field } from '../ui.js';
import { paintDataTab } from './data-tools.js';
import { applyBranding, logoHTML, readLogoFile, DEFAULT_COLOR, type Branding } from '../theme.js';
import type { AppCtx, Area, DiningTable, FloorData, Settings } from '../types.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let tab: 'branding' | 'profile' | 'billing' | 'floor' | 'data' | 'restaurants' = 'branding';
let draft: Branding = {};

const SWATCHES: [string, string][] = [
  ['#e8590c', 'Saffron'], ['#e03131', 'Chilli red'], ['#c2255c', 'Beetroot'], ['#7048e8', 'Plum'], ['#1971c2', 'Ocean'],
  ['#0c8599', 'Teal'], ['#2f9e44', 'Mint'], ['#5c940d', 'Olive'], ['#f08c00', 'Turmeric'], ['#795548', 'Coffee'], ['#343a40', 'Charcoal'],
];

const PROFILE: Field[] = [
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

export async function render(el: HTMLElement, params: Record<string, string>, c: AppCtx) {
  ctx = c;
  if (['branding', 'profile', 'billing', 'floor', 'data', 'restaurants'].includes(params.tab || '')) tab = params.tab as typeof tab;
  el.innerHTML = `
    <div class="page settings">
      <div class="tabs">
        <button data-tab="branding">Branding &amp; theme</button><button data-tab="profile">Business details</button><button data-tab="billing">Billing &amp; tax</button>
        <button data-tab="floor">Floor &amp; tables</button><button data-tab="data">Data, reset &amp; backup</button><button data-tab="restaurants">Restaurants</button>
      </div>
      <div id="s-body"></div>
    </div>`;
  root = $('.settings', el);
  root.addEventListener('click', onClick);
  await paint();
  // Unsaved colour/logo previews must not leak into other screens
  return () => applyBranding(ctx.settings);
}

export function onEvent(type: string) {
  if (root?.isConnected && type === 'tables' && tab === 'floor') paint();
}

async function paint() {
  root!.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#s-body', root!);
  applyBranding(ctx.settings);
  if (tab === 'branding') {
    const s = await api.get<Settings>('/settings');
    draft = { name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color || DEFAULT_COLOR, theme_mode: s.theme_mode || 'light' };
    paintBranding(body);
  } else if (tab === 'profile' || tab === 'billing') {
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
  } else if (tab === 'restaurants') {
    await paintRestaurants(body);
  } else {
    await paintDataTab(body, ctx);
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
  } else if (tab === 'branding' && (d.color || d.modePick || d.b)) {
    await onBrandingClick(b);
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

function paintBranding(body: HTMLElement) {
  const color = draft.theme_color || DEFAULT_COLOR;
  const custom = !SWATCHES.some(([c]) => c.toLowerCase() === color.toLowerCase());
  body.innerHTML = `<div class="card narrow">
    <div class="brand-preview" id="b-preview"></div>
    <form id="b-form" class="form-grid" autocomplete="off">
      <div class="field half"><label>Restaurant name</label><input name="name" required maxlength="60" value="${esc(draft.name)}"></div>
      <div class="field half"><label>Tagline <small class="muted">(optional)</small></label><input name="tagline" maxlength="60" value="${esc(draft.tagline)}" placeholder="e.g. Family Restaurant"></div>
      <div class="field"><label>Logo</label>
        <div class="logo-drop">
          <div id="b-logo"></div>
          <label class="btn"><input type="file" id="b-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>⇧ Upload logo</label>
          ${draft.logo ? '<button type="button" class="btn ghost danger-text" data-b="remove-logo">Remove logo</button>' : ''}
          <small class="muted">PNG, JPG, WebP or SVG. Square images look best; large images are resized automatically.</small>
        </div></div>
      <div class="field"><label>Brand colour</label>
        <div class="swatches">
          ${SWATCHES.map(([c, n]) => `<button type="button" class="swatch ${c.toLowerCase() === color.toLowerCase() ? 'on' : ''}" style="background:${c}" data-color="${c}" title="${n}" aria-label="${n}"></button>`).join('')}
          <label class="muted small" title="Pick any colour">Custom <input type="color" id="b-color" value="${esc(color)}" ${custom ? 'class="on"' : ''}></label>
        </div></div>
      <div class="field"><label>Default appearance <small class="muted">(each device can override it from the user menu, top right)</small></label>
        <div class="mode-cards">
          ${(['light', 'dark', 'system'] as const).map((m) => `<button type="button" class="mode-card ${draft.theme_mode === m ? 'on' : ''}" data-mode-pick="${m}"><i class="${m}"></i>${m === 'system' ? 'Match device' : m[0]!.toUpperCase() + m.slice(1)}</button>`).join('')}
        </div></div>
    </form>
    <div class="form-actions"><button class="btn ghost" data-b="reset">Discard changes</button><button class="btn primary" data-b="save">Save branding</button></div>
    <p class="muted small">The name and logo appear on the sign-in screen, sidebar, browser tab and printed bills. The colour changes buttons, highlights and charts for everyone.</p>
  </div>`;
  const preview = () => {
    $('#b-preview', body).innerHTML = `${logoHTML(draft)}<div><b>${esc(draft.name || 'Restaurant name')}</b><small>${esc(draft.tagline || '')}</small></div>`;
    $('#b-logo', body).innerHTML = logoHTML(draft);
    applyBranding({ ...ctx.settings, ...draft }, false);
  };
  preview();
  const form = $<HTMLFormElement>('#b-form', body);
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'name' || t.name === 'tagline') draft[t.name] = t.value;
    if (t.id === 'b-color') {
      draft.theme_color = t.value;
      $$('.swatch', body).forEach((x) => x.classList.remove('on'));
    }
    preview();
  });
  $('#b-file', body).addEventListener(
    'change',
    guard(async () => {
      const input = $<HTMLInputElement>('#b-file', body);
      const file = input.files?.[0];
      if (!file) return;
      draft.logo = await readLogoFile(file);
      paintBranding(body);
      toast('Logo ready — click Save branding to apply', 'info');
    }),
  );
}

async function onBrandingClick(b: HTMLElement) {
  const body = $('#s-body', root!);
  const d = b.dataset;
  if (d.color) {
    draft.theme_color = d.color;
    paintBranding(body);
  } else if (d.modePick) {
    draft.theme_mode = d.modePick;
    paintBranding(body);
  } else if (d.b === 'remove-logo') {
    draft.logo = '';
    paintBranding(body);
  } else if (d.b === 'reset') {
    await paint();
  } else if (d.b === 'save') {
    const form = $<HTMLFormElement>('#b-form', body);
    if (!form.reportValidity()) return;
    const saved = await api.put<Settings>('/settings', {
      name: (draft.name || '').trim(), tagline: (draft.tagline || '').trim(), logo: draft.logo || '',
      theme_color: draft.theme_color, theme_mode: draft.theme_mode,
    });
    ctx.refreshSettings(saved);
    toast('Branding saved for all devices');
  }
}

// ---------------------------------------------------------------- restaurants / branches
interface RestaurantInfo {
  slug: string;
  name: string;
  tagline: string;
  logo: string;
}
const currentSlug = () => (auth.token && auth.token.includes('.') ? auth.token.split('.')[0]! : 'main');

async function paintRestaurants(body: HTMLElement) {
  const list = await api.get<RestaurantInfo[]>('/restaurants');
  const me = currentSlug();
  body.innerHTML = `
    <div class="card narrow">
      <div class="card-head"><h3>Restaurants on this system</h3></div>
      <p class="muted small">Each restaurant (or branch) is completely separate: its own staff logins, menu, tables, stock, customers, reports, activity log and backups. Staff choose the restaurant on the sign-in screen.</p>
      <table class="table compact"><thead><tr><th>Restaurant</th><th>Code</th><th></th></tr></thead><tbody>
        ${list.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.tagline ? `<div class="muted small">${esc(r.tagline)}</div>` : ''}</td><td><code>${esc(r.slug)}</code></td>
          <td>${r.slug === me ? '<span class="badge ok">You are here</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card narrow">
      <div class="card-head"><h3>Add a restaurant or branch</h3></div>
      <form id="new-rest" class="form-grid" autocomplete="off">
        <div class="field half"><label>Restaurant name</label><input name="name" required maxlength="60" placeholder="e.g. Spice Garden – Koramangala"></div>
        <div class="field half"><label>Code <small class="muted">(optional, used internally)</small></label><input name="slug" maxlength="30" placeholder="e.g. koramangala"></div>
        <div class="field half"><label>Owner / admin name</label><input name="admin_name" required maxlength="60"></div>
        <div class="field half"><label>Admin username</label><input name="username" required maxlength="30" pattern="[a-zA-Z0-9._-]{3,30}"></div>
        <div class="field half"><label>Admin password</label><input name="password" type="password" required minlength="6" maxlength="100" autocomplete="new-password"></div>
        <div class="field half"><label>Start with</label><select name="content">
          <option value="empty">Empty — set everything up myself</option>
          <option value="sample">Sample menu, tables &amp; stock (no sales)</option>
          <option value="demo">Full demo with 30 days of sample sales</option></select></div>
      </form>
      <div class="form-actions"><button class="btn primary" data-r="create">Create restaurant</button></div>
    </div>
    ${me !== 'main' ? `<div class="card narrow">
      <div class="card-head"><h3 class="danger-text">Remove this restaurant</h3></div>
      <p class="muted small">Takes <b>${esc(list.find((r) => r.slug === me)?.name || me)}</b> off the sign-in list. Nothing is deleted: its whole folder (data and backups) is moved to <code>data/archived/</code> and can be brought back by an administrator.</p>
      <button class="btn danger" data-r="archive">Remove this restaurant…</button>
    </div>` : ''}`;

  body.onclick = guard(async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!b) return;
    if (b.dataset.r === 'create') {
      const form = $<HTMLFormElement>('#new-rest', body);
      if (!form.reportValidity()) return;
      const r = await api.post<RestaurantInfo>('/restaurants', Object.fromEntries(new FormData(form)));
      toast(`“${r.name}” created. Sign in to it by choosing it on the sign-in screen.`);
      await paintRestaurants(body);
    } else if (b.dataset.r === 'archive') {
      const name = list.find((r) => r.slug === me)?.name || '';
      const m = modal({
        title: 'Remove this restaurant?',
        size: 'sm',
        body: `<p>Type the restaurant name <b>${esc(name)}</b> and your password to confirm. Everyone signed in to it will be signed out.</p>
          <div class="field"><label>Restaurant name</label><input id="ar-name" autocomplete="off"></div>
          <div class="field"><label>Your password</label><input id="ar-pw" type="password" autocomplete="current-password"></div>`,
        footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="ar-go">Remove</button>',
      });
      m.$('#ar-go').addEventListener(
        'click',
        guard(async () => {
          await api.post('/restaurants/current/archive', { confirm: m.$<HTMLInputElement>('#ar-name').value, password: m.$<HTMLInputElement>('#ar-pw').value });
          m.close();
          toast('Restaurant removed and archived');
          auth.clear();
          setTimeout(() => location.reload(), 800);
        }),
      );
    }
  });
}
