// Card: data-safety status — disk safety, database check, automatic backups, second backup folder.
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { fmtDateTime } from '../../core/format.js';
import type { Card, CardCtx } from './card.js';
import { badge, toast } from '../../ui/index.js';
import { sizeFmt } from './labels.js';

export const safetyCard: Card = {
  render: ({ health: h }) => {
    const otherWarnings = h.warnings.filter((w) => w !== h.recovery_note);
    return `    <div class="card narrow">
      <div class="card-head"><h3>Data safety</h3>${h.healthy && !h.warnings.length ? badge('All protected', 'ok') : badge('Needs attention', 'danger')}</div>
      ${h.recovery_note ? `<div class="alert">${esc(h.recovery_note)} <button class="btn sm" data-d="dismiss-note">Got it</button></div>` : ''}
      ${otherWarnings.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      <ul class="safety-list">
        <li><span class="ic">✓</span><div><b>Every save goes to disk immediately</b><small>Bills, KOTs and stock changes are committed safely, so a crash or power cut doesn’t lose them.</small></div></li>
        <li><span class="ic ${h.healthy ? '' : 'bad'}">${h.healthy ? '✓' : '!'}</span><div class="grow"><b>Database check: ${h.healthy ? 'healthy' : 'problem found'}</b>
          <small>Checked on every start; a damaged file is replaced automatically from the newest good backup. Size ${sizeFmt(h.db_size)}.</small></div>
          <button class="btn sm" data-d="check">Run full check</button></li>
        <li><span class="ic">✓</span><div><b>Automatic backups</b>
          <small>Every ${h.interval_min} min when anything changes, a daily copy kept for 90 days, and before every delete, reset or restore. Each copy is verified after saving.</small>
          <small>Newest: ${h.newest_backup ? `${fmtDateTime(h.newest_backup.created)}` : 'none yet'} · ${h.backups} backups in <code>${esc(h.backup_dir)}</code></small></div></li>
        <li><span class="ic ${h.mirror.dir ? (h.mirror.ok === false ? 'bad' : '') : 'info'}">${h.mirror.dir ? (h.mirror.ok === false ? '!' : '✓') : 'i'}</span><div class="grow">
          <b>Copy backups to a second place</b>
          <small>If this computer’s disk fails, backups on it are lost too. Choose a USB drive or a folder synced by Google Drive / OneDrive / Dropbox on this computer.</small>
          ${h.mirror.dir ? `<small>${h.mirror.ok === false ? `<span class="danger-text">Last copy failed: ${esc(h.mirror.error)}</span>` : h.mirror.at ? `Last copied ${fmtDateTime(h.mirror.at)}` : 'Copies start with the next backup.'}</small>` : ''}
          <div class="mirror-row"><input id="mirror-dir" placeholder="e.g. /Volumes/USB/restaurant-backups  or  D:\\Backups" value="${esc(h.mirror.dir || '')}">
            <button class="btn sm primary" data-d="mirror-save">Save &amp; copy now</button>${h.mirror.dir ? '<button class="btn sm ghost" data-d="mirror-clear">Turn off</button>' : ''}</div></div></li>
        <li><span class="ic">✓</span><div><b>Automatic restart</b><small>If the server stops unexpectedly it saves a backup and restarts by itself within seconds (when started with <code>npm start</code>).</small></div></li>
        <li><span class="ic">✓</span><div><b>Unsent items are kept on each device</b><small>Items not yet sent to the kitchen survive a page refresh or dropped Wi-Fi, and re-sending after a dropped connection never creates duplicate KOTs or orders.</small></div></li>
      </ul>
    </div>`;
  },
  actions: {
    'dismiss-note': async (_b, c) => {
      await api.post('/admin/recovery-note/dismiss');
      await c.repaint();
    },
    check: async () => {
      const r = await api.post<{ ok: boolean; problems: string[] }>('/admin/health/check');
      if (r.ok) toast('Full database check passed — no problems found');
      else toast(`Database problems found: ${r.problems.slice(0, 2).join('; ')} — restore the newest backup`, 'error');
    },
    'mirror-save': (_b, c) => saveMirror($<HTMLInputElement>('#mirror-dir', c.body).value.trim(), c),
    'mirror-clear': (_b, c) => saveMirror('', c),
  },
};

async function saveMirror(dir: string, c: CardCtx) {
  await api.put('/settings', { backup_mirror_dir: dir });
  if (dir) {
    await api.post('/admin/backups', { label: 'manual' });
    toast('Off-site folder saved and a backup copied there');
  } else toast('Off-site copies turned off');
  await c.repaint();
}
