// Settings → Data, reset & backup: loads the owner-tools data once and draws the cards in order.
import type { AppCtx } from '../../core/types/app.js';
import { api } from '../../core/api.js';
import type { Backup, DataSummary, Health, TabData } from './types.js';
import type { Card, CardCtx } from './card.js';
import { backupsCard } from './backups-card.js';
import { setDataCtx } from './dialogs.js';
import { dailyCard, dailyWindow } from './daily-card.js';
import { guard } from '../../ui/index.js';
import { resetCard } from './reset-card.js';
import { safetyCard } from './safety-card.js';

export { confirmReset, setDataCtx } from './dialogs.js';
export type { DataSummary, Health } from './types.js';

/** Card order on the tab */
const CARDS: Card[] = [safetyCard, dailyCard, resetCard, backupsCard];

export async function paintDataTab(body: HTMLElement, app: AppCtx): Promise<void> {
  setDataCtx(app);
  const [summary, backups, health, daily] = await Promise.all([
    api.get<DataSummary>('/admin/summary'),
    api.get<Backup[]>('/admin/backups'),
    api.get<Health>('/admin/health'),
    api.get<TabData['daily']>(`/admin/daily?days=${dailyWindow()}`),
  ]);
  const data: TabData = { summary, backups, health, daily };
  body.innerHTML = CARDS.map((c) => c.render(data)).join('\n');
  const c: CardCtx = { body, app, data, repaint: () => paintDataTab(body, app) };
  for (const card of CARDS) card.wire?.(c);
  const actions = Object.assign({}, ...CARDS.map((card) => card.actions || {})) as NonNullable<Card['actions']>;
  body.onclick = guard(async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-d]');
    const run = b && actions[b.dataset.d!];
    if (run) await run(b, c);
  });
}
