// Security checks that span routes: staff logins still using the well-known demo passwords.
import { current, get } from '../db/index.js';
import { DEMO_ACCOUNTS } from '../db/seed/index.js';
import { verifyPassword } from '../core/passwords.js';

/** Staff accounts still using a demo password — risky once the app is reachable from outside. Cached briefly (scrypt is slow). */
const weakCache = new Map<string, { at: number; names: string[] }>();
export function demoPasswordAccounts(): string[] {
  const slug = current().slug;
  const hit = weakCache.get(slug);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.names;
  const names = DEMO_ACCOUNTS.flatMap(([, username, pw]) => {
    const u = get('SELECT name, password FROM users WHERE username=? AND active=1', username);
    return u && verifyPassword(pw, u.password) ? [u.name as string] : [];
  });
  weakCache.set(slug, { at: Date.now(), names });
  return names;
}
/** Forget the cached result after a password change */
export const resetWeakPasswordCheck = () => weakCache.delete(current().slug);

