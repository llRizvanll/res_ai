import { api } from '../api.js';
import { printKot } from '../print.js';
import { $, $$, esc, elapsed, minutesSince, label, ORDER_TYPES, modal, toast, guard, vegDot, fmtTime } from '../ui.js';
import type { AppCtx, Kot, Menu } from '../types.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let kots: Kot[] = [];
let knownIds = new Set<number>();
let sound = true;

const COLUMNS: { status: Kot['status']; title: string; next?: Kot['status']; action?: string }[] = [
  { status: 'new', title: 'New', next: 'preparing', action: 'Start cooking' },
  { status: 'preparing', title: 'Preparing', next: 'ready', action: 'Mark ready' },
  { status: 'ready', title: 'Ready to serve', next: 'served', action: 'Served' },
];

export async function render(el: HTMLElement, _p: Record<string, string>, c: AppCtx) {
  ctx = c;
  try {
    sound = localStorage.getItem('kds_sound') !== '0';
  } catch {
    /* default on */
  }
  el.innerHTML = `
    <div class="kds">
      <div class="kds-bar">
        <div class="stats-inline" id="kds-stats"></div>
        <div class="actions">
          <button class="btn ghost sm" id="kds-sound"></button>
          ${ctx.can(['admin', 'manager', 'kitchen']) ? '<button class="btn sm" id="kds-avail">Item availability</button>' : ''}
          <button class="btn ghost sm" id="kds-full">⛶ Full screen</button>
        </div>
      </div>
      <div class="kds-cols" id="kds-cols"></div>
    </div>`;
  root = $('.kds', el);
  const soundBtn = $('#kds-sound', root);
  const paintSound = () => (soundBtn.textContent = sound ? '🔔 Sound on' : '🔕 Sound off');
  paintSound();
  soundBtn.addEventListener('click', () => {
    sound = !sound;
    try {
      localStorage.setItem('kds_sound', sound ? '1' : '0');
    } catch {
      /* ignore */
    }
    paintSound();
  });
  $('#kds-full', root).addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root?.requestFullscreen?.();
  });
  root.querySelector('#kds-avail')?.addEventListener('click', openAvailability);
  root.addEventListener('click', onClick);
  knownIds = new Set();
  await load(true);
  const t = window.setInterval(() => load(), 20000);
  return () => clearInterval(t);
}

export function onEvent(type: string) {
  if (root?.isConnected && (type === 'kot' || type === 'orders' || type === 'tables')) load();
}

async function load(first = false) {
  if (!root) return;
  kots = await api.get<Kot[]>('/kots');
  const fresh = kots.filter((k) => !knownIds.has(k.id));
  if (!first && fresh.some((k) => k.status === 'new')) beep();
  knownIds = new Set(kots.map((k) => k.id));
  paint();
}

function paint() {
  if (!root) return;
  const count = (s: string) => kots.filter((k) => k.status === s).length;
  $('#kds-stats', root).innerHTML = `<span><b>${count('new')}</b> new</span><span><b>${count('preparing')}</b> cooking</span><span><b>${count('ready')}</b> ready</span>`;
  $('#kds-cols', root).innerHTML = COLUMNS.map((col) => {
    const list = kots.filter((k) => k.status === col.status);
    return `<div class="kds-col ${col.status}"><h3>${col.title} <span>${list.length}</span></h3>
      <div class="kds-list">${list.map((k) => card(k, col)).join('') || '<div class="kds-empty">Nothing here</div>'}</div></div>`;
  }).join('');
}

function card(k: Kot, col: (typeof COLUMNS)[number]): string {
  const mins = minutesSince(k.created_at);
  const urgency = mins >= 25 ? 'late' : mins >= 15 ? 'warn' : '';
  return `<article class="kot-card ${urgency}">
    <header><div><b class="kot-no">#${k.kot_no}</b> <span class="kot-where">${k.table_name ? esc(k.table_name) : esc(label(ORDER_TYPES, k.type))}</span></div>
      <span class="kot-time" title="Received ${fmtTime(k.created_at)}">⏱ ${elapsed(k.created_at)}</span></header>
    <div class="kot-sub">${esc(k.order_no)} · ${esc(label(ORDER_TYPES, k.type))}${k.created_by_name ? ` · ${esc(k.created_by_name)}` : ''}</div>
    <ul>${k.items
      .map(
        (i) => `<li class="${i.cancelled ? 'void' : ''}"><b>${i.qty}×</b> <span>${esc(i.name)}${i.variant ? ` <small>(${esc(i.variant)})</small>` : ''}
        ${i.notes ? `<em>» ${esc(i.notes)}</em>` : ''}${i.cancelled ? '<em>VOID</em>' : ''}</span></li>`,
      )
      .join('')}</ul>
    ${k.order_notes ? `<div class="kot-note">Note: ${esc(k.order_notes)}</div>` : ''}
    <footer>
      <button class="btn ghost sm" data-print="${k.id}" title="Print KOT">⎙</button>
      ${col.status !== 'new' ? `<button class="btn ghost sm" data-back="${k.id}" title="Move back">↩</button>` : ''}
      <button class="btn ${col.status === 'ready' ? 'ok' : 'primary'} sm grow" data-next="${k.id}" data-to="${col.next}">${col.action}</button>
    </footer>
  </article>`;
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.next) {
    await api.patch(`/kots/${b.dataset.next}`, { status: b.dataset.to });
    await load();
  } else if (b.dataset.back) {
    const k = kots.find((x) => x.id === Number(b.dataset.back))!;
    const prev = k.status === 'ready' ? 'preparing' : 'new';
    await api.patch(`/kots/${k.id}`, { status: prev });
    await load();
  } else if (b.dataset.print) {
    printKot(kots.find((x) => x.id === Number(b.dataset.print))!, ctx.settings);
  }
});

function beep() {
  if (!sound) return;
  try {
    const ac = new AudioContext();
    [0, 0.25].forEach((t) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.2);
    });
  } catch {
    /* audio blocked until user interacts */
  }
}

async function openAvailability() {
  const menu = await api.get<Menu>('/menu');
  const m = modal({
    title: 'Item availability',
    size: 'lg',
    body: `<p class="muted small">Switch off dishes that have run out. Billing screens update instantly.</p>
      <input type="search" id="av-q" placeholder="Search…" class="mb">
      <div class="avail-list">${menu.categories
        .map((c) => {
          const items = menu.items.filter((i) => i.category_id === c.id);
          return items.length
            ? `<h4>${esc(c.name)}</h4>${items
                .map(
                  (i) => `<label class="avail-row" data-name="${esc(i.name.toLowerCase())}">${vegDot(i.veg)} <span>${esc(i.name)}</span>
                  <input type="checkbox" class="switch" data-id="${i.id}" ${i.available ? 'checked' : ''}></label>`,
                )
                .join('')}`
            : '';
        })
        .join('')}</div>`,
  });
  m.$<HTMLInputElement>('#av-q').addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    $$<HTMLElement>('.avail-row', m.el).forEach((r) => (r.hidden = !r.dataset.name!.includes(q)));
  });
  $$<HTMLInputElement>('[data-id]', m.el).forEach((cb) =>
    cb.addEventListener('change', async () => {
      try {
        await api.patch(`/items/${cb.dataset.id}/availability`, { available: cb.checked });
        toast(cb.checked ? 'Marked available' : 'Marked out of stock');
      } catch (err) {
        cb.checked = !cb.checked;
        toast((err as Error).message, 'error');
      }
    }),
  );
}
