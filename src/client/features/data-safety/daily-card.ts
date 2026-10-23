// Card: daily closing backups — closing time, and a row per day with sales, staff, backup and download status.
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { fmtDate, fmtDateTime, fmtTime, money } from '../../core/format.js';
import type { Card } from './card.js';
import { backupKind } from './labels.js';
import { toast } from '../../ui/index.js';

let dailyDays = 14;
/** How many days the table shows (the tab asks the server for this many) */
export const dailyWindow = () => dailyDays;

export const dailyCard: Card = {
  render: ({ daily }) => `    <div class="card narrow">
      <div class="card-head"><h3>Daily closing backups</h3>
        <div class="actions"><label class="small muted">Closing time <input type="time" id="closing-time" value="${esc(daily.closing_time)}" class="inline-date"></label>
        <button class="btn sm" data-d="closing-save">Save</button></div></div>
      <p class="muted small">Every day at closing time a full backup is saved automatically. Download it to your phone, a USB drive or email it to yourself — the owner is reminded on the dashboard until it’s downloaded.</p>
      <table class="table compact"><thead><tr><th>Day</th><th class="num">Bills</th><th class="num">Sales</th><th>Accounts that worked</th><th>Backup</th><th>Downloaded</th><th></th></tr></thead><tbody>
        ${daily.days
          .map(
            (d) => `<tr><td class="nowrap"><b>${fmtDate(d.day)}</b></td><td class="num">${d.orders}</td><td class="num">${money(d.sales)}</td>
            <td class="small">${d.accounts.length ? esc(d.accounts.join(', ')) : '<span class="muted">—</span>'}</td>
            <td class="small">${d.backup ? `${backupKind(d.backup.name)} <span class="muted">${fmtTime(d.backup.created)}</span>` : '<span class="muted">none</span>'}</td>
            <td class="small">${d.downloaded ? `<span class="ok-text">✓ ${fmtDateTime(d.downloaded.at)}</span><div class="muted">by ${esc(d.downloaded.user_name)}</div>` : d.backup ? '<span class="danger-text">Not yet</span>' : ''}</td>
            <td class="actions-cell">${d.backup ? `<button class="btn ghost sm" data-d="dl" data-name="${esc(d.backup.name)}">⇩ Download</button>` : ''}</td></tr>`,
          )
          .join('')}
      </tbody></table>
      ${dailyDays < 90 ? '<button class="link mt" data-d="more-days">Show 90 days</button>' : ''}
    </div>`,
  actions: {
    'closing-save': async (_b, c) => {
      await api.put('/settings', { closing_time: $<HTMLInputElement>('#closing-time', c.body).value });
      toast('Closing time saved');
      await c.repaint();
    },
    'more-days': async (_b, c) => {
      dailyDays = 90;
      await c.repaint();
    },
  },
};
