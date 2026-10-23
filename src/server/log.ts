// Append-only log file so crashes and backup problems can be investigated later.
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './db.js';

const FILE = path.join(LOG_DIR, 'server.log');
const MAX_BYTES = 5 * 1024 * 1024;

function write(level: string, msg: string) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE + '.1');
    fs.appendFileSync(FILE, line);
  } catch {
    /* logging must never take the till down */
  }
}

export const log = {
  info(msg: string) {
    console.log(msg);
    write('INFO', msg);
  },
  warn(msg: string) {
    console.warn(msg);
    write('WARN', msg);
  },
  error(msg: string, err?: unknown) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack}` : err ? String(err) : '';
    console.error(msg, detail);
    write('ERROR', `${msg} ${detail}`);
  },
};
