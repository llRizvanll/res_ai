// One request, start to finish: body → restaurant → route → permissions → handler → activity log → JSON.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { withTenant, type Row } from '../db/index.js';
import { log } from './log.js';
import { fail, guards, readBody, routes, send, type Ctx, type HttpError, type User } from './http.js';
import { authUser, tenantFor } from './session.js';
import { openEventStream } from './events.js';
import { audit, auditSpecFor } from './audit.js';

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? await readBody(req) : {};
    const tenant = tenantFor(req, url, body);
    await withTenant(tenant, async () => {
      if (url.pathname === '/api/events') return openEventStream(req, res, url);
      const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!r) return fail(404, 'Not found');
      const m = url.pathname.match(r.re)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? '')]));
      let user: User | null = null;
      if (r.roles) {
        user = authUser(req, url);
        if (!user) return fail(401, 'Your session has expired. Please log in again.');
        if (!r.roles.includes(user.role)) fail(403, 'Your role does not have permission for this action');
      }
      const c: Ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body, user: user as User };
      for (const g of guards) g(c, r);
      const spec = auditSpecFor(r.method, r.pattern);
      const before = spec?.before?.(c);
      const result = await r.handler(c);
      if (spec) {
        try {
          const entry = spec.after(c, result as Row, before as Row);
          if (entry) audit(c, entry[0], entry[1], entry[2]);
        } catch (e) {
          log.error('Activity log rule failed', e);
        }
      }
      if (!res.writableEnded) send(res, 200, result ?? { ok: true });
    });
  } catch (e) {
    const err = e as Partial<HttpError>;
    let status = err.status || 500;
    let message = err.message || String(e);
    const unique = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(message);
    if (unique) {
      status = 400;
      message = `This ${unique[2]} is already in use`;
    } else if (status === 500) {
      log.error(`${req.method} ${url.pathname} failed:`, e);
      message = 'Server error: ' + message;
    }
    send(res, status, { error: message });
  }
}
