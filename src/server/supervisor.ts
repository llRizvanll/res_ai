// Keeps the POS server running: restarts it automatically if it ever crashes.
// `npm start` runs this; the server itself saves a backup and flushes the database before exiting.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.join(import.meta.dirname, 'server.js');
const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data');
const LOG = path.join(DATA_DIR, 'logs', 'supervisor.log');

let child: ChildProcess | null = null;
let stopping = false;
let delay = 1000;

function note(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(`[supervisor] ${msg}`);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line + '\n');
  } catch {
    /* ignore */
  }
}

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--no-warnings', SERVER], { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    // A server that ran for a while gets a quick restart; repeated instant failures back off up to 30s
    delay = Date.now() - startedAt > 60_000 ? 1000 : Math.min(delay * 2, 30_000);
    note(`Server stopped (code ${code ?? '-'}${signal ? `, ${signal}` : ''}). Restarting in ${delay / 1000}s…`);
    setTimeout(start, delay);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
    else process.exit(0);
  });
}

note('Starting POS server with automatic restart');
start();
