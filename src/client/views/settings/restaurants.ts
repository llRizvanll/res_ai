// Settings → Restaurants: list branches, add one, or remove (archive) the current one.
import { $, esc } from '../../core/dom.js';
import { api, auth } from '../../core/api.js';
import type { SettingsTab } from './tab.js';
import { guard, modal, toast } from '../../ui/index.js';

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

export const restaurantsTab: SettingsTab = { id: 'restaurants', label: 'Restaurants', paint: (body) => paintRestaurants(body) };
