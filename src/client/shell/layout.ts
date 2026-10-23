// The signed-in frame: sidebar navigation, top bar with clock and user menu, and the live-sync indicator.
import type { AppCtx } from '../core/types/app.js';
import { $, $$, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { getDevicePref, setDevicePref, type ThemeMode } from '../core/theme.js';
import { currentLang, LANGUAGES, setLang, type Lang } from '../core/i18n.js';
import { dateLocale } from '../core/format.js';
import { UI_CONFIG } from '../config.js';
import { brandBlock } from './branding.js';
import { formModal, toast } from '../ui/index.js';
import { navFor } from './nav.js';
import { ROLE_GROUPS, ROLE_LABELS } from '../../shared/domain.js';

let clockTimer = 0;

export function renderLayout(app: HTMLElement, ctx: AppCtx, onSignOut: () => void) {
  const { user, settings } = ctx;
  let lastGroup: string | undefined;
  const links = navFor(user.role)
    .map((n) => {
      const head = n.group !== lastGroup && n.group ? `<div class="nav-group">${n.group}</div>` : '';
      lastGroup = n.group;
      return `${head}<a href="#/${n.id}" data-nav="${n.id}"><span class="nav-ic">${n.icon}</span>${n.label}</a>`;
    })
    .join('');

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        ${brandBlock(settings)}
        <nav>${links}</nav>
        <div class="sidebar-foot"><span class="live-dot" id="live-dot"></span><span id="live-text">Connecting…</span></div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">☰</button>
          <h1 id="page-title"></h1>
          <div class="top-actions">
            ${ctx.can(ROLE_GROUPS.SERVICE) ? '<a class="btn primary sm" href="#/pos?new=1">+ New Order</a>' : ''}
            <span class="clock" id="clock"></span>
            <div class="user-menu">
              <button class="user-chip" id="user-chip"><span class="avatar">${esc(user.name.charAt(0))}</span>
                <span class="user-meta"><b data-no-i18n>${esc(user.name)}</b><small>${ROLE_LABELS[user.role]}</small></span></button>
              <div class="dropdown" id="user-dd" hidden>
                <div class="dd-label">Appearance on this device</div>
                <button data-mode="">Restaurant default</button>
                <button data-mode="light">Light</button>
                <button data-mode="dark">Dark</button>
                <button data-mode="system">Match system</button>
                <div class="dd-label">Language on this device</div>
                ${LANGUAGES.map((l) => `<button data-lang="${l.code}" lang="${l.code}" data-no-i18n>${l.label}</button>`).join('')}
                <hr>
                <button data-act="password">Change password</button>
                <button data-act="switch">Switch restaurant</button>
                <button data-act="logout">Sign out</button>
              </div>
            </div>
          </div>
        </header>
        <main id="main"></main>
      </div>
    </div>`;

  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#sidebar nav').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  wireUserMenu(onSignOut);
  startClock();
}

function wireUserMenu(onSignOut: () => void) {
  const dd = $('#user-dd');
  $('#user-chip').addEventListener('click', (e) => {
    e.stopPropagation();
    dd.hidden = !dd.hidden;
    const pref = getDevicePref() || '';
    $$<HTMLButtonElement>('[data-mode]', dd).forEach((b) => b.classList.toggle('on', b.dataset.mode === pref));
    $$<HTMLButtonElement>('[data-lang]', dd).forEach((b) => b.classList.toggle('on', b.dataset.lang === currentLang()));
  });
  document.addEventListener('click', () => (dd.hidden = true));
  dd.addEventListener('click', async (e) => {
    const mode = (e.target as HTMLElement).dataset.mode;
    if (mode !== undefined) setDevicePref((mode || null) as ThemeMode | null);
    const pick = (e.target as HTMLElement).dataset.lang as Lang | undefined;
    if (pick && pick !== currentLang()) setLang(pick);
    const act = (e.target as HTMLElement).dataset.act;
    if (act === 'logout' || act === 'switch') {
      await api.post('/auth/logout').catch(() => {});
      location.hash = '';
      onSignOut();
    } else if (act === 'password') {
      formModal({
        title: 'Change password',
        size: 'sm',
        fields: [
          { name: 'current', label: 'Current password', type: 'password', required: true },
          { name: 'password', label: 'New password (min 6 chars)', type: 'password', required: true },
        ],
        onSubmit: async (v) => {
          await api.post('/auth/password', v);
          toast('Password updated');
        },
      });
    }
  });
}

function startClock() {
  const tick = () => {
    const c = document.getElementById('clock');
    if (c) c.textContent = new Date().toLocaleString(dateLocale(), { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, UI_CONFIG.timing.clockMs);
}
export const stopClock = () => clearInterval(clockTimer);

export function setLive(ok: boolean) {
  document.getElementById('live-dot')?.classList.toggle('on', ok);
  const t = document.getElementById('live-text');
  if (t) t.textContent = ok ? 'Live sync on' : 'Reconnecting…';
}
