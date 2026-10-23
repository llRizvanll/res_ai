// Settings page: renders the registered tabs and remembers which one is open.
import type { AppCtx } from '../../core/types/app.js';
import { $, esc } from '../../core/dom.js';
import { applyBranding } from '../../core/theme.js';
import type { SettingsTab } from './tab.js';
import { billingTab, profileTab } from './business.js';
import { brandingTab } from './branding.js';
import { floorTab } from './floor.js';
import { paintDataTab } from '../../features/data-safety/index.js';
import { restaurantsTab } from './restaurants.js';

const dataTab: SettingsTab = { id: 'data', label: 'Data, reset & backup', paint: (body, ctx) => paintDataTab(body, ctx) };
/** Tab order on screen */
const TABS: SettingsTab[] = [brandingTab, profileTab, billingTab, floorTab, dataTab, restaurantsTab];

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let ctx: AppCtx;
let tab: SettingsTab = brandingTab;

export async function render(el: HTMLElement, params: Record<string, string>, c: AppCtx) {
  ctx = c;
  tab = TABS.find((t) => t.id === params.tab) || tab;
  el.innerHTML = `
    <div class="page settings">
      <div class="tabs">${TABS.map((t) => `<button data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      <div id="s-body"></div>
    </div>`;
  root = $('.settings', el);
  $('.tabs', root).addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    const next = TABS.find((t) => t.id === id);
    if (next) {
      tab = next;
      void paint();
    }
  });
  await paint();
  // Unsaved colour/logo previews must not leak into other screens
  return () => applyBranding(ctx.settings);
}

export function onEvent(type: string) {
  if (root.isConnected && tab.refreshOn?.includes(type)) void paint();
}

async function paint() {
  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab.id));
  applyBranding(ctx.settings);
  await tab.paint($('#s-body', root), ctx, paint);
}
