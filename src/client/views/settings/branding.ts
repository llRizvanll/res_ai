// Settings → Branding & theme: name, tagline, logo, brand colour and default appearance, with live preview.
import type { AppCtx, Settings } from '../../core/types/app.js';
import { $, $$, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { applyBranding, type Branding, DEFAULT_COLOR, logoHTML, readLogoFile } from '../../core/theme.js';
import type { SettingsTab } from './tab.js';
import { guard, toast } from '../../ui/index.js';

let ctx: AppCtx;
let draft: Branding = {};

const SWATCHES: [string, string][] = [
  ['#e8590c', 'Saffron'], ['#e03131', 'Chilli red'], ['#c2255c', 'Beetroot'], ['#7048e8', 'Plum'], ['#1971c2', 'Ocean'],
  ['#0c8599', 'Teal'], ['#2f9e44', 'Mint'], ['#5c940d', 'Olive'], ['#f08c00', 'Turmeric'], ['#795548', 'Coffee'], ['#343a40', 'Charcoal'],
];

function paintBranding(body: HTMLElement) {
  const color = draft.theme_color || DEFAULT_COLOR;
  const custom = !SWATCHES.some(([c]) => c.toLowerCase() === color.toLowerCase());
  body.innerHTML = `<div class="card narrow">
    <div class="brand-preview" id="b-preview"></div>
    <form id="b-form" class="form-grid" autocomplete="off">
      <div class="field half"><label>Restaurant name</label><input name="name" required maxlength="60" value="${esc(draft.name)}"></div>
      <div class="field half"><label>Tagline <small class="muted">(optional)</small></label><input name="tagline" maxlength="60" value="${esc(draft.tagline)}" placeholder="e.g. Family Restaurant"></div>
      <div class="field"><label>Logo</label>
        <div class="logo-drop">
          <div id="b-logo"></div>
          <label class="btn"><input type="file" id="b-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>⇧ Upload logo</label>
          ${draft.logo ? '<button type="button" class="btn ghost danger-text" data-b="remove-logo">Remove logo</button>' : ''}
          <small class="muted">PNG, JPG, WebP or SVG. Square images look best; large images are resized automatically.</small>
        </div></div>
      <div class="field"><label>Brand colour</label>
        <div class="swatches">
          ${SWATCHES.map(([c, n]) => `<button type="button" class="swatch ${c.toLowerCase() === color.toLowerCase() ? 'on' : ''}" style="background:${c}" data-color="${c}" title="${n}" aria-label="${n}"></button>`).join('')}
          <label class="muted small" title="Pick any colour">Custom <input type="color" id="b-color" value="${esc(color)}" ${custom ? 'class="on"' : ''}></label>
        </div></div>
      <div class="field"><label>Default appearance <small class="muted">(each device can override it from the user menu, top right)</small></label>
        <div class="mode-cards">
          ${(['light', 'dark', 'system'] as const).map((m) => `<button type="button" class="mode-card ${draft.theme_mode === m ? 'on' : ''}" data-mode-pick="${m}"><i class="${m}"></i>${m === 'system' ? 'Match device' : m[0]!.toUpperCase() + m.slice(1)}</button>`).join('')}
        </div></div>
    </form>
    <div class="form-actions"><button class="btn ghost" data-b="reset">Discard changes</button><button class="btn primary" data-b="save">Save branding</button></div>
    <p class="muted small">The name and logo appear on the sign-in screen, sidebar, browser tab and printed bills. The colour changes buttons, highlights and charts for everyone.</p>
  </div>`;
  const preview = () => {
    $('#b-preview', body).innerHTML = `${logoHTML(draft)}<div><b>${esc(draft.name || 'Restaurant name')}</b><small>${esc(draft.tagline || '')}</small></div>`;
    $('#b-logo', body).innerHTML = logoHTML(draft);
    applyBranding({ ...ctx.settings, ...draft }, false);
  };
  preview();
  const form = $<HTMLFormElement>('#b-form', body);
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'name' || t.name === 'tagline') draft[t.name] = t.value;
    if (t.id === 'b-color') {
      draft.theme_color = t.value;
      $$('.swatch', body).forEach((x) => x.classList.remove('on'));
    }
    preview();
  });
  $('#b-file', body).addEventListener(
    'change',
    guard(async () => {
      const input = $<HTMLInputElement>('#b-file', body);
      const file = input.files?.[0];
      if (!file) return;
      draft.logo = await readLogoFile(file);
      paintBranding(body);
      toast('Logo ready — click Save branding to apply', 'info');
    }),
  );
}

async function onBrandingClick(b: HTMLElement, body: HTMLElement, repaint: () => Promise<void>) {
  const d = b.dataset;
  if (d.color) {
    draft.theme_color = d.color;
    paintBranding(body);
  } else if (d.modePick) {
    draft.theme_mode = d.modePick;
    paintBranding(body);
  } else if (d.b === 'remove-logo') {
    draft.logo = '';
    paintBranding(body);
  } else if (d.b === 'reset') {
    await repaint();
  } else if (d.b === 'save') {
    const form = $<HTMLFormElement>('#b-form', body);
    if (!form.reportValidity()) return;
    const saved = await api.put<Settings>('/settings', {
      name: (draft.name || '').trim(), tagline: (draft.tagline || '').trim(), logo: draft.logo || '',
      theme_color: draft.theme_color, theme_mode: draft.theme_mode,
    });
    ctx.refreshSettings(saved);
    toast('Branding saved for all devices');
  }
}

export const brandingTab: SettingsTab = {
  id: 'branding',
  label: 'Branding & theme',
  async paint(body, c, repaint) {
    ctx = c;
    const s = await api.get<Settings>('/settings');
    draft = { name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color || DEFAULT_COLOR, theme_mode: s.theme_mode || 'light' };
    paintBranding(body);
    body.onclick = guard(async (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (b && (b.dataset.color || b.dataset.modePick || b.dataset.b)) await onBrandingClick(b, body, repaint);
    });
  },
};
