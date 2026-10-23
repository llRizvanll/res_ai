// Live updates over Server-Sent Events, kept per restaurant so branches never see each other's events.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { current } from '../db/index.js';
import { config } from '../config.js';
import { fail } from './http.js';
import { authUser } from './session.js';

/** Event names screens listen for */
export const ALL_EVENTS = ['settings', 'menu', 'tables', 'orders', 'kot'];

const clients = new Map<string, Set<ServerResponse>>();
export const allClients = () => [...clients.values()].flatMap((s) => [...s]);

/** Tells every screen of the current restaurant that something changed */
export function broadcast(...events: string[]) {
  const set = clients.get(current().slug);
  if (!set) return;
  for (const ev of events) {
    const msg = `event: ${ev}\ndata: {}\n\n`;
    for (const c of set) c.write(msg);
  }
}

/** Disconnects every screen of one restaurant (used when it is archived) */
export function closeTenantClients(slug: string) {
  for (const res of clients.get(slug) || []) res.end();
  clients.delete(slug);
}

setInterval(() => {
  for (const c of allClients()) c.write(': ping\n\n');
}, config.sseKeepAliveMs).unref();

export function openEventStream(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!authUser(req, url)) fail(401, 'Please log in');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const slug = current().slug;
  if (!clients.has(slug)) clients.set(slug, new Set());
  clients.get(slug)!.add(res);
  req.on('close', () => clients.get(slug)?.delete(res));
}
