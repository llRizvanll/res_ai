import { api } from '../api.js';
import { $, esc, money, fmtTime, fmtDateTime, today, addDays, downloadCSV, emptyState, badge } from '../ui.js';
import type { AppCtx, StaffUser } from '../types.js';

interface Entry {
  id: number;
  at: string;
  user_id: number | null;
  user_name: string | null;
  role: string | null;
  action: string;
  summary: string;
  amount: number | null;
  ip: string | null;
}
interface AccountDay {
  user_name: string;
  role: string | null;
  first_at: string;
  last_at: string;
  actions: number;
  logins: number;
  failed_logins: number;
  kots: number;
  bills: number;
  sales: number;
  voids: number;
  void_value: number;
  discounts: number;
  cancels: number;
  deletes: number;
}

const GROUPS: [string, string][] = [
  ['', 'All actions'], ['auth', 'Sign-ins'], ['order', 'Orders & bills'], ['order.void', 'Voids'], ['order.discount', 'Discounts'],
  ['order.cancel', 'Cancellations'], ['order.settle', 'Settlements'], ['kot', 'Kitchen'], ['menu', 'Menu'], ['inventory', 'Inventory'],
  ['customer', 'Customers'], ['expense', 'Expenses'], ['reservation', 'Reservations'], ['staff', 'Staff'], ['settings', 'Settings'],
  ['floor', 'Tables'], ['backup', 'Backups'], ['data', 'Resets'], ['restaurant', 'Restaurants'],
];

/** Colour hint so risky actions stand out when scanning */
function tone(action: string): string {
  if (/delete|reset|restore|cancel|void|login_failed/.test(action)) return 'danger';
  if (/discount|staff|settings|qty/.test(action)) return 'warn';
  if (/settle/.test(action)) return 'ok';
  return 'info';
}

let root: HTMLElement = document.createElement('div');
const f = { day: today(), from: today(), to: today(), user_id: '', action: '', q: '' };
let rows: Entry[] = [];

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  const staff = await api.get<StaffUser[]>('/users');
  el.innerHTML = `
    <div class="page activity">
      <div class="card">
        <div class="card-head"><h3>Accounts on <input type="date" id="a-day" value="${f.day}" class="inline-date"></h3>
          <div class="actions"><button class="btn ghost sm" data-shift="-1">‹ Previous day</button><button class="btn ghost sm" data-shift="1">Next day ›</button></div></div>
        <div id="a-summary"></div>
      </div>
      <div class="card flush">
        <div class="toolbar pad wrap">
          <label>From <input type="date" data-f="from" value="${f.from}"></label>
          <label>To <input type="date" data-f="to" value="${f.to}"></label>
          <select data-f="user_id"><option value="">All accounts</option>${staff.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select>
          <select data-f="action">${GROUPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <input type="search" data-f="q" placeholder="Search text…">
          <span class="grow"></span>
          <button class="btn ghost" id="a-csv">⇩ Export CSV</button>
        </div>
        <div id="a-list"></div>
      </div>
    </div>`;
  root = $('.activity', el);
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'a-day') {
      f.day = t.value || today();
      loadSummary();
    } else if (t.dataset.f && t.dataset.f !== 'q') {
      f[t.dataset.f as keyof typeof f] = t.value;
      loadList();
    }
  });
  let timer = 0;
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.f === 'q') {
      f.q = t.value.trim();
      clearTimeout(timer);
      timer = window.setTimeout(loadList, 250);
    }
  });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-shift]');
    if (!b) return;
    f.day = addDays(f.day, Number(b.dataset.shift));
    $<HTMLInputElement>('#a-day', root).value = f.day;
    loadSummary();
  });
  $('#a-csv', root).addEventListener('click', () =>
    downloadCSV(`activity-${f.from}-to-${f.to}.csv`, [
      ['When', 'Account', 'Role', 'Action', 'Details', 'Amount', 'Device IP'],
      ...rows.map((r) => [r.at, r.user_name, r.role, r.action, r.summary, r.amount, r.ip]),
    ]),
  );
  await Promise.all([loadSummary(), loadList()]);
}

export function onEvent(type: string) {
  if (root.isConnected && (type === 'orders' || type === 'kot')) {
    loadSummary();
    loadList();
  }
}

async function loadSummary() {
  const list = await api.get<AccountDay[]>(`/activity/summary?date=${f.day}`);
  $('#a-summary', root).innerHTML = list.length
    ? `<table class="table compact"><thead><tr><th>Account</th><th>Active</th><th class="num">Bills settled</th><th class="num">Sales</th><th class="num">KOTs</th>
        <th class="num">Voids</th><th class="num">Discounts</th><th class="num">Cancels</th><th class="num">Deletes</th><th class="num">Sign-ins</th></tr></thead><tbody>
      ${list
        .map(
          (a) => `<tr><td><b>${esc(a.user_name)}</b><div class="muted small">${esc(a.role || '')}</div></td>
          <td class="small">${fmtTime(a.first_at)} – ${fmtTime(a.last_at)}<div class="muted">${a.actions} actions</div></td>
          <td class="num">${a.bills}</td><td class="num"><b>${money(a.sales)}</b></td><td class="num">${a.kots}</td>
          <td class="num ${a.voids ? 'danger-text' : ''}">${a.voids}${a.voids ? `<div class="small">${money(a.void_value)}</div>` : ''}</td>
          <td class="num">${a.discounts}</td><td class="num ${a.cancels ? 'danger-text' : ''}">${a.cancels}</td><td class="num ${a.deletes ? 'danger-text' : ''}">${a.deletes}</td>
          <td class="num">${a.logins}${a.failed_logins ? ` <span class="danger-text small">(${a.failed_logins} failed)</span>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : emptyState('No activity on this day');
}

async function loadList() {
  const qs = new URLSearchParams(Object.entries({ from: f.from, to: f.to, user_id: f.user_id, action: f.action, q: f.q }).filter(([, v]) => v)).toString();
  rows = await api.get<Entry[]>('/activity?' + qs);
  $('#a-list', root).innerHTML = rows.length
    ? `<div class="scroll-y tall"><table class="table compact"><thead><tr><th>When</th><th>Account</th><th>Action</th><th>Details</th><th class="num">Amount</th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr><td class="nowrap">${fmtDateTime(r.at)}</td><td>${esc(r.user_name || '—')}<div class="muted small">${esc(r.role || '')}${r.ip ? ` · ${esc(r.ip)}` : ''}</div></td>
          <td>${badge(r.action.replace('.', ' · ').replace(/_/g, ' '), tone(r.action))}</td><td>${esc(r.summary)}</td>
          <td class="num">${r.amount != null ? money(r.amount) : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      ${rows.length >= 1000 ? '<p class="muted small pad">Showing the latest 1000 entries — narrow the dates or filters to see more.</p>' : ''}`
    : emptyState('Nothing recorded for these filters');
}
