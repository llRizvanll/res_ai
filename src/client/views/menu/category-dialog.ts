// Add / edit / delete a menu category.
import type { Category } from '../../core/types/menu.js';
import { api } from '../../core/api.js';
import { M } from './state.js';
import { confirmDialog, formModal, guard, toast } from '../../ui/index.js';
import { load } from './index.js';

export function editCategory(c?: Category) {
  const m = formModal({
    title: c ? 'Edit category' : 'New category',
    size: 'sm',
    values: c ? { ...c, active: !!c.active } : { active: true, sort: M.menu.categories.length + 1 },
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'sort', label: 'Display order', type: 'number', half: true },
      { name: 'active', label: 'Show on POS', type: 'checkbox', half: true },
    ],
    onSubmit: async (v) => {
      if (c) await api.put('/categories/' + c.id, v);
      else await api.post('/categories', v);
      toast('Category saved');
      await load();
    },
  });
  if (c) {
    const del = document.createElement('button');
    del.className = 'btn ghost danger-text';
    del.textContent = 'Delete';
    del.style.marginRight = 'auto';
    m.$('.modal-foot').prepend(del);
    del.addEventListener(
      'click',
      guard(async () => {
        if (!(await confirmDialog(`Delete category “${c.name}”? Its items become uncategorised.`, { okLabel: 'Delete', danger: true }))) return;
        await api.del('/categories/' + c.id);
        m.close();
        if (M.cat === c.id) M.cat = 'all';
        await load();
      }),
    );
  }
}

