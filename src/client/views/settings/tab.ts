// Contract every Settings tab implements; the Settings page renders whatever tabs are registered.
import type { AppCtx } from '../../core/types/app.js';

export interface SettingsTab {
  id: string;
  label: string;
  /** Draws the tab into `body`; `repaint` redraws the current tab (after saves) */
  paint(body: HTMLElement, ctx: AppCtx, repaint: () => Promise<void>): Promise<void> | void;
  /** Live events this tab wants to redraw on (e.g. 'tables') */
  refreshOn?: string[];
}
