// Dialogs: typed-confirmation reset (used by Settings and Getting started) and backup restore.
import type { AppCtx, Settings } from '../../core/types/app.js';
import { api } from '../../core/api.js';
import { esc } from '../../core/dom.js';
import type { DataSummary } from './types.js';
import { SCOPES } from './scopes.js';
import { guard, modal, toast } from '../../ui/index.js';

let ctx: AppCtx;

/** Typed-confirmation + password dialog shared by Settings and the Getting started page */
export function confirmReset(req: { everything?: boolean; scopes?: string[] }, s: DataSummary | null, onDone: () => void): Promise<void> {
  return new Promise((resolve) => {
    const chosen = req.everything ? SCOPES : SCOPES.filter((x) => req.scopes?.includes(x.id));
    const m = modal({
      title: req.everything ? 'Erase everything and start fresh?' : 'Clear selected data?',
      onClose: () => resolve(),
      body: `<p>This permanently removes:</p>
        <ul class="reset-list">${chosen.map((x) => `<li><b>${x.label}</b>${s && x.n(s) ? ` <span class="muted">(${x.n(s)})</span>` : ''}</li>`).join('')}</ul>
        ${req.everything ? '<p class="muted small">Your own login is kept. Default currency and tax options are restored.</p>' : ''}
        <div class="order-note">A full backup is saved automatically first, so you can undo this from Settings → Data, reset &amp; backup.</div>
        <form id="rs" class="form-grid mt">
          <div class="field half"><label>Type <b>RESET</b> to confirm</label><input name="confirm" autocomplete="off" required></div>
          <div class="field half"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>
        </form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rs-go">${req.everything ? 'Erase everything' : 'Clear selected'}</button>`,
    });
    const form = m.$<HTMLFormElement>('#rs');
    const go = guard(async () => {
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const res = await api.post<{ backup: string; settings: Settings }>('/admin/reset', { ...req, confirm: fd.get('confirm'), password: fd.get('password') });
      ctx?.refreshSettings(res.settings);
      m.close();
      toast(req.everything ? 'All data erased — let’s set up your restaurant' : 'Selected data cleared');
      onDone();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go();
    });
    m.$('#rs-go').addEventListener('click', () => go());
  });
}

export function setDataCtx(c: AppCtx) {
  ctx = c;
}

export function confirmRestore(name: string): Promise<void> {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Restore this backup?',
      size: 'sm',
      onClose: () => resolve(),
      body: `<p>All current data will be replaced with the backup <code>${esc(name)}</code>. Your current data is backed up first.</p>
        <p class="muted small">If your login doesn't exist in that backup you'll be signed out — sign in with an account from the backup.</p>
        <div class="field"><label>Your password</label><input type="password" id="rp" autocomplete="current-password"></div>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rp-go">Restore</button>`,
    });
    m.$('#rp-go').addEventListener(
      'click',
      guard(async () => {
        await api.post(`/admin/backups/${encodeURIComponent(name)}/restore`, { password: m.$<HTMLInputElement>('#rp').value });
        m.close();
        toast('Backup restored — reloading');
        setTimeout(() => location.reload(), 700);
      }),
    );
  });
}
