// Entry point: prepares every restaurant's database, starts the HTTP server and background jobs,
// and shuts down cleanly (final backup + WAL checkpoint) on stop or crash.
import http from 'node:http';
import os from 'node:os';
import { config } from './config.js';
import { get, getSettings, isDemoSlug, listTenants, realTenants, run, withTenant, DATA_DIR, type Tenant } from './db/index.js';
import { seed, ensureSettings } from './db/seed/index.js';
import { handleApi } from './core/dispatch.js';
import { serveStatic } from './core/http.js';
import { allClients } from './core/events.js';
import { log } from './core/log.js';
import { startSchedule, backupIfChanged, AUTO_INTERVAL_MIN } from './services/backup.js';
import { syncRecurring } from './services/finance/index.js';
import './routes/index.js';

/** Brings a restaurant's database up to date: first-run seed, new settings keys, recovery notice */
function prepareTenant(t: Tenant) {
  withTenant(t, () => {
    if (!get('SELECT id FROM users LIMIT 1')) {
      console.log(`[${t.slug}] First run: creating database with demo data…`);
      seed({ content: config.seedDemo ? 'demo' : 'sample' });
    }
    ensureSettings();
    if (t.recoveryNote) {
      run("INSERT INTO settings (key, value) VALUES ('recovery_note', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", t.recoveryNote);
    }
  });
}
for (const t of listTenants()) prepareTenant(t);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) void handleApi(req, res, url);
  else serveStatic(res, url.pathname);
});

let shuttingDown = false;
/** Final backup + WAL checkpoint so every committed bill is in the main database file before exit */
function shutdown(reason: string, code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Shutting down (${reason})…`);
  server.close();
  for (const c of allClients()) c.end();
  for (const t of listTenants()) {
    try {
      if (!isDemoSlug(t.slug)) withTenant(t, () => backupIfChanged(code === 0 ? 'shutdown' : 'crash'));
      t.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      t.db.close();
    } catch (e) {
      log.error(`[${t.slug}] Error while closing the database`, e);
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('uncaughtException', (e) => {
  log.error('Unexpected crash:', e);
  shutdown('crash', 1);
});
process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection:', e));

server.on('error', (e: NodeJS.ErrnoException) => {
  log.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use — is the POS already running?` : 'Server error:', e);
  shutdown('listen error', 1);
});

// ---- background jobs
startSchedule();
// Post recurring expenses that fell due while the server was off, then keep checking
const syncAllRecurring = () => listTenants().forEach((t) => withTenant(t, syncRecurring));
syncAllRecurring();
setInterval(syncAllRecurring, config.recurringCheckMs).unref();

server.listen(config.port, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${config.port}`);
  console.log(`\n  Restaurant POS server is running`);
  console.log(`  ➜ This computer:  http://localhost:${config.port}`);
  for (const u of lan) console.log(`  ➜ Other devices:  ${u}   (tablets / phones on the same Wi-Fi)`);
  console.log(`  Data folder: ${DATA_DIR}`);
  const ts = realTenants();
  console.log(`  Restaurants: ${ts.map((t) => withTenant(t, () => `${getSettings().name} [${t.slug}]`)).join(', ')}`);
  console.log(`  Backups:     every ${AUTO_INTERVAL_MIN} min when data changes + closing-time & daily copies, in each restaurant's backups/ folder\n`);
  log.info(`Server started on port ${config.port}`);
});
