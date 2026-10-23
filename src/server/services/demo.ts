// The built-in demo restaurant: full sample data that admins open (in its own tab) for reference.
// It lives in its own database, is never backed up, and is regenerated when it gets old.
import { config } from '../config.js';
import { all, get, getSettings, recreateTenant, registerTenant, run, tenantExists, openTenant, withTenant, type Tenant } from '../db/index.js';
import crypto from 'node:crypto';
import { seed, ensureSettings } from '../db/seed/index.js';
import { hashPassword } from '../core/passwords.js';
import { log } from '../core/log.js';
import { todayStr } from '../core/util.js';

const { slug, name, tagline, refreshDays } = config.demo;

function fill(t: Tenant) {
  withTenant(t, () => {
    seed({ content: 'demo', name });
    ensureSettings();
    // Nobody signs into the demo with a password: it is opened from an admin panel with a one-tab session
    for (const u of all('SELECT id FROM users')) run('UPDATE users SET password=? WHERE id=?', hashPassword(crypto.randomBytes(18).toString('hex')), u.id);
    for (const [k, v] of [['tagline', tagline], ['demo_seeded_at', todayStr()], ['demo_data', '1']]) {
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
    }
  });
  log.info('Demo restaurant data generated');
}

/** The demo restaurant, created or regenerated as needed (`fresh` forces new data) */
export function ensureDemo(fresh = false): Tenant {
  if (!tenantExists(slug)) {
    const t = registerTenant(slug);
    fill(t);
    return t;
  }
  let t = openTenant(slug);
  const seededAt = withTenant(t, () => getSettings().demo_seeded_at || '');
  const stale = !seededAt || withTenant(t, () => get<{ d: string }>("SELECT date('now','localtime',?) AS d", `-${refreshDays} day`)!.d) > seededAt;
  const empty = !withTenant(t, () => get('SELECT 1 FROM users LIMIT 1'));
  if (fresh || stale || empty) {
    t = recreateTenant(slug);
    fill(t);
  }
  return t;
}

/** A session for the demo's owner account, so an admin can look around without knowing its password */
export function demoSession(t: Tenant, token: string) {
  withTenant(t, () => {
    const owner = get("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1")!;
    run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, owner.id);
  });
}
