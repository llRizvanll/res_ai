// Sign-in, sign-out and password changes, with brute-force lock-out.
import crypto from 'node:crypto';
import { fail, type User, ALL, api, clientIp } from '../core/http.js';
import { publicUser } from '../core/session.js';
import { checkPassword } from '../core/validate.js';
import { audit, onAudit } from '../core/audit.js';
import { hashPassword, verifyPassword } from '../core/passwords.js';
import { get, run, getSettings, current, isDemoSlug } from '../db/index.js';
import { config } from '../config.js';
import { resetWeakPasswordCheck } from '../services/security.js';

// Brute-force protection: 5 wrong passwords for a username from one device locks it for 5 minutes
const failedLogins = new Map<string, { n: number; until: number }>();

api.post('/api/auth/login', null, (c) => {
  const { body, req } = c;
  // The demo is only opened from an admin panel, never signed into directly
  if (isDemoSlug(current().slug)) fail(404, 'Restaurant not found');
  const username = String(body.username || '').trim().toLowerCase();
  const key = `${current().slug}|${username}|${clientIp(req)}`;
  const lock = failedLogins.get(key);
  if (lock && lock.until > Date.now()) {
    fail(429, `Too many wrong attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minute(s).`);
  }
  const u = get('SELECT * FROM users WHERE username=? AND active=1', username);
  if (!u || !verifyPassword(String(body.password || ''), u.password)) {
    const n = (lock && lock.until > Date.now() ? lock.n : lock?.n || 0) + 1;
    failedLogins.set(key, { n, until: n >= config.security.lockAfterFailures ? Date.now() + config.security.lockMinutes * 60_000 : 0 });
    audit(c, 'auth.login_failed', `Failed sign-in for “${username.slice(0, 40)}”`, { as: u ? (u as User) : null });
    if (n >= config.security.lockAfterFailures) fail(429, 'Too many wrong attempts. Sign-in is locked for 5 minutes.');
    fail(401, 'Invalid username or password');
  }
  failedLogins.delete(key);
  const token = `${current().slug}.${crypto.randomBytes(24).toString('hex')}`;
  run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, u.id);
  audit(c, 'auth.login', `${u.name} signed in`, { as: u as User });
  run("DELETE FROM sessions WHERE created_at < datetime('now','localtime','-30 day')");
  return { token, user: publicUser(u) };
});


api.get('/api/auth/me', ALL, ({ user }) => ({ user, settings: getSettings(), demo: isDemoSlug(current().slug) }));


api.post('/api/auth/logout', ALL, ({ req }) => {
  run('DELETE FROM sessions WHERE token=?', (req.headers.authorization || '').slice(7));
});


api.post('/api/auth/password', ALL, ({ body, user }) => {
  const u = get('SELECT * FROM users WHERE id=?', user.id)!;
  if (!verifyPassword(String(body.current || ''), u.password)) fail(400, 'Current password is incorrect');
  checkPassword(body.password);
  if (String(body.password) === String(body.current)) fail(400, 'The new password must be different from the current one');
  run('UPDATE users SET password=? WHERE id=?', hashPassword(body.password), user.id);
  resetWeakPasswordCheck();
});


onAudit('POST /api/auth/logout', { after: (c) => ['auth.logout', `${c.user.name} signed out`] });

onAudit('POST /api/auth/password', { after: () => ['auth.password', 'Changed own password'] });
