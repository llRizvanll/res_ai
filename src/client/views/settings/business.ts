// Settings → Business details and Billing & tax: plain forms over restaurant settings.
import type { Settings } from '../../core/types/app.js';
import { $, esc } from '../../core/dom.js';
import { api } from '../../core/api.js';
import type { SettingsTab } from './tab.js';
import { type Field, guard, readForm, toast } from '../../ui/index.js';

const PROFILE: Field[] = [
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'phone', label: 'Phone', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'gstin', label: 'GSTIN', half: true },
  { name: 'fssai', label: 'FSSAI licence no.', half: true },
];

const BILLING: Field[] = [
  { name: 'currency', label: 'Currency symbol', half: true },
  { name: 'invoice_prefix', label: 'Invoice number prefix', half: true, hint: 'Applies to new orders' },
  { name: 'service_charge', label: 'Service charge % (dine-in)', type: 'number', step: '0.1', min: 0, half: true },
  { name: 'packaging_charge', label: 'Packaging charge (takeaway / delivery)', type: 'number', step: '0.01', min: 0, half: true },
  { name: 'loyalty_rate', label: 'Loyalty points per 100 spent', type: 'number', step: '0.1', min: 0, half: true },
  { name: 'round_off', label: 'Round off bill total', type: 'select', options: [['1', 'Yes — nearest rupee'], ['0', 'No']], half: true },
  { name: 'kot_auto_print', label: 'Auto-print KOT when sent', type: 'select', options: [['0', 'No'], ['1', 'Yes']], half: true },
  { name: 'bill_auto_print', label: 'Always print bill on settle', type: 'select', options: [['0', 'Ask (checkbox)'], ['1', 'Yes']], half: true },
  { name: 'invoice_footer', label: 'Bill footer message', type: 'textarea' },
];

function formFields(fields: Field[], s: Settings) {
  // Reuse the shared form renderer through a throwaway container
  const tmp = document.createElement('div');
  tmp.innerHTML = fields
    .map((f) => {
      const v = s[f.name] ?? '';
      if (f.type === 'select') {
        return `<div class="field ${f.half ? 'half' : ''}"><label>${esc(f.label)}</label><select name="${f.name}">${f.options!.map(([o, l]) => `<option value="${o}" ${String(o) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="2">${esc(v)}</textarea></div>`;
      return `<div class="field ${f.half ? 'half' : ''}"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.required ? 'required' : ''} value="${esc(v)}">${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    })
    .join('');
  return tmp.innerHTML;
}

function formTab(id: string, label: string, fields: Field[], note = ''): SettingsTab {
  return {
    id,
    label,
    async paint(body, ctx) {
      const s = await api.get<Settings>('/settings');
      body.innerHTML = `<div class="card narrow"><form id="s-form" class="form-grid">${formFields(fields, s)}</form>
        <div class="form-actions"><button class="btn primary" id="s-save">Save changes</button></div>
        ${note ? `<p class="muted small">${note}</p>` : ''}</div>`;
      body.onclick = null;
      $('#s-save', body).addEventListener(
        'click',
        guard(async () => {
          const form = $<HTMLFormElement>('#s-form', body);
          if (!form.reportValidity()) return;
          const saved = await api.put<Settings>('/settings', readForm(form, fields));
          ctx.refreshSettings(saved);
          toast('Settings saved');
        }),
      );
    },
  };
}

export const profileTab = formTab('profile', 'Business details', PROFILE);
export const billingTab = formTab('billing', 'Billing & tax', BILLING, 'Item-level GST rates are set per dish in Menu. Bills show CGST and SGST as equal halves.');
