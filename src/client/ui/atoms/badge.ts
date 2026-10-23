// Atoms: the smallest display pieces — badges, veg/non-veg marks, change indicators.
import { esc } from '../../core/dom.js';

export const badge = (text: string, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
export const vegDot = (veg: number | boolean) => `<span class="veg-dot ${veg ? 'veg' : 'nonveg'}" title="${veg ? 'Veg' : 'Non-veg'}"></span>`;
export const statusBadge = (s: string) =>
  badge(s.replace('_', ' '), { open: 'warn', completed: 'ok', cancelled: 'danger', booked: 'info', seated: 'ok', no_show: 'danger' }[s] || '');

/** "+12.5%" / "−3%" with colour; `invert` for costs where going up is bad */
export function deltaBadge(pct: number | null | undefined, invert = false): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '<span class="delta muted">—</span>';
  const good = invert ? pct <= 0 : pct >= 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}
