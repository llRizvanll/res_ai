// Setting defaults: a demo restaurant, a fresh start, and which keys are branding.
import { get, run } from '../query.js';

export const DEFAULT_SETTINGS = {
  name: 'Spice Garden',
  tagline: 'Family Restaurant',
  address: '12, MG Road, Bengaluru, Karnataka 560001',
  phone: '+91 98765 43210',
  email: 'hello@spicegarden.example',
  gstin: '29ABCDE1234F1Z5',
  fssai: '11223344556677',
  currency: '₹',
  service_charge: '0',
  packaging_charge: '20',
  round_off: '1',
  invoice_prefix: 'INV',
  invoice_footer: 'Thank you for dining with us! Please visit again.',
  loyalty_rate: '1',
  kot_auto_print: '0',
  bill_auto_print: '0',
  logo: '',
  theme_color: '#e8590c',
  theme_mode: 'light',
  demo_data: '0',
  setup_billing: '0',
  closing_time: '23:30',
};

export const BRANDING_KEYS = ['name', 'tagline', 'logo', 'theme_color', 'theme_mode'];

/** Values used when an owner "starts fresh": blank business details, sensible billing defaults */
export const FRESH_SETTINGS: Record<string, string> = {
  ...DEFAULT_SETTINGS,
  name: 'My Restaurant',
  tagline: '',
  address: '',
  phone: '',
  email: '',
  gstin: '',
  fssai: '',
  packaging_charge: '0',
  invoice_footer: 'Thank you! Please visit again.',
};

// Adds any setting keys introduced by newer versions without touching existing values
export function ensureSettings() {
  // Databases created before the demo flag existed: detect the generated history
  if (!get("SELECT 1 FROM settings WHERE key='demo_data'") && get("SELECT 1 FROM stock_moves WHERE note='Demo history' LIMIT 1")) {
    run("INSERT INTO settings (key, value) VALUES ('demo_data', '1')");
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
  }
}
