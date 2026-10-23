// App-level contracts: settings, the context passed to pages, and the page module shape.
import type { User } from './people.js';
import type { Role } from '../../../shared/domain.js';

export type Settings = Record<string, string>;

/** Shared context handed to every view */
export interface AppCtx {
  user: User;
  settings: Settings;
  /** This tab is showing the built-in demo restaurant */
  demo: boolean;
  can(roles: Role[]): boolean;
  refreshSettings(s: Settings): void;
}

/** A view renders into the main area and may return a cleanup function */
export interface ViewModule {
  render(el: HTMLElement, params: Record<string, string>, ctx: AppCtx): Promise<void | (() => void)>;
  onEvent?(type: string): void;
}
