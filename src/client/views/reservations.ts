import type { AppCtx } from '../core/types/app.js';
import type { FloorData } from '../core/types/floor.js';
import type { Reservation } from '../core/types/operations.js';
import { $, esc } from '../core/dom.js';
import { addDays, today } from '../core/dates.js';
import { api } from '../core/api.js';
import { fmtDate } from '../core/format.js';
import { confirmDialog, emptyState, formModal, guard, statusBadge, toast } from '../ui/index.js';

let root: HTMLElement = document.createElement('div'); // replaced on render; detached until then
let list: Reservation[] = [];
let floor: FloorData;
let range: 'today' | 'upcoming' | 'week' | 'past' = 'today';

export async function render(el: HTMLElement, _p: Record<string, string>, _ctx: AppCtx) {
  el.innerHTML = `
    <div class="page">
      <div class="toolbar">
        <div class="seg" id="r-range">
          <button data-r="today">Today</button><button data-r="upcoming">Upcoming</button><button data-r="week">Next 7 days</button><button data-r="past">Past 30 days</button>
        </div>
        <span class="grow"></span>
        <button class="btn primary" data-a="add">+ New reservation</button>
      </div>
      <div id="r-body"></div>
    </div>`;
  root = $('.page', el);
  root.addEventListener('click', onClick);
  floor = await api.get<FloorData>('/tables');
  await load();
}

async function load() {
  const t = today();
  const [from, to] =
    range === 'today' ? [t, t] : range === 'week' ? [t, addDays(t, 7)] : range === 'past' ? [addDays(t, -30), addDays(t, -1)] : [t, '9999-12-31'];
  list = await api.get<Reservation[]>(`/reservations?from=${from}&to=${to}`);
  root!.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === range));
  const byDay = new Map<string, Reservation[]>();
  for (const r of list) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }
  $('#r-body', root!).innerHTML = list.length
    ? [...byDay.entries()]
        .map(
          ([day, rs]) => `<div class="card flush"><div class="card-head pad"><h3>${day === t ? 'Today' : fmtDate(day)}</h3><span class="muted">${rs.length} bookings · ${rs.reduce((a, r) => a + (r.status === 'booked' ? r.guests : 0), 0)} guests expected</span></div>
          <table class="table"><thead><tr><th>Time</th><th>Guest</th><th class="num">Guests</th><th>Table</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>
          ${rs
            .map(
              (r) => `<tr><td><b>${esc(r.time || '—')}</b></td><td><b>${esc(r.name)}</b><div class="muted small">${esc(r.phone || '')}</div></td><td class="num">${r.guests}</td>
              <td>${esc(r.table_name || 'Not assigned')}</td><td class="small">${esc(r.notes || '')}</td><td>${statusBadge(r.status)}</td>
              <td class="actions-cell">
                ${r.status === 'booked' ? `<button class="btn sm ok" data-seat="${r.id}">Seat</button><button class="btn ghost sm" data-st="no_show" data-id="${r.id}">No-show</button><button class="btn ghost sm" data-st="cancelled" data-id="${r.id}">Cancel</button>` : ''}
                <button class="btn ghost sm" data-edit="${r.id}">Edit</button>
                <button class="btn ghost sm danger-text" data-del="${r.id}">Delete</button>
              </td></tr>`,
            )
            .join('')}</tbody></table></div>`,
        )
        .join('')
    : emptyState('No reservations', 'Take a booking with “+ New reservation”');
}

const onClick = guard(async (e: Event) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.r) {
    range = d.r as typeof range;
    await load();
  } else if (d.a === 'add') edit();
  else if (d.edit) edit(list.find((r) => r.id === Number(d.edit)));
  else if (d.st) {
    await api.put('/reservations/' + d.id, { status: d.st });
    await load();
  } else if (d.seat) {
    const r = list.find((x) => x.id === Number(d.seat))!;
    await api.put('/reservations/' + r.id, { status: 'seated' });
    toast(`${r.name} seated`);
    if (r.table_id) location.hash = `#/pos?table=${r.table_id}`;
    else await load();
  } else if (d.del) {
    if (!(await confirmDialog('Delete this reservation?', { okLabel: 'Delete', danger: true }))) return;
    await api.del('/reservations/' + d.del);
    await load();
  }
});

function edit(r?: Reservation) {
  formModal({
    title: r ? 'Edit reservation' : 'New reservation',
    values: r || { date: today(), time: '20:00', guests: 2 },
    fields: [
      { name: 'name', label: 'Guest name', required: true, half: true },
      { name: 'phone', label: 'Phone', type: 'tel', half: true },
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'time', label: 'Time', type: 'time', required: true, half: true },
      { name: 'guests', label: 'Number of guests', type: 'number', min: 1, required: true, half: true },
      {
        name: 'table_id', label: 'Table', type: 'select', half: true,
        options: [['', 'Assign later'], ...floor.tables.map((t): [number, string] => [t.id, `${t.name} (${t.seats} seats)`])],
      },
      { name: 'notes', label: 'Special requests', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      const body = { ...v, table_id: v.table_id ? Number(v.table_id) : null };
      if (r) await api.put('/reservations/' + r.id, body);
      else await api.post('/reservations', body);
      toast('Reservation saved');
      await load();
    },
  });
}
