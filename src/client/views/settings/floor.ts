// Settings → Floor & tables: dining areas and their tables.
import type { Area, DiningTable, FloorData } from '../../core/types/floor.js';
import { api } from '../../core/api.js';
import { esc } from '../../core/dom.js';
import type { SettingsTab } from './tab.js';
import { confirmDialog, emptyState, formModal, guard } from '../../ui/index.js';

let floor: FloorData | null = null;

function areaCard(a: Area, tables: DiningTable[]) {
  return `<div class="card"><div class="card-head"><h3>${esc(a.name)} <small class="muted">${tables.length} tables · ${tables.reduce((x, t) => x + t.seats, 0)} seats</small></h3>
    <div><button class="btn ghost sm" data-edit-area="${a.id}">Rename</button><button class="btn ghost sm danger-text" data-del-area="${a.id}">Delete</button><button class="btn sm" data-add-table="${a.id}">+ Table</button></div></div>
    <div class="table-pick">${tables.map((t) => `<button class="chip lg" data-edit-table="${t.id}">${esc(t.name)}<small>${t.seats} seats${t.order_id ? ' • running' : ''}</small></button>`).join('') || '<span class="muted small">No tables yet</span>'}</div></div>`;
}

export const floorTab: SettingsTab = {
  id: 'floor',
  label: 'Floor & tables',
  refreshOn: ['tables'],
  async paint(body, _ctx, paint) {
    const f = await api.get<FloorData>('/tables');
    floor = f;
    body.innerHTML = `
      <div class="toolbar"><span class="muted">Organise your dining areas and tables. Table names appear on KOTs and bills.</span><span class="grow"></span>
        <button class="btn primary" data-a="add-area">+ Add area</button></div>
      ${f.areas.length ? f.areas.map((a) => areaCard(a, f.tables.filter((t) => t.area_id === a.id))).join('') : emptyState('No areas yet')}`;
    body.onclick = guard(async (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'add-area' || d.editArea) {
    const a = floor?.areas.find((x) => x.id === Number(d.editArea));
    formModal({
      title: a ? 'Rename area' : 'New area',
      size: 'sm',
      values: a || { sort: (floor?.areas.length || 0) + 1 },
      fields: [{ name: 'name', label: 'Area name', required: true, placeholder: 'e.g. Rooftop, AC Hall' }, { name: 'sort', label: 'Display order', type: 'number' }],
      onSubmit: async (v) => {
        if (a) await api.put('/areas/' + a.id, v);
        else await api.post('/areas', v);
        await paint();
      },
    });
  } else if (d.delArea) {
    if (!(await confirmDialog('Delete this area and all its tables?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/areas/' + d.delArea);
    await paint();
  } else if (d.addTable || d.editTable) {
    const t = floor?.tables.find((x) => x.id === Number(d.editTable));
    const m = formModal({
      title: t ? `Edit table ${t.name}` : 'New table',
      size: 'sm',
      values: t || { area_id: Number(d.addTable), seats: 4, sort: (floor?.tables.length || 0) + 1 },
      fields: [
        { name: 'name', label: 'Table name / number', required: true, half: true },
        { name: 'seats', label: 'Seats', type: 'number', min: 1, half: true },
        { name: 'area_id', label: 'Area', type: 'select', options: (floor?.areas || []).map((a) => [a.id, a.name]), half: true },
        { name: 'sort', label: 'Display order', type: 'number', half: true },
      ],
      onSubmit: async (v) => {
        const body = { ...v, area_id: Number(v.area_id) };
        if (t) await api.put('/tables/' + t.id, body);
        else await api.post('/tables', body);
        await paint();
      },
    });
    if (t) {
      const del = document.createElement('button');
      del.className = 'btn ghost danger-text';
      del.textContent = 'Delete table';
      del.style.marginRight = 'auto';
      m.$('.modal-foot').prepend(del);
      del.addEventListener(
        'click',
        guard(async () => {
          await api.del('/tables/' + t.id);
          m.close();
          await paint();
        }),
      );
    }
  }
    });
  },
};
