// The restaurant's name/logo block shown on the sign-in page and in the sidebar.
import { applyBranding, type Branding, cachedBranding, logoHTML } from '../core/theme.js';
import { esc } from '../core/dom.js';

let branding: Branding = cachedBranding();
applyBranding(branding, false); // paint cached colours immediately, before any network call

export const currentBranding = () => branding;

export function brandBlock(b: Branding, big = false): string {
  return `<div class="brand${big ? ' big' : ''}" data-brand>${logoHTML(b)}<div><b>${esc(b.name || 'Restaurant')}</b>${b.tagline ? `<small>${esc(b.tagline)}</small>` : ''}</div></div>`;
}

/** Re-renders every brand block on screen (login art, sidebar) and the colours */
export function paintBrand(b: Branding) {
  branding = b;
  applyBranding(b);
  document.querySelectorAll<HTMLElement>('[data-brand]').forEach((el) => (el.outerHTML = brandBlock(b, el.classList.contains('big'))));
}

/** Remembers the signed-in restaurant's branding (used again on the sign-in screen after signing out) */
export function rememberBranding(b: Branding) {
  branding = b;
  applyBranding(b);
}
