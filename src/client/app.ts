// Browser entry point: decides between the sign-in screen and the app, and wires live updates.
import type { AppCtx, Settings } from './core/types/app.js';
import type { Branding } from './core/theme.js';
import type { User } from './core/types/people.js';
import { api, auth, connectEvents, restaurant } from './core/api.js';
import { setCurrency } from './core/format.js';
import { closeDemo, renderDemoRibbon } from './shell/demo-ribbon.js';
import { installConnectionBanner } from './shell/connection.js';
import { leaveView, notifyView, startRouter } from './shell/router.js';
import { paintBrand, rememberBranding } from './shell/branding.js';
import { renderLayout, setLive, stopClock } from './shell/layout.js';
import { renderLogin } from './shell/login.js';

const app = document.getElementById('app')!;
let ctx: AppCtx;
let events: EventSource | null = null;

/** A demo tab arrives with ?demo_token=… in its address; keep it for this tab only and tidy the address */
function adoptDemoToken() {
  const m = /[?&]demo_token=([^&]+)/.exec(location.hash);
  if (!m) return;
  auth.useDemo(decodeURIComponent(m[1]!));
  history.replaceState(null, '', location.hash.replace(/[?&]demo_token=[^&]+/, ''));
}

async function boot() {
  adoptDemoToken();
  api.get<Branding>(`/branding?r=${encodeURIComponent(restaurant.get())}`).then(paintBrand).catch(() => {});
  if (!auth.token) return showLogin();
  try {
    const me = await api.get<{ user: User; settings: Settings; demo?: boolean }>('/auth/me');
    startApp(me.user, me.settings, !!me.demo);
  } catch {
    showLogin();
  }
}

function showLogin(message = '') {
  if (auth.isDemo) return closeDemo(); // signing out of the demo just leaves it
  events?.close();
  events = null;
  leaveView();
  stopClock();
  auth.clear();
  renderLogin(app, message, startApp);
}

function startApp(user: User, settings: Settings, demo = false) {
  setCurrency(settings.currency || '₹');
  rememberBranding(settings);
  ctx = {
    user,
    settings,
    demo,
    can: (roles) => roles.includes(user.role),
    refreshSettings(s) {
      ctx.settings = s;
      setCurrency(s.currency || '₹');
      paintBrand(s);
      const title = document.getElementById('page-title')?.textContent;
      if (title) document.title = `${title} · ${s.name}`;
    },
  };
  renderLayout(app, ctx, () => showLogin());
  if (demo) renderDemoRibbon();

  events?.close();
  events = connectEvents(onLiveEvent);
  if (events) {
    events.onopen = () => setLive(true);
    events.onerror = () => setLive(false);
  }
  startRouter(ctx);
}

function onLiveEvent(type: string) {
  if (type === 'settings') api.get<Settings>('/settings').then((s) => ctx.refreshSettings(s)).catch(() => {});
  notifyView(type);
}

window.addEventListener('auth:logout', () => showLogin('Your session ended. Please sign in again.'));
// After a dropped connection, catch up on anything other devices did meanwhile
installConnectionBanner(() => ['tables', 'orders', 'kot', 'menu'].forEach(notifyView));
boot();
