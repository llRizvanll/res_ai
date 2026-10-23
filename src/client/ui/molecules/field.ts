// Molecule: a labelled form field rendered from a declarative spec, and reading values back.
import { esc } from '../../core/dom.js';

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

export function fieldHTML(f: Field, v: unknown): string {
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
