// Owner tools inside Settings: start fresh, clear selected data, backups & restore.
import { api, download } from '../api.js';
import { $, $$, esc, fmtDate, fmtTime, fmtDateTime, money, modal, toast, guard, confirmDialog, today, badge } from '../ui.js';
import type { AppCtx, Settings } from '../types.js';

export interface DataSummary {
  demo: boolean;
  orders: number;
  open_orders: number;
  activity: number;
  customers: number;
  reservations: number;
  expenses: number;
  stock_moves: number;
  inventory: number;
  items: number;
  categories: number;
  areas: number;
  tables: number;
  staff: number;
}

export interface Health {
  healthy: boolean;
  db_size: number;
  data_dir: string;
  backup_dir: string;
  backups: number;
  newest_backup: { name: string; created: string } | null;
  interval_min: number;
  mirror: { dir: string | null; ok: boolean | null; at: string | null; error: string | null };
  started_at: string;
  recovery_note: string | null;
  warnings: string[];
}

interface DailyRow {
  day: string;
  orders: number;
  sales: number;
  backup: Backup | null;
  downloaded: { at: string; user_name: string } | null;
  accounts: string[];
}

interface Backup {
  name: string;
  size: number;
  created: string;
}

interface Scope {
  id: string;
  label: string;
  desc: string;
  n: (s: DataSummary) => string;
}

const SCOPES: Scope[] = [
  { id: 'orders', label: 'Orders & sales history', desc: 'All bills, KOTs and running orders. Invoice numbers restart from 1 and customer totals go back to zero.', n: (s) => `${s.orders} orders` },
  { id: 'customers', label: 'Customers', desc: 'All customer profiles and loyalty points.', n: (s) => `${s.customers} customers` },
  { id: 'reservations', label: 'Reservations', desc: 'All table bookings.', n: (s) => `${s.reservations} bookings` },
  { id: 'expenses', label: 'Expenses', desc: 'All recorded expenses.', n: (s) => `${s.expenses} entries` },
  { id: 'stock_history', label: 'Stock movement log', desc: 'Purchase, wastage and usage history. Current stock levels stay as they are.', n: (s) => `${s.stock_moves} movements` },
  { id: 'stock_levels', label: 'Stock levels to zero', desc: 'Keeps your raw materials but sets every quantity to 0, ready for a fresh count.', n: (s) => `${s.inventory} materials` },
  { id: 'inventory', label: 'Raw materials & recipes', desc: 'Deletes all raw materials, their recipes and history.', n: (s) => `${s.inventory} materials` },
  { id: 'menu', label: 'Menu', desc: 'All categories and dishes (with their variants and recipes).', n: (s) => `${s.categories} categories · ${s.items} items` },
  { id: 'floor', label: 'Floor areas & tables', desc: 'All dining areas and tables.', n: (s) => `${s.areas} areas · ${s.tables} tables` },
  { id: 'staff', label: 'Other staff logins', desc: 'Deletes every account except yours.', n: (s) => `${Math.max(0, s.staff - 1)} accounts` },
  { id: 'settings', label: 'Business & billing settings', desc: 'Address, phone, GSTIN, charges, invoice prefix and footer go back to blank defaults.', n: () => '' },
  { id: 'activity', label: 'Activity log & download history', desc: 'Who-did-what history for every account. Usually kept; clear it only to remove demo activity.', n: (s) => `${s.activity} entries` },
  { id: 'branding', label: 'Name, logo & theme', desc: 'Back to “My Restaurant”, no logo, default colour.', n: () => '' },
];

const sizeFmt = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
function backupKind(name: string): string {
  if (name.startsWith('before-reset')) return badge('Auto · before reset', 'warn');
  if (name.startsWith('before-restore')) return badge('Auto · before restore', 'info');
  if (name.startsWith('closing')) return badge('Closing', 'ok');
  if (name.startsWith('daily')) return badge('Daily', 'info');
  if (name.startsWith('before-delete')) return badge('Auto · before delete', 'warn');
  return badge('Manual', 'ok');
}

let ctx: AppCtx;
let dailyDays = 14;

