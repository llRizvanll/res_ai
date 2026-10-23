// Every tunable in one place. Values come from environment variables with safe defaults,
// so a shop can be configured without touching code (see README → Configuration).
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const int = (name: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v !== 0 ? Math.min(max, Math.max(min, Math.round(v))) : def;
};

export const config = Object.freeze({
  /** Set TRUST_PROXY=1 when running behind Cloudflare Tunnel, Caddy, Nginx… so real visitor IPs are used */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** Number formatting in generated text (Indian grouping: 1,00,000) */
  locale: 'en-IN',
  port: int('PORT', 3000, 1, 65535),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  publicDir: path.join(root, 'public'),
  /** First run creates 30 days of demo sales unless SEED_DEMO=0 */
  seedDemo: process.env.SEED_DEMO !== '0',

  backup: Object.freeze({
    intervalMin: int('BACKUP_INTERVAL_MIN', 30, 1),
    /** How often the closing-time check runs; tests shorten it */
    closingCheckSec: int('CLOSING_CHECK_SEC', 60, 1),
    mirrorDir: (process.env.BACKUP_MIRROR_DIR || '').trim() || null,
    defaultClosingTime: '23:30',
    /** Copies kept per automatic kind; kinds not listed are kept until deleted */
    keep: Object.freeze({
      auto: 96,
      daily: 90,
      closing: 400,
      startup: 10,
      shutdown: 10,
      crash: 10,
      'before-delete': 40,
      'before-restore': 20,
    } as Record<string, number>),
  }),

  security: Object.freeze({
    lockAfterFailures: int('LOGIN_LOCK_AFTER', 5, 1),
    lockMinutes: int('LOGIN_LOCK_MINUTES', 5, 1),
    sessionDays: int('SESSION_DAYS', 30, 1),
    maxBodyBytes: 2_000_000,
    /** Passwords rejected as too easy to guess */
    weakPasswords: ['123456', 'password', 'admin123', '111111', 'qwerty'],
  }),

  limits: Object.freeze({
    logoChars: 700_000, // ~500 KB image once base64-encoded
    kotLines: 100,
    recipeLines: 50,
    variants: 20,
    listMax: 5000,
  }),

  /** The built-in reference restaurant admins can open from the admin panel */
  demo: Object.freeze({
    slug: 'demo',
    name: 'Demo Restaurant',
    tagline: 'Reference data — try anything here',
    /** Demo data is regenerated when older than this, so its dates stay current */
    refreshDays: int('DEMO_REFRESH_DAYS', 7, 1),
  }),

  /** Growth & insights model */
  forecast: Object.freeze({
    historyDays: 120, // complete days loaded for comparisons and patterns
    modelDays: 90, // days the trend line is fitted on
    horizonDays: 90, // days forecast ahead
    minDays: 14, // no forecast with less sales history than this
    bandZ: 1.28, // likely range = ±1.28 standard deviations (≈80%)
    /** Comparisons are hidden when the earlier period had sales on fewer than this share of days */
    minComparableCoverage: 0.6,
    /** Dishes need this many portions across both periods to count as rising/falling */
    minItemVolume: 5,
    daysPerMonth: 30.4,
    /** Used until there is enough history to measure them */
    fallbackFoodCostRatio: 0.3,
    fallbackNetToGross: 0.95,
  }),

  /** Hourly check for recurring expenses that fell due */
  recurringCheckMs: 3_600_000,
  sseKeepAliveMs: 25_000,
});

export type Config = typeof config;
