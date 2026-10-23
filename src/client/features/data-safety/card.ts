// Contract for one card on the Data tab: it draws itself and handles its own buttons (by data-d).
import type { AppCtx } from '../../core/types/app.js';
import type { TabData } from './types.js';

export interface CardCtx {
  body: HTMLElement;
  app: AppCtx;
  data: TabData;
  /** Redraw the whole tab with fresh data */
  repaint(): Promise<void>;
}
export interface Card {
  render(d: TabData): string;
  /** Called after render, e.g. to wire inputs */
  wire?(c: CardCtx): void;
  /** Button handlers keyed by the button's data-d value */
  actions?: Record<string, (button: HTMLElement, c: CardCtx) => Promise<void>>;
}
