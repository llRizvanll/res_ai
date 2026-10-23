// Molecule: friendly placeholder when a list or chart has nothing to show.
import { esc } from '../../core/dom.js';

export const emptyState = (title: string, sub = '') =>
  `<div class="empty-state"><div class="empty-icon">○</div><b>${esc(title)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;
