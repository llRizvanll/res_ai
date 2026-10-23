// Sign-in screen, with a restaurant picker when the server hosts more than one restaurant.
import type { Branding } from '../core/theme.js';
import type { Settings } from '../core/types/app.js';
import type { User } from '../core/types/people.js';
import { $, $$, esc } from '../core/dom.js';
import { api, auth, restaurant } from '../core/api.js';
import { brandBlock, currentBranding, paintBrand } from './branding.js';
import { homeFor } from './nav.js';
import { toast } from '../ui/index.js';
import { currentLang, LANGUAGES, setLang, type Lang } from '../core/i18n.js';

interface RestaurantInfo extends Branding {
  slug: string;
}

const DEMO_LOGINS = [['admin', 'admin123', 'Owner'], ['manager', 'manager123', 'Manager'], ['cashier', 'cashier123', 'Cashier'], ['waiter', 'waiter123', 'Captain'], ['kitchen', 'kitchen123', 'Kitchen']];

export function renderLogin(app: HTMLElement, message: string, onSignedIn: (user: User, settings: Settings, demo?: boolean) => void) {
  app.innerHTML = `
    <div class="login">
      <div class="login-art">
        ${brandBlock(currentBranding(), true)}
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
            ${DEMO_LOGINS.map(([u, p, r]) => `<button type="button" class="chip" data-u="${u}" data-p="${p}">${r}</button>`).join('')}
          </div>
        </details>
        <div class="login-foot">
          <a class="login-tour" href="/">New here? Take the product tour →</a>
          <span class="login-lang" data-no-i18n>${LANGUAGES.map((l) => `<button type="button" class="${l.code === currentLang() ? 'on' : ''}" data-lang="${l.code}" lang="${l.code}">${l.label}</button>`).join('')}</span>
        </div>
      </form>
    </div>`;
  const form = $<HTMLFormElement>('#login-form');

  // Several restaurants on this server: let staff pick theirs (remembered on this device)
  api
    .get<RestaurantInfo[]>('/restaurants')
    .then((list) => {
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
  $$<HTMLButtonElement>('[data-lang]', form).forEach((b) => b.addEventListener('click', () => b.dataset.lang !== currentLang() && setLang(b.dataset.lang as Lang)));
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
      onSignedIn(me.user, me.settings);
    } catch (err) {
      toast((err as Error).message, 'error');
      btn.disabled = false;
    }
  });
}