export async function paintDataTab(body: HTMLElement, c: AppCtx) {
  ctx = c;
  const [s, backups, h, daily] = await Promise.all([
    api.get<DataSummary>('/admin/summary'),
    api.get<Backup[]>('/admin/backups'),
    api.get<Health>('/admin/health'),
    api.get<{ closing_time: string; days: DailyRow[] }>(`/admin/daily?days=${dailyDays}`),
  ]);
  const otherWarnings = h.warnings.filter((w) => w !== h.recovery_note);
  body.innerHTML = `
    <div class="card narrow">
      <div class="card-head"><h3>Data safety</h3>${h.healthy && !h.warnings.length ? badge('All protected', 'ok') : badge('Needs attention', 'danger')}</div>
      ${h.recovery_note ? `<div class="alert">${esc(h.recovery_note)} <button class="btn sm" data-d="dismiss-note">Got it</button></div>` : ''}
      ${otherWarnings.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      <ul class="safety-list">
        <li><span class="ic">✓</span><div><b>Every save goes to disk immediately</b><small>Bills, KOTs and stock changes are committed safely, so a crash or power cut doesn’t lose them.</small></div></li>
        <li><span class="ic ${h.healthy ? '' : 'bad'}">${h.healthy ? '✓' : '!'}</span><div class="grow"><b>Database check: ${h.healthy ? 'healthy' : 'problem found'}</b>
          <small>Checked on every start; a damaged file is replaced automatically from the newest good backup. Size ${sizeFmt(h.db_size)}.</small></div>
          <button class="btn sm" data-d="check">Run full check</button></li>
        <li><span class="ic">✓</span><div><b>Automatic backups</b>
          <small>Every ${h.interval_min} min when anything changes, a daily copy kept for 90 days, and before every delete, reset or restore. Each copy is verified after saving.</small>
          <small>Newest: ${h.newest_backup ? `${fmtDateTime(h.newest_backup.created)}` : 'none yet'} · ${h.backups} backups in <code>${esc(h.backup_dir)}</code></small></div></li>
        <li><span class="ic ${h.mirror.dir ? (h.mirror.ok === false ? 'bad' : '') : 'info'}">${h.mirror.dir ? (h.mirror.ok === false ? '!' : '✓') : 'i'}</span><div class="grow">
          <b>Copy backups to a second place</b>
          <small>If this computer’s disk fails, backups on it are lost too. Choose a USB drive or a folder synced by Google Drive / OneDrive / Dropbox on this computer.</small>
          ${h.mirror.dir ? `<small>${h.mirror.ok === false ? `<span class="danger-text">Last copy failed: ${esc(h.mirror.error)}</span>` : h.mirror.at ? `Last copied ${fmtDateTime(h.mirror.at)}` : 'Copies start with the next backup.'}</small>` : ''}
          <div class="mirror-row"><input id="mirror-dir" placeholder="e.g. /Volumes/USB/restaurant-backups  or  D:\\Backups" value="${esc(h.mirror.dir || '')}">
            <button class="btn sm primary" data-d="mirror-save">Save &amp; copy now</button>${h.mirror.dir ? '<button class="btn sm ghost" data-d="mirror-clear">Turn off</button>' : ''}</div></div></li>
        <li><span class="ic">✓</span><div><b>Automatic restart</b><small>If the server stops unexpectedly it saves a backup and restarts by itself within seconds (when started with <code>npm start</code>).</small></div></li>
        <li><span class="ic">✓</span><div><b>Unsent items are kept on each device</b><small>Items not yet sent to the kitchen survive a page refresh or dropped Wi-Fi, and re-sending after a dropped connection never creates duplicate KOTs or orders.</small></div></li>
      </ul>
    </div>

    <div class="card narrow">
      <div class="card-head"><h3>Daily closing backups</h3>
        <div class="actions"><label class="small muted">Closing time <input type="time" id="closing-time" value="${esc(daily.closing_time)}" class="inline-date"></label>
        <button class="btn sm" data-d="closing-save">Save</button></div></div>
      <p class="muted small">Every day at closing time a full backup is saved automatically. Download it to your phone, a USB drive or email it to yourself — the owner is reminded on the dashboard until it’s downloaded.</p>
      <table class="table compact"><thead><tr><th>Day</th><th class="num">Bills</th><th class="num">Sales</th><th>Accounts that worked</th><th>Backup</th><th>Downloaded</th><th></th></tr></thead><tbody>
        ${daily.days
          .map(
            (d) => `<tr><td class="nowrap"><b>${fmtDate(d.day)}</b></td><td class="num">${d.orders}</td><td class="num">${money(d.sales)}</td>
            <td class="small">${d.accounts.length ? esc(d.accounts.join(', ')) : '<span class="muted">—</span>'}</td>
            <td class="small">${d.backup ? `${backupKind(d.backup.name)} <span class="muted">${fmtTime(d.backup.created)}</span>` : '<span class="muted">none</span>'}</td>
            <td class="small">${d.downloaded ? `<span class="ok-text">✓ ${fmtDateTime(d.downloaded.at)}</span><div class="muted">by ${esc(d.downloaded.user_name)}</div>` : d.backup ? '<span class="danger-text">Not yet</span>' : ''}</td>
            <td class="actions-cell">${d.backup ? `<button class="btn ghost sm" data-dl="${esc(d.backup.name)}">⇩ Download</button>` : ''}</td></tr>`,
          )
          .join('')}
      </tbody></table>
      ${dailyDays < 90 ? '<button class="link mt" data-d="more-days">Show 90 days</button>' : ''}
    </div>

    ${s.demo ? `<div class="card banner"><div><b>You're looking at demo data.</b><p class="muted">Explore everything freely. When you're ready to run your own restaurant, start fresh — the demo is saved as a backup you can restore any time.</p></div>
      <button class="btn primary" data-d="fresh">Start fresh with my restaurant</button></div>` : ''}

    <div class="card narrow">
      <div class="card-head"><h3>Start fresh</h3></div>
      <p class="muted">Erase <b>everything</b> — orders, menu, tables, inventory, customers, staff, settings and branding — and keep only your own login. Then the <a class="link" href="#/setup">Getting started</a> guide walks you through setting up your restaurant.</p>
      <button class="btn danger" data-d="fresh">Erase everything and start fresh</button>
    </div>

    <div class="card narrow">
      <div class="card-head"><h3>Clear selected data</h3><span class="muted small">Pick only what you want to remove</span></div>
      ${s.open_orders ? `<div class="order-note">${s.open_orders} running order(s) right now. Clearing the menu or tables needs “Orders & sales” cleared too, or those orders settled first.</div>` : ''}
      <div class="scope-list">
        ${SCOPES.map((x) => `<label class="scope-row"><input type="checkbox" value="${x.id}"><span><b>${x.label}</b><small>${x.desc}</small></span><em>${x.n(s)}</em></label>`).join('')}
      </div>
      <div class="form-actions"><button class="btn danger" data-d="selected" disabled>Clear selected</button></div>
    </div>

    <div class="card narrow">
      <div class="card-head"><h3>Backups</h3>
        <div class="actions"><button class="btn sm" data-d="snapshot">+ Save backup now</button><button class="btn ghost sm" data-d="download">⇩ Download current data</button></div></div>
      <p class="muted small">A backup is saved automatically before every reset or restore. Restoring replaces all current data with the backup (your current data is backed up first).</p>
      ${backups.length
        ? `<table class="table compact"><thead><tr><th>Saved</th><th>Type</th><th class="num">Size</th><th></th></tr></thead><tbody>
          ${backups.map((b) => `<tr><td>${fmtDateTime(b.created)}</td><td>${backupKind(b.name)}</td><td class="num">${sizeFmt(b.size)}</td>
            <td class="actions-cell"><button class="btn sm" data-restore="${esc(b.name)}">Restore</button><button class="btn ghost sm" data-dl="${esc(b.name)}">⇩</button><button class="btn ghost sm danger-text" data-del="${esc(b.name)}">Delete</button></td></tr>`).join('')}
          </tbody></table>`
        : '<div class="muted small">No saved backups yet.</div>'}
      <h3 class="mt">Connect other devices</h3>
      <p class="muted small">Tablets and phones on the same Wi-Fi can open the address shown in the server window (e.g. <code>http://192.168.x.x:3000</code>). Use a Kitchen login on the kitchen screen and Captain logins on waiter phones.</p>
    </div>`;

  const boxes = $$<HTMLInputElement>('.scope-list input', body);
  const clearBtn = $<HTMLButtonElement>('[data-d=selected]', body);
  boxes.forEach((b) => b.addEventListener('change', () => (clearBtn.disabled = !boxes.some((x) => x.checked))));

  body.onclick = guard(async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.d === 'closing-save') {
      await api.put('/settings', { closing_time: $<HTMLInputElement>('#closing-time', body).value });
      toast('Closing time saved');
      await paintDataTab(body, ctx);
    } else if (d.d === 'more-days') {
      dailyDays = 90;
      await paintDataTab(body, ctx);
    } else if (d.d === 'dismiss-note') {
      await api.post('/admin/recovery-note/dismiss');
      await paintDataTab(body, ctx);
    } else if (d.d === 'check') {
      const r = await api.post<{ ok: boolean; problems: string[] }>('/admin/health/check');
      if (r.ok) toast('Full database check passed — no problems found');
      else toast(`Database problems found: ${r.problems.slice(0, 2).join('; ')} — restore the newest backup`, 'error');
    } else if (d.d === 'mirror-save' || d.d === 'mirror-clear') {
      const dir = d.d === 'mirror-clear' ? '' : $<HTMLInputElement>('#mirror-dir', body).value.trim();
      await api.put('/settings', { backup_mirror_dir: dir });
      if (dir) {
        await api.post('/admin/backups', { label: 'manual' });
        toast('Off-site folder saved and a backup copied there');
      } else toast('Off-site copies turned off');
      await paintDataTab(body, ctx);
    } else if (d.d === 'fresh') {
      await confirmReset({ everything: true }, s, () => (location.hash = '#/setup'));
    } else if (d.d === 'selected') {
      const scopes = boxes.filter((x) => x.checked).map((x) => x.value);
      await confirmReset({ scopes }, s, () => paintDataTab(body, ctx));
    } else if (d.d === 'snapshot') {
      await api.post('/admin/backups', { label: 'manual' });
      toast('Backup saved');
      await paintDataTab(body, ctx);
    } else if (d.d === 'download') {
      await download('/backup', `restaurant-backup-${today()}.db`);
    } else if (d.dl) {
      await download('/admin/backups/' + encodeURIComponent(d.dl), d.dl);
      toast('Backup downloaded — keep it somewhere safe');
      await paintDataTab(body, ctx);
    } else if (d.del) {
      if (!(await confirmDialog('Delete this backup file permanently?', { okLabel: 'Delete', danger: true }))) return;
      await api.del('/admin/backups/' + encodeURIComponent(d.del));
      await paintDataTab(body, ctx);
    } else if (d.restore) {
      await confirmRestore(d.restore);
    }
  });
}

