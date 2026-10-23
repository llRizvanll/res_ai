// Who is calling, and for which restaurant. Tokens look like "<restaurant>.<random>".
import type { IncomingMessage } from 'node:http';
import { get, openTenant, tenantExists, SLUG_RE, type Row, type Tenant } from '../db/index.js';
import { verifyPassword } from './passwords.js';
import { fail, type Body, type User } from './http.js';

export function tokenOf(req: IncomingMessage, url: URL): string | null {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
}

/** The restaurant a request belongs to: from the token, else the sign-in body / ?r=, else "main" */
export function tenantFor(req: IncomingMessage, url: URL, body: Body): Tenant {
  const token = tokenOf(req, url);
  const slug = (token && token.includes('.') ? token.split('.')[0] : null) || String(body.restaurant || url.searchParams.get('r') || 'main');
  if (slug !== 'main' && (!SLUG_RE.test(slug) || !tenantExists(slug))) fail(404, 'Restaurant not found');
  return openTenant(slug);
}

export function authUser(req: IncomingMessage, url: URL): User | null {
  const token = tokenOf(req, url);
  if (!token) return null;
  return (
    get<User>('SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1', token) || null
  );
}

/** Re-confirms the signed-in user's password before dangerous actions (reset, restore, remove restaurant) */
export function requirePassword(user: User, password: unknown) {
  const u = get('SELECT password FROM users WHERE id=?', user.id)!;
  if (!verifyPassword(String(password || ''), u.password)) fail(403, 'Your password is incorrect');
}

export const publicUser = (u: Row): User => ({ id: u.id, name: u.name, username: u.username, role: u.role });
