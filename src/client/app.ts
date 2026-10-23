import { api, auth, connectEvents, restaurant } from './api.js';
import { $, $$, esc, formModal, setCurrency, toast } from './ui.js';
import { applyBranding, cachedBranding, getDevicePref, logoHTML, setDevicePref, type Branding, type ThemeMode } from './theme.js';
import type { AppCtx, Role, Settings, User, ViewModule } from './types.js';

const ALL: Role[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];
const SERVICE: Role[] = ['admin', 'manager', 'cashier', 'waiter'];
const FRONT: Role[] = ['admin', 'manager', 'cashier'];
const MGR: Role[] = ['admin', 'manager'];

interface NavItem {
  id: string;
  label: string;
  icon: string;
  roles: Role[];
  load: () => Promise<ViewModule>;
  group?: string;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◧', roles: FRONT, load: () => import('./views/dashboard.js') },
  { id: 'pos', label: 'Billing / POS', icon: '⊞', roles: SERVICE, load: () => import('./views/pos.js') },
  { id: 'tables', label: 'Tables', icon: '▦', roles: SERVICE, load: () => import('./views/tables.js') },
  { id: 'kds', label: 'Kitchen Display', icon: '♨', roles: ALL, load: () => import('./views/kds.js') },
  { id: 'orders', label: 'Orders', icon: '≡', roles: SERVICE, load: () => import('./views/orders.js') },
  { id: 'reservations', label: 'Reservations', icon: '◷', roles: SERVICE, load: () => import('./views/reservations.js') },
  { id: 'customers', label: 'Customers', icon: '☺', roles: FRONT, load: () => import('./views/customers.js'), group: 'Manage' },
  { id: 'menu', label: 'Menu', icon: '☰', roles: MGR, load: () => import('./views/menu.js'), group: 'Manage' },
  { id: 'inventory', label: 'Inventory', icon: '▤', roles: MGR, load: () => import('./views/inventory.js'), group: 'Manage' },
  { id: 'pnl', label: 'Profit & Loss', icon: '₹', roles: MGR, load: () => import('./views/pnl.js'), group: 'Manage' },
  { id: 'insights', label: 'Growth & insights', icon: '↗', roles: MGR, load: () => import('./views/insights.js'), group: 'Manage' },
  { id: 'expenses', label: 'Expenses', icon: '⊖', roles: MGR, load: () => import('./views/expenses.js'), group: 'Manage' },
  { id: 'reports', label: 'Reports', icon: '◔', roles: MGR, load: () => import('./views/reports.js'), group: 'Manage' },
  { id: 'activity', label: 'Activity log', icon: '☷', roles: ['admin'], load: () => import('./views/activity.js'), group: 'Admin' },
  { id: 'setup', label: 'Getting started', icon: '✓', roles: ['admin'], load: () => import('./views/setup.js'), group: 'Admin' },
  { id: 'staff', label: 'Staff & Roles', icon: '⚇', roles: ['admin'], load: () => import('./views/staff.js'), group: 'Admin' },
  { id: 'settings', label: 'Settings', icon: '⚙', roles: ['admin'], load: () => import('./views/settings.js'), group: 'Admin' },
];

const ROLE_LABEL: Record<Role, string> = { admin: 'Owner / Admin', manager: 'Manager', cashier: 'Cashier', waiter: 'Captain / Waiter', kitchen: 'Kitchen' };

const app = document.getElementById('app')!;
let ctx: AppCtx;
let events: EventSource | null = null;
let current: { mod: ViewModule | null; cleanup: (() => void) | null } = { mod: null, cleanup: null };
let routeSeq = 0;
let clockTimer = 0;
let branding: Branding = cachedBranding();
applyBranding(branding, false);

function brandBlock(b: Branding, big = false): string {
  return `<div class="brand${big ? ' big' : ''}" data-brand>${logoHTML(b)}<div><b>${esc(b.name || 'Restaurant')}</b>${b.tagline ? `<small>${esc(b.tagline)}</small>` : ''}</div></div>`;
}

/** Re-renders every brand block on screen (login art, sidebar) and the colours */
function paintBrand(b: Branding) {
  branding = b;
  applyBranding(b);
  document.querySelectorAll<HTMLElement>('[data-brand]').forEach((el) => (el.outerHTML = brandBlock(b, el.classList.contains('big'))));
}

function homeFor(role: Role): string {
  return role === 'kitchen' ? 'kds' : role === 'waiter' ? 'tables' : 'dashboard';
}

