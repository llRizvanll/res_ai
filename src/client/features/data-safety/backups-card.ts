// Card: saved backups — save now, download, delete, restore — plus how to connect other devices.
import { api, download } from '../../core/api.js';
import { fmtDateTime } from '../../core/format.js';
import { esc } from '../../core/dom.js';
import { today } from '../../core/dates.js';
import type { Card } from './card.js';
import { backupKind, sizeFmt } from './labels.js';
import { confirmDialog, toast } from '../../ui/index.js';
import { confirmRestore } from './dialogs.js';

export const backupsCard: Card = {
  render: ({ backups }) => `    <div class="card narrow">
      <div class="card-head"><h3>Backups</h3>
        <div class="actions"><button class="btn sm" data-d="snapshot">+ Save backup now</button><button class="btn ghost sm" data-d="download">⇩ Download current data</button></div></div>
      <p class="muted small">A backup is saved automatically before every reset or restore. Restoring replaces all current data with the backup (your current data is backed up first).</p>
      ${backups.length
        ? `<table class="table compact"><thead><tr><th>Saved</th><th>Type</th><th class="num">Size</th><th></th></tr></thead><tbody>
          ${backups.map((b) => `<tr><td>${fmtDateTime(b.created)}</td><td>${backupKind(b.name)}</td><td class="num">${sizeFmt(b.size)}</td>
            <td class="actions-cell"><button class="btn sm" data-d="restore" data-name="${esc(b.name)}">Restore</button><button class="btn ghost sm" data-d="dl" data-name="${esc(b.name)}">⇩</button><button class="btn ghost sm danger-text" data-d="del" data-name="${esc(b.name)}">Delete</button></td></tr>`).join('')}
          </tbody></table>`
        : '<div class="muted small">No saved backups yet.</div>'}
      <h3 class="mt">Connect other devices</h3>
      <p class="muted small">Tablets and phones on the same Wi-Fi can open the address shown in the server window (e.g. <code>http://192.168.x.x:3000</code>). Use a Kitchen login on the kitchen screen and Captain logins on waiter phones.</p>
    </div>`,
  actions: {
    snapshot: async (_b, c) => {
      await api.post('/admin/backups', { label: 'manual' });
      toast('Backup saved');
      await c.repaint();
    },
    download: async () => {
      await download('/backup', `restaurant-backup-${today()}.db`);
    },
    dl: async (b, c) => {
      await download('/admin/backups/' + encodeURIComponent(b.dataset.name!), b.dataset.name!);
      toast('Backup downloaded — keep it somewhere safe');
      await c.repaint();
    },
    del: async (b, c) => {
      if (!(await confirmDialog('Delete this backup file permanently?', { okLabel: 'Delete', danger: true }))) return;
      await api.del('/admin/backups/' + encodeURIComponent(b.dataset.name!));
      await c.repaint();
    },
    restore: (b) => confirmRestore(b.dataset.name!),
  },
};
