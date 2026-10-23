// The banner shown in a demo tab, so nobody mistakes the demo for their real restaurant.
import { api, auth } from '../core/api.js';
import { confirmDialog, guard, toast } from '../ui/index.js';

export function renderDemoRibbon() {
  document.querySelector('.demo-ribbon')?.remove();
  const bar = document.createElement('div');
  bar.className = 'demo-ribbon';
  bar.innerHTML = `<span><b>DEMO RESTAURANT</b> · sample data for reference — nothing you do here affects your real restaurant.</span>
    <span class="actions"><button class="btn sm" data-demo="reset">Reset demo data</button><button class="btn sm" data-demo="close">Close demo</button></span>`;
  document.body.prepend(bar);
  bar.addEventListener(
    'click',
    guard(async (e: Event) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-demo]')?.dataset.demo;
      if (act === 'close') return closeDemo();
      if (act === 'reset') {
        if (!(await confirmDialog('Replace everything in the demo with fresh sample data?', { okLabel: 'Reset demo' }))) return;
        const r = await api.post<{ token: string }>('/demo/reset');
        auth.useDemo(r.token);
        toast('Demo data refreshed');
        setTimeout(() => location.reload(), 500);
      }
    }),
  );
}

/** Leaves the demo: closes the tab when it was opened for the demo, otherwise returns to the real app */
export function closeDemo() {
  auth.clear();
  window.close();
  // Browsers only let script close tabs it opened; otherwise fall back to the real restaurant
  setTimeout(() => location.replace(location.pathname), 150);
}