interface RestaurantInfo extends Branding {
  slug: string;
}
let restaurants: RestaurantInfo[] = [];

async function boot() {
  api.get<Branding>(`/branding?r=${encodeURIComponent(restaurant.get())}`).then(paintBrand).catch(() => {});
  if (!auth.token) return showLogin();
  try {
    const me = await api.get<{ user: User; settings: Settings }>('/auth/me');
    startApp(me.user, me.settings);
  } catch {
    showLogin();
  }
}

function showLogin(message = '') {
  events?.close();
  events = null;
  current.cleanup?.();
  current = { mod: null, cleanup: null };
  clearInterval(clockTimer);
  auth.clear();
  app.innerHTML = `
    <div class="login">
      <div class="login-art">
        ${brandBlock(branding, true)}
        <h2>Run your whole restaurant from one browser tab.</h2>
        <ul>
          <li>Fast billing for dine-in, takeaway &amp; delivery</li>
          <li>Live table floor and kitchen display (KOT)</li>
          <li>Menu, inventory with recipe auto-deduction, CRM</li>
          <li>Sales, item, tax &amp; expense reports</li>
        </ul>
      </div>
      <form class="login-card" id="login-form">
        <h1>Sign in</h1>
        <p class="muted">Use your staff username and password.</p>
        <div class="field" id="rest-field" hidden><label for="lr">Restaurant</label><select id="lr" name="restaurant"></select></div>
        ${message ? `<div class="alert">${esc(message)}</div>` : ''}
        <div class="field"><label for="lu">Username</label><input id="lu" name="username" autocomplete="username" required autofocus></div>
        <div class="field"><label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary block" type="submit">Sign in</button>
        <details class="demo-logins"><summary>Demo accounts</summary>
          <div class="demo-grid">
            ${[['admin', 'admin123', 'Owner'], ['manager', 'manager123', 'Manager'], ['cashier', 'cashier123', 'Cashier'], ['waiter', 'waiter123', 'Captain'], ['kitchen', 'kitchen123', 'Kitchen']]
              .map(([u, p, r]) => `<button type="button" class="chip" data-u="${u}" data-p="${p}">${r}</button>`)
              .join('')}
          </div>
        </details>
      </form>
    </div>`;
  const form = $<HTMLFormElement>('#login-form');
  // Several restaurants on this server: let staff pick theirs (remembered on this device)
  api
    .get<RestaurantInfo[]>('/restaurants')
    .then((list) => {
      restaurants = list;
      if (!list.some((r) => r.slug === restaurant.get())) restaurant.set('main');
      if (list.length < 2) return;
      const sel = $<HTMLSelectElement>('#lr');
      sel.innerHTML = list.map((r) => `<option value="${esc(r.slug)}" ${r.slug === restaurant.get() ? 'selected' : ''}>${esc(r.name || r.slug)}</option>`).join('');
      $('#rest-field').hidden = false;
      sel.addEventListener('change', () => {
        restaurant.set(sel.value);
        paintBrand(list.find((r) => r.slug === sel.value) || {});
      });
      paintBrand(list.find((r) => r.slug === restaurant.get()) || {});
    })
    .catch(() => {});
  $$<HTMLButtonElement>('[data-u]', form).forEach((b) =>
    b.addEventListener('click', () => {
      $<HTMLInputElement>('#lu').value = b.dataset.u!;
      $<HTMLInputElement>('#lp').value = b.dataset.p!;
      form.requestSubmit();
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = $<HTMLButtonElement>('button[type=submit]', form);
    btn.disabled = true;
    try {
      const r = await api.post<{ token: string; user: User }>('/auth/login', {
        restaurant: restaurant.get(),
        username: fd.get('username'),
        password: fd.get('password'),
      });
      auth.set(r.token);
      const me = await api.get<{ user: User; settings: Settings }>('/auth/me');
      if (!location.hash || location.hash === '#/') location.hash = '#/' + homeFor(me.user.role);
      startApp(me.user, me.settings);
    } catch (err) {
      toast((err as Error).message, 'error');
      btn.disabled = false;
    }
  });
}

function startApp(user: User, settings: Settings) {
  setCurrency(settings.currency || '₹');
  branding = settings;
  applyBranding(settings);
  ctx = {
    user,
    settings,
    can: (roles) => roles.includes(user.role),
    refreshSettings(s) {
      ctx.settings = s;
      setCurrency(s.currency || '₹');
      paintBrand(s);
      const title = document.getElementById('page-title')?.textContent;
      if (title) document.title = `${title} · ${s.name}`;
    },
  };
  const allowed = NAV.filter((n) => n.roles.includes(user.role));
  let lastGroup: string | undefined;
  const links = allowed
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
            ${ctx.can(SERVICE) ? '<a class="btn primary sm" href="#/pos?new=1">+ New Order</a>' : ''}
            <span class="clock" id="clock"></span>
            <div class="user-menu">
              <button class="user-chip" id="user-chip"><span class="avatar">${esc(user.name.charAt(0))}</span>
                <span class="user-meta"><b>${esc(user.name)}</b><small>${ROLE_LABEL[user.role]}</small></span></button>
              <div class="dropdown" id="user-dd" hidden>
                <div class="dd-label">Appearance on this device</div>
                <button data-mode="">Restaurant default</button>
                <button data-mode="light">Light</button>
                <button data-mode="dark">Dark</button>
                <button data-mode="system">Match system</button>
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
  const dd = $('#user-dd');
  $('#user-chip').addEventListener('click', (e) => {
    e.stopPropagation();
    dd.hidden = !dd.hidden;
    const pref = getDevicePref() || '';
    $$<HTMLButtonElement>('[data-mode]', dd).forEach((b) => b.classList.toggle('on', b.dataset.mode === pref));
  });
  document.addEventListener('click', () => (dd.hidden = true));
  dd.addEventListener('click', async (e) => {
    const mode = (e.target as HTMLElement).dataset.mode;
    if (mode !== undefined) setDevicePref((mode || null) as ThemeMode | null);
    const act = (e.target as HTMLElement).dataset.act;
    if (act === 'logout' || act === 'switch') {
      await api.post('/auth/logout').catch(() => {});
      location.hash = '';
      showLogin();
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

  const tick = () => {
    const c = document.getElementById('clock');
    if (c) c.textContent = new Date().toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, 15000);

  events?.close();
  events = connectEvents(onLiveEvent);
  if (events) {
    events.onopen = () => setLive(true);
    events.onerror = () => setLive(false);
  }
  window.onhashchange = route;
  route();
}

function setLive(ok: boolean) {
  document.getElementById('live-dot')?.classList.toggle('on', ok);
  const t = document.getElementById('live-text');
  if (t) t.textContent = ok ? 'Live sync on' : 'Reconnecting…';
}

function onLiveEvent(type: string) {
  if (type === 'settings') {
    api.get<Settings>('/settings').then((s) => ctx.refreshSettings(s)).catch(() => {});
  }
  current.mod?.onEvent?.(type);
}

async function route() {
  const seq = ++routeSeq;
  const [name = '', qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  const allowed = NAV.filter((n) => n.roles.includes(ctx.user.role));
  const view = allowed.find((n) => n.id === name);
  if (!view) {
    location.replace('#/' + homeFor(ctx.user.role));
    return;
  }
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view.id));
  $('#page-title').textContent = view.label;
  document.title = `${view.label} · ${ctx.settings.name || 'Restaurant'}`;
  current.cleanup?.();
  current = { mod: null, cleanup: null };
  const main = $('#main');
  main.className = `view-${view.id}`;
  main.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const mod = await view.load();
    if (seq !== routeSeq) return;
    current.mod = mod;
    const cleanup = await mod.render(main, params, ctx);
    if (seq !== routeSeq) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (e) {
    console.error(e);
    if (seq === routeSeq) main.innerHTML = `<div class="card"><div class="alert">Could not load this screen: ${esc((e as Error).message)}</div></div>`;
  }
}

window.addEventListener('auth:logout', () => showLogin('Your session ended. Please sign in again.'));

// Connection banner: staff must know when the server isn't receiving their work
const netBanner = document.createElement('div');
netBanner.className = 'net-banner';
netBanner.hidden = true;
netBanner.innerHTML = '<b>Connection to the server lost.</b> Don’t close this screen — unsent items are kept. Checking again…';
document.body.appendChild(netBanner);
let netTimer = 0;
window.addEventListener('net:down', () => {
  netBanner.hidden = false;
  clearInterval(netTimer);
  netTimer = window.setInterval(() => api.get('/branding').catch(() => {}), 4000); // success fires net:up
});
window.addEventListener('net:up', () => {
  if (netBanner.hidden) return;
  netBanner.hidden = true;
  clearInterval(netTimer);
  toast('Reconnected to the server');
  // Catch up on anything other devices did while we were offline
  for (const ev of ['tables', 'orders', 'kot', 'menu']) current.mod?.onEvent?.(ev);
});
boot();
