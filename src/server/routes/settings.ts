// Restaurant settings (validated per key) and the public branding used by the sign-in screen.
import { fail, ADMIN, ALL, api } from '../core/http.js';
import { broadcast } from '../core/events.js';
import { numIn, emailOpt } from '../core/validate.js';
import { onAudit } from '../core/audit.js';
import { run, tx, getSettings } from '../db/index.js';
import { checkMirrorDir } from '../services/backup.js';
import { config } from '../config.js';

const SETTING_LIMITS: Record<string, number> = {
  name: 60, tagline: 60, address: 300, phone: 30, email: 120, gstin: 15, fssai: 14, currency: 4, invoice_prefix: 10, invoice_footer: 200,
};

function validateSetting(k: string, v: string): string {
  v = v.trim();
  if (k === 'name' && !v) fail(400, 'Restaurant name cannot be empty');
  if (k in SETTING_LIMITS && v.length > SETTING_LIMITS[k]!) fail(400, `${k.replace('_', ' ')} is too long (max ${SETTING_LIMITS[k]} characters)`);
  if (k === 'currency' && !v) fail(400, 'Currency symbol is required');
  if (k === 'email' && v) emailOpt(v);
  if (k === 'gstin' && v && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.toUpperCase())) fail(400, 'GSTIN must be a valid 15-character GST number');
  if (k === 'fssai' && v && !/^\d{14}$/.test(v)) fail(400, 'FSSAI licence number must be 14 digits');
  if (k === 'invoice_prefix' && !/^[A-Za-z0-9-]{1,10}$/.test(v)) fail(400, 'Invoice prefix: 1–10 letters, numbers or dashes');
  if (k === 'service_charge') numIn(v, 'Service charge %', 0, 30);
  if (k === 'packaging_charge') numIn(v, 'Packaging charge', 0, 10_000);
  if (k === 'loyalty_rate') numIn(v, 'Loyalty points rate', 0, 100);
  if (['round_off', 'kot_auto_print', 'bill_auto_print'].includes(k) && !['0', '1'].includes(v)) fail(400, `${k.replace(/_/g, ' ')} must be on or off`);
  if (k === 'gstin') return v.toUpperCase();
  if (k === 'theme_color' && !/^#[0-9a-f]{6}$/i.test(v)) fail(400, 'Theme colour must be a hex value like #e8590c');
  if (k === 'theme_mode' && !['light', 'dark', 'system'].includes(v)) fail(400, 'Theme mode must be light, dark or system');
  if (k === 'closing_time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, 'Closing time must look like 23:30');
  if (k === 'backup_mirror_dir' && v.trim()) {
    const problem = checkMirrorDir(v.trim());
    if (problem) fail(400, problem);
    return v.trim();
  }
  if (k === 'logo' && v) {
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(400, 'Logo must be a PNG, JPG, WebP or SVG image');
    if (v.length > config.limits.logoChars) fail(400, 'Logo is too large — please use an image under 500 KB');
  }
  return v;
}

const SETTING_KEYS = [
  'name', 'tagline', 'address', 'phone', 'email', 'gstin', 'fssai', 'currency', 'service_charge', 'packaging_charge',
  'round_off', 'invoice_prefix', 'invoice_footer', 'loyalty_rate', 'kot_auto_print', 'bill_auto_print',
  'logo', 'theme_color', 'theme_mode', 'backup_mirror_dir', 'closing_time',
];

api.get('/api/settings', ALL, () => getSettings());


// Public so the sign-in screen can show the restaurant's own name, logo and colours
api.get('/api/branding', null, () => {
  const s = getSettings();
  return { name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color, theme_mode: s.theme_mode };
});

api.put('/api/settings', ADMIN, ({ body }) => {
  tx(() => {
    for (const k of SETTING_KEYS) {
      if (k in body) {
        const value = validateSetting(k, String(body[k] ?? ''));
        run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, value);
      }
    }
    if ('service_charge' in body || 'invoice_prefix' in body) run("UPDATE settings SET value='1' WHERE key='setup_billing'");
  });
  broadcast('settings');
  return getSettings();
});


onAudit('PUT /api/settings', {
  after: (c) => {
    const keys = Object.keys(c.body).filter((k) => SETTING_KEYS.includes(k));
    return keys.length ? ['settings.update', `Changed settings: ${keys.join(', ')}`, { details: Object.fromEntries(keys.map((k) => [k, k === 'logo' ? '(image)' : c.body[k]])) }] : null;
  },
});
