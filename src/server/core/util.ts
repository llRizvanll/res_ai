// Tiny helpers shared by routes and services.
import { get } from '../db/index.js';

export type Id = number | string;
/** Today's date in the server's local time zone (YYYY-MM-DD) */
export const todayStr = (): string => get("SELECT date('now','localtime') AS d")!.d;
export const count = (sql: string, ...p: unknown[]): number => get<{ n: number }>(sql, ...p)!.n;
/** Quotes a file path for use inside an SQL string literal */
export const sqlPath = (p: string) => `'${p.replace(/'/g, "''")}'`;
/** When this server process started (shown in the health panel) */
export const STARTED_AT = new Date().toISOString();
