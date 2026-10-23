// Restaurants (branches): list, create, archive.
import { fail, ADMIN, api } from '../core/http.js';
import { requirePassword } from '../core/session.js';
import { closeTenantClients } from '../core/events.js';
import { str, text } from '../core/validate.js';
import { audit } from '../core/audit.js';
import { log } from '../core/log.js';
import { run, getSettings, current, withTenant, realTenants, tenantExists, isDemoSlug, registerTenant, archiveTenant, SLUG_RE, type Tenant } from '../db/index.js';
import { seed, ensureSettings } from '../db/seed/index.js';
import { snapshot } from '../services/backup.js';
import { STAFF_USERNAME_RE } from '../../shared/domain.js';

function restaurantInfo(t: Tenant) {
  return withTenant(t, () => {
    const s = getSettings();
    return { slug: t.slug, name: s.name, tagline: s.tagline, logo: s.logo, theme_color: s.theme_color };
  });
}

api.get('/api/restaurants', null, () => realTenants().map(restaurantInfo));


api.post('/api/restaurants', ADMIN, (c) => {
  const b = c.body;
  const name = text(b.name, 'Restaurant name', 60, true)!;
  const slug = (str(b.slug) || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!SLUG_RE.test(slug) || slug === 'main' || isDemoSlug(slug)) fail(400, 'Restaurant code must be 2–31 letters, numbers or dashes');
  if (tenantExists(slug)) fail(400, `A restaurant with code “${slug}” already exists`);
  const admin = {
    name: text(b.admin_name, 'Owner name', 60, true)!,
    username: (text(b.username, 'Username', 30, true) || '').toLowerCase(),
    password: String(b.password || ''),
  };
  if (!STAFF_USERNAME_RE.test(admin.username)) fail(400, 'Username: 3–30 letters, numbers, dot, dash or underscore');
  if (admin.password.length < 6 || admin.password.length > 100) fail(400, 'Password must be 6–100 characters');
  const content = ['demo', 'sample', 'empty'].includes(b.content) ? b.content : 'empty';
  const t = registerTenant(slug);
  withTenant(t, () => {
    seed({ content, admin, name });
    ensureSettings();
    if (content !== 'demo') run("UPDATE settings SET value='0' WHERE key='demo_data'");
    snapshot('startup');
  });
  audit(c, 'restaurant.create', `Created restaurant “${name}” (code ${slug}, ${content}) with owner login “${admin.username}”`);
  return restaurantInfo(t);
});


api.post('/api/restaurants/current/archive', ADMIN, (c) => {
  const t = current();
  if (t.slug === 'main') fail(400, 'The main restaurant cannot be removed');
  const name = getSettings().name;
  if (String(c.body.confirm || '').trim() !== name) fail(400, `Type the restaurant name “${name}” exactly to confirm`);
  requirePassword(c.user, c.body.password);
  snapshot('before-archive');
  closeTenantClients(t.slug);
  const dest = archiveTenant(t.slug);
  log.info(`Restaurant ${t.slug} archived to ${dest} by ${c.user.name}`);
  return { archived_to: dest };
});
