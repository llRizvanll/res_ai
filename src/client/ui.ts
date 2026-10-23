// Small DOM, formatting and dialog helpers shared by every view.

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
}
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(sel),
];

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- formatting
let currency = '₹';
export const setCurrency = (c: string) => (currency = c || '₹');
export const money = (n: number | null | undefined): string =>
  currency + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n: number | null | undefined): string =>
  currency + Math.round(Number(n || 0)).toLocaleString('en-IN');
export const compact = (n: number): string =>
  n >= 100000 ? (n / 100000).toFixed(1) + 'L' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
export const qtyFmt = (n: number): string => String(Math.round(n * 1000) / 1000);

export const parseDate = (s: string): Date => new Date(s.includes('T') || s.length <= 10 ? s : s.replace(' ', 'T'));
export const fmtDate = (s: string | null | undefined): string =>
  s ? parseDate(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtTime = (s: string | null | undefined): string =>
  s ? parseDate(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDateTime = (s: string | null | undefined): string => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): string => isoDay(new Date());
export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export function minutesSince(s: string): number {
  return Math.max(0, Math.floor((Date.now() - parseDate(s).getTime()) / 60000));
}
export function elapsed(s: string): string {
  const m = minutesSince(s);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const ORDER_TYPES: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };
export const PAY_MODES: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', other: 'Other', split: 'Split' };
export const label = (map: Record<string, string>, k: string | null | undefined) => (k ? map[k] || k : '—');

export const badge = (text: string, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
export const vegDot = (veg: number | boolean) => `<span class="veg-dot ${veg ? 'veg' : 'nonveg'}" title="${veg ? 'Veg' : 'Non-veg'}"></span>`;
export const statusBadge = (s: string) =>
  badge(s.replace('_', ' '), { open: 'warn', completed: 'ok', cancelled: 'danger', booked: 'info', seated: 'ok', no_show: 'danger' }[s] || '');

// ---------------------------------------------------------------- toasts
export function toast(msg: string, type: 'ok' | 'error' | 'info' = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), type === 'error' ? 4500 : 2600);
  setTimeout(() => t.remove(), type === 'error' ? 5000 : 3100);
}

// ---------------------------------------------------------------- modals
export interface Modal {
  el: HTMLElement;
  close(): void;
  $<T extends Element = HTMLElement>(sel: string): T;
}

interface ModalOpts {
  title: string;
  body: string;
  footer?: string;
  size?: '' | 'sm' | 'lg' | 'xl';
  onClose?: () => void;
}

export function modal({ title, body, footer = '', size = '', onClose }: ModalOpts): Modal {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  const onKey = (e: KeyboardEvent) => {
    const top = $$('.modal-backdrop').pop();
    if (e.key === 'Escape' && top === wrap) close();
  };
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  setTimeout(() => wrap.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea')?.focus(), 30);
  return { el: wrap, close, $: <T extends Element = HTMLElement>(s: string) => $<T>(s, wrap) };
}

export function confirmDialog(message: string, { okLabel = 'Confirm', danger = false } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title: 'Please confirm',
      size: 'sm',
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => resolve(ok),
    });
    m.$('[data-ok]').addEventListener('click', () => {
      ok = true;
      m.close();
    });
  });
}

