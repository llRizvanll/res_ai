// Seeding a restaurant database: demo, sample or empty content, with the owner's account.
import { get, run, tx } from '../query.js';
import { hashPassword } from '../../core/passwords.js';
import { MENU, INVENTORY, RECIPES, CUSTOMERS, DEMO_ACCOUNTS } from './catalog.js';
import { seedDemoActivity } from './history.js';
import { ensureSettings, FRESH_SETTINGS } from './settings.js';

export interface SeedOptions {
  /** 'demo' = sample menu, tables, stock and 30 days of history; 'sample' = sample setup without history; 'empty' = nothing */
  content?: 'demo' | 'sample' | 'empty';
  /** Owner account to create; when omitted the five demo logins are created (first run only) */
  admin?: { name: string; username: string; password: string };
  name?: string;
}

export function seed({ content = 'demo', admin, name }: SeedOptions = {}) {
  tx(() => {
    if (content === 'empty') {
      for (const [k, v] of Object.entries(FRESH_SETTINGS)) run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
    }
    ensureSettings();
    if (name) run("UPDATE settings SET value=? WHERE key='name'", name);

    const users = admin
      ? [[admin.name, admin.username, admin.password, 'admin']]
      : DEMO_ACCOUNTS;
    for (const [uname, username, pw, role] of users) {
      run('INSERT INTO users (name, username, password, role) VALUES (?,?,?,?)', uname, username!.toLowerCase(), hashPassword(pw!), role);
    }
    if (content === 'empty') return;

    const ground = run('INSERT INTO areas (name, sort) VALUES (?, ?)', 'Ground Floor', 1).id;
    const terrace = run('INSERT INTO areas (name, sort) VALUES (?, ?)', 'Terrace', 2).id;
    for (let i = 1; i <= 10; i++) run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', ground, `T${i}`, i <= 6 ? 4 : 6, i);
    for (let i = 1; i <= 5; i++) run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', terrace, `R${i}`, i <= 3 ? 2 : 8, i);

    let csort = 0;
    for (const [cat, items] of Object.entries(MENU)) {
      const catId = run('INSERT INTO categories (name, sort) VALUES (?, ?)', cat, ++csort).id;
      items.forEach(([name, price, veg, code, variants], idx) => {
        const v = (variants || []).map(([n, p]) => ({ name: n, price: p }));
        run(
          'INSERT INTO items (category_id, name, code, price, tax_rate, veg, variants, sort) VALUES (?,?,?,?,?,?,?,?)',
          catId, name, code, price, 5, veg, JSON.stringify(v), idx,
        );
      });
    }

    for (const [name, unit, stock, min, cost] of INVENTORY) {
      run('INSERT INTO inventory (name, unit, stock, min_stock, cost) VALUES (?,?,?,?,?)', name, unit, stock, min, cost);
    }
    for (const [itemName, parts] of Object.entries(RECIPES)) {
      const item = get('SELECT id FROM items WHERE name=?', itemName);
      for (const [invName, qty] of parts) {
        const inv = get('SELECT id FROM inventory WHERE name=?', invName);
        if (item && inv) run('INSERT INTO recipes (item_id, inventory_id, qty) VALUES (?,?,?)', item.id, inv.id, qty);
      }
    }

    // Sample customers only make sense next to sample sales history
    if (content === 'demo') {
      for (const [cname, phone, birthday] of CUSTOMERS) {
        run('INSERT INTO customers (name, phone, birthday) VALUES (?,?,?)', cname, phone, birthday);
      }
    }

    if (content === 'demo') {
      seedDemoActivity();
      run("UPDATE settings SET value='1' WHERE key='demo_data'");
    }
  });
}

export { DEFAULT_SETTINGS, FRESH_SETTINGS, BRANDING_KEYS, ensureSettings } from './settings.js';
export { DEMO_ACCOUNTS } from './catalog.js';