/** Typed-confirmation + password dialog shared by Settings and the Getting started page */
export function confirmReset(req: { everything?: boolean; scopes?: string[] }, s: DataSummary | null, onDone: () => void): Promise<void> {
  return new Promise((resolve) => {
    const chosen = req.everything ? SCOPES : SCOPES.filter((x) => req.scopes?.includes(x.id));
    const m = modal({
      title: req.everything ? 'Erase everything and start fresh?' : 'Clear selected data?',
      onClose: () => resolve(),
      body: `<p>This permanently removes:</p>
        <ul class="reset-list">${chosen.map((x) => `<li><b>${x.label}</b>${s && x.n(s) ? ` <span class="muted">(${x.n(s)})</span>` : ''}</li>`).join('')}</ul>
        ${req.everything ? '<p class="muted small">Your own login is kept. Default currency and tax options are restored.</p>' : ''}
        <div class="order-note">A full backup is saved automatically first, so you can undo this from Settings → Data, reset &amp; backup.</div>
        <form id="rs" class="form-grid mt">
          <div class="field half"><label>Type <b>RESET</b> to confirm</label><input name="confirm" autocomplete="off" required></div>
          <div class="field half"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>
        </form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rs-go">${req.everything ? 'Erase everything' : 'Clear selected'}</button>`,
    });
    const form = m.$<HTMLFormElement>('#rs');
    const go = guard(async () => {
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const res = await api.post<{ backup: string; settings: Settings }>('/admin/reset', { ...req, confirm: fd.get('confirm'), password: fd.get('password') });
      ctx?.refreshSettings(res.settings);
      m.close();
      toast(req.everything ? 'All data erased — let’s set up your restaurant' : 'Selected data cleared');
      onDone();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go();
    });
    m.$('#rs-go').addEventListener('click', () => go());
  });
}

export function setDataCtx(c: AppCtx) {
  ctx = c;
}

function confirmRestore(name: string): Promise<void> {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Restore this backup?',
      size: 'sm',
      onClose: () => resolve(),
      body: `<p>All current data will be replaced with the backup <code>${esc(name)}</code>. Your current data is backed up first.</p>
        <p class="muted small">If your login doesn't exist in that backup you'll be signed out — sign in with an account from the backup.</p>
        <div class="field"><label>Your password</label><input type="password" id="rp" autocomplete="current-password"></div>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rp-go">Restore</button>`,
    });
    m.$('#rp-go').addEventListener(
      'click',
      guard(async () => {
        await api.post(`/admin/backups/${encodeURIComponent(name)}/restore`, { password: m.$<HTMLInputElement>('#rp').value });
        m.close();
        toast('Backup restored — reloading');
        setTimeout(() => location.reload(), 700);
      }),
    );
  });
}
