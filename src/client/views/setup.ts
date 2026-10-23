import type { AppCtx } from '../core/types/app.js';
import { $, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import type { DataSummary } from '../features/data-safety/types.js';
import { confirmReset, setDataCtx } from '../features/data-safety/dialogs.js';
import { formModal, guard, toast } from '../ui/index.js';
import { type SetupStatus, STEPS } from '../features/setup-steps.js';

export async function render(el: HTMLElement, _p: Record<string, string>, ctx: AppCtx) {
  setDataCtx(ctx);
  const st = await api.get<SetupStatus>('/admin/setup');
  const required = STEPS.filter((s) => !s.optional);
  const done = required.filter((s) => st.steps[s.key]).length;
  el.innerHTML = `
    <div class="page setup">
      ${st.demo
        ? `<div class="card banner"><div><b>You're exploring demo data</b><p class="muted">Everything here — menu, tables, 30 days of sales, customers — is sample data so you can try the whole system. When you're ready, erase it and set up your own restaurant. The demo stays saved as a backup.</p></div>
           <button class="btn primary" data-a="fresh">Start fresh with my restaurant</button></div>`
        : ''}
      <div class="card narrow">
        <div class="card-head"><div><h3>Set up ${esc(ctx.settings.name || 'your restaurant')}</h3><p class="muted small">${done} of ${required.length} steps done${done === required.length ? ' — you’re ready to take orders!' : ''}</p></div>
          ${done === required.length ? '<a class="btn primary" href="#/pos">Take first order →</a>' : ''}</div>
        <div class="progress"><div style="width:${(done / required.length) * 100}%"></div></div>
        <ol class="steps">
          ${STEPS.map((s, i) => {
            const ok = st.steps[s.key];
            return `<li class="${ok ? 'done' : ''}"><span class="step-no">${ok ? '✓' : i + 1}</span>
              <div class="grow"><b>${esc(s.title)}${s.optional ? ' <small class="muted">(optional)</small>' : ''}</b><small>${esc(ok && s.key === 'password' ? 'Your password has been changed.' : s.desc)}</small></div>
              ${s.action ? (ok ? '' : `<button class="btn sm" data-a="${s.action}">Change</button>`) : `<a class="btn sm ${ok ? 'ghost' : ''}" href="${s.href}">${ok ? 'Edit' : 'Set up'}</a>`}</li>`;
          }).join('')}
        </ol>
      </div>
      <div class="card narrow">
        <h3>Tips</h3>
        <ul class="muted tips">
          <li>Want to see how a fully set-up restaurant looks? <a class="link" href="#/demo">Open the demo restaurant</a> in its own tab any time — it never touches your data.</li>
          <li>Everything can be edited or deleted later — menu items, tables, staff, customers, expenses, even individual bills.</li>
          <li>Need a clean slate again? <a class="link" href="#/settings?tab=data">Settings → Data, reset &amp; backup</a> can clear any part of your data, and restores backups.</li>
          <li>Open the server's Wi-Fi address on a tablet for the Kitchen Display and on phones for captains.</li>
        </ul>
      </div>
    </div>`;

  $('.setup', el).addEventListener(
    'click',
    guard(async (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'fresh') {
        const s = await api.get<DataSummary>('/admin/summary');
        await confirmReset({ everything: true }, s, () => render(el, {}, ctx));
      } else if (b.dataset.a === 'password') {
        formModal({
          title: 'Change your password',
          size: 'sm',
          fields: [
            { name: 'current', label: 'Current password', type: 'password', required: true },
            { name: 'password', label: 'New password (min 6 characters)', type: 'password', required: true },
          ],
          onSubmit: async (v) => {
            await api.post('/auth/password', v);
            toast('Password changed');
            await render(el, {}, ctx);
          },
        });
      }
    }),
  );
}
