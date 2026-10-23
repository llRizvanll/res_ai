// Hash router: #/<page>?<params>. Loads the page module, renders it, and forwards live events to it.
import type { AppCtx, ViewModule } from '../core/types/app.js';
import { $, $$, esc } from '../core/dom.js';
import { homeFor, navFor } from './nav.js';

let ctx: AppCtx;
let current: { mod: ViewModule | null; cleanup: (() => void) | null } = { mod: null, cleanup: null };
let seq = 0;

export function startRouter(c: AppCtx) {
  ctx = c;
  window.onhashchange = route;
  route();
}

/** Lets the current page react to a live update (e.g. 'orders', 'kot') */
export const notifyView = (type: string) => current.mod?.onEvent?.(type);

/** Runs the current page's cleanup (timers, listeners) and forgets it */
export function leaveView() {
  current.cleanup?.();
  current = { mod: null, cleanup: null };
}

async function route() {
  const mySeq = ++seq;
  const [name = '', qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  const view = navFor(ctx.user.role).find((n) => n.id === name);
  if (!view) {
    location.replace('#/' + homeFor(ctx.user.role));
    return;
  }
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view.id));
  $('#page-title').textContent = view.label;
  document.title = `${view.label} · ${ctx.settings.name || 'Restaurant'}`;
  leaveView();
  const main = $('#main');
  main.className = `view-${view.id}`;
  main.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const mod = await view.load();
    if (mySeq !== seq) return; // the user already navigated elsewhere
    current.mod = mod;
    const cleanup = await mod.render(main, params, ctx);
    if (mySeq !== seq) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (e) {
    console.error(e);
    if (mySeq === seq) main.innerHTML = `<div class="card"><div class="alert">Could not load this screen: ${esc((e as Error).message)}</div></div>`;
  }
}