export function promptDialog(title: string, labelText: string, { value = '', required = true, chips = [] as string[] } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = modal({
      title,
      size: 'sm',
      body: `<form id="pf"><div class="field"><label>${esc(labelText)}</label><input name="v" value="${esc(value)}" ${required ? 'required' : ''} autocomplete="off"></div>
        ${chips.length ? `<div class="chips">${chips.map((c) => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>OK</button>`,
      onClose: () => resolve(result),
    });
    const form = m.$<HTMLFormElement>('#pf');
    const input = m.$<HTMLInputElement>('input');
    $$('[data-chip]', m.el).forEach((c) =>
      c.addEventListener('click', () => {
        input.value = input.value ? `${input.value}, ${c.dataset.chip}` : c.dataset.chip!;
        input.focus();
      }),
    );
    const submit = (e?: Event) => {
      e?.preventDefault();
      if (!form.reportValidity()) return;
      result = input.value.trim();
      m.close();
    };
    form.addEventListener('submit', submit);
    m.$('[data-ok]').addEventListener('click', () => submit());
  });
}

// ---------------------------------------------------------------- forms
export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'checkbox' | 'date' | 'time' | 'password' | 'tel' | 'email';
  options?: [string | number, string][];
  required?: boolean;
  placeholder?: string;
  step?: string;
  min?: number;
  half?: boolean;
  hint?: string;
  rows?: number;
  default?: unknown;
}

export type FormValues = Record<string, string | number | boolean | null>;

function fieldHTML(f: Field, v: unknown): string {
  const val = v ?? f.default ?? '';
  const common = `name="${f.name}" id="f_${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  let input: string;
  if (f.type === 'checkbox') {
    return `<label class="check ${f.half ? 'half' : ''}"><input type="checkbox" ${common} ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
  } else if (f.type === 'select') {
    input = `<select ${common}>${(f.options || [])
      .map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`)
      .join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea ${common} rows="${f.rows || 2}">${esc(val)}</textarea>`;
  } else {
    input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''}>`;
  }
  return `<div class="field ${f.half ? 'half' : ''}"><label for="f_${f.name}">${esc(f.label)}</label>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
}

export function readForm(form: HTMLFormElement, fields: Field[]): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    const el = form.elements.namedItem(f.name) as HTMLInputElement | null;
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim();
  }
  return out;
}

interface FormModalOpts {
  title: string;
  fields: Field[];
  values?: object;
  submitLabel?: string;
  size?: ModalOpts['size'];
  intro?: string;
  onSubmit(values: FormValues, m: Modal): Promise<void> | void;
}

export function formModal({ title, fields, values = {}, submitLabel = 'Save', size = '', intro = '', onSubmit }: FormModalOpts): Modal {
  const m = modal({
    title,
    size,
    body: `${intro}<form class="form-grid" id="fm">${fields.map((f) => fieldHTML(f, (values as Record<string, unknown>)[f.name])).join('')}<button type="submit" hidden></button></form>`,
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-submit>${esc(submitLabel)}</button>`,
  });
  const form = m.$<HTMLFormElement>('#fm');
  const btn = m.$<HTMLButtonElement>('[data-submit]');
  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!form.reportValidity()) return;
    btn.disabled = true;
    try {
      await onSubmit(readForm(form, fields), m);
      m.close();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  form.addEventListener('submit', submit);
  btn.addEventListener('click', () => submit());
  return m;
}

// ---------------------------------------------------------------- charts & misc
export interface BarDatum {
  label: string;
  value: number;
  tip?: string;
}

export function barChart(data: BarDatum[], { height = 200, fmt = (v: number) => compact(v) } = {}): string {
  if (!data.length || data.every((d) => !d.value)) return '<div class="empty">No data for this period</div>';
  const max = Math.max(...data.map((d) => d.value), 1);
  return `<div class="chart" style="height:${height}px">${data
    .map(
      (d) => `<div class="bar-col" title="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}">
        <div class="bar-val">${d.value ? esc(fmt(d.value)) : ''}</div>
        <div class="bar-track"><div class="bar" style="height:${((d.value / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-label">${esc(d.label)}</div></div>`,
    )
    .join('')}</div>`;
}

export function hbars(rows: { label: string; value: number }[], fmt: (n: number) => string = money0): string {
  if (!rows.length) return '<div class="empty">No data yet</div>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows
    .map(
      (r) => `<div class="hbar"><div class="hbar-top"><span>${esc(r.label)}</span><b>${esc(fmt(r.value))}</b></div>
      <div class="hbar-track"><div style="width:${((r.value / max) * 100).toFixed(1)}%"></div></div></div>`,
    )
    .join('')}</div>`;
}

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const emptyState = (title: string, sub = '') =>
  `<div class="empty-state"><div class="empty-icon">○</div><b>${esc(title)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

/** Wraps an async click handler so errors surface as toasts and double-clicks are ignored */
export function guard<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  let busy = false;
  return async (...a: A) => {
    if (busy) return;
    busy = true;
    try {
      await fn(...a);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  };
}
