// Menu page state.
import type { Menu } from '../../core/types/menu.js';

export const M = {
  root: document.createElement('div') as HTMLElement, // replaced on render; detached until then
  menu: { categories: [], items: [] } as Menu,
  cat: 'all' as number | 'all',
  q: '',
  selected: new Set<number>(),
};
