// HTTP primitives: typed errors, request context, the route registry, body parsing and static files.
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ROLE_GROUPS, ROLES, type Role } from '../../shared/domain.js';

export { ROLES, type Role };
export const { ADMIN, MGR, FRONT, SERVICE, ALL } = ROLE_GROUPS;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Declared as a function (not an arrow) so TypeScript narrows after `if (...) fail(...)`
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}
// Request bodies are untrusted JSON; every handler validates the fields it reads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = Record<string, any>;
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Body;
  user: User; // always set on routes that declare roles
}
export type Handler = (ctx: Ctx) => unknown;
export interface Route {
  method: string;
  pattern: string;
  re: RegExp;
  keys: string[];
  roles: Role[] | null;
  handler: Handler;
}

// ---- route registry: feature modules register here; the dispatcher looks routes up
export const routes: Route[] = [];
function route(method: string, pattern: string, roles: Role[] | null, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, re, keys, roles, handler });
}
type Register = (pattern: string, roles: Role[] | null, handler: Handler) => void;
/** `roles: null` marks a public route (no sign-in needed) */
export const api: Record<'get' | 'post' | 'put' | 'patch' | 'del', Register> = {
  get: (p, r, h) => route('GET', p, r, h),
  post: (p, r, h) => route('POST', p, r, h),
  put: (p, r, h) => route('PUT', p, r, h),
  patch: (p, r, h) => route('PATCH', p, r, h),
  del: (p, r, h) => route('DELETE', p, r, h),
};

/** Cross-cutting checks run after sign-in and role checks, before the handler (e.g. demo restrictions) */
export type Guard = (c: Ctx, route: Route) => void;
export const guards: Guard[] = [];
export const addGuard = (g: Guard) => guards.push(g);

export function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > config.security.maxBodyBytes) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Browser hardening sent with every response. Scripts may only come from this server (no inline scripts);
 * inline styles and data: images (logos) are allowed because the UI uses them.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** The visitor's IP; behind a trusted proxy/tunnel use the address it forwards */
export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const h = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    if (h && String(h).trim()) return String(h).trim();
  }
  return String(req.socket.remoteAddress || '').replace('::ffff:', '');
}

export function send(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
/** Photos never change under the same name, so browsers may keep them for a day; everything else is re-checked */
const LONG_CACHE = new Set(['.jpg', '.jpeg', '.webp']);
/** The landing page used to live at /home; the app shell lives in public/app/ */
const MOVED: Record<string, string> = { '/home': '/', '/home/': '/' };
const APP_SHELL = path.join('app', 'index.html');
/**
 * Serves the website. "/" is the landing page; a folder with its own index.html (e.g. /app, the restaurant app)
 * gets that page; other unknown extension-less paths fall back to the app shell (client-side routing).
 */
export function serveStatic(res: ServerResponse, pathname: string) {
  const PUBLIC = config.publicDir;
  if (MOVED[pathname]) {
    res.writeHead(301, { Location: MOVED[pathname] }).end();
    return;
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(path.join(file, 'index.html'))) {
    // Without the trailing slash, relative links inside that page would resolve one level too high
    if (!pathname.endsWith('/')) {
      // Built from the resolved folder, never the raw path, so "//host" can't become an off-site redirect
      res.writeHead(301, { Location: `/${path.relative(PUBLIC, file).split(path.sep).map(encodeURIComponent).join('/')}/` }).end();
      return;
    }
    file = path.join(file, 'index.html');
  } else if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = path.join(PUBLIC, APP_SHELL);
  }
  const ext = path.extname(file);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': LONG_CACHE.has(ext) ? 'public, max-age=86400' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
