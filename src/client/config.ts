// Browser-side settings in one place: locale, quick-pick presets, alert thresholds and refresh timings.
// Server-side settings live in src/server/config.ts; benchmarks shared by both in src/shared/benchmarks.ts.

export const UI_CONFIG = Object.freeze({
  /** Number and date formatting (Indian grouping: 1,00,000) */
  locale: 'en-IN',

  /** One-tap choices offered in dialogs */
  presets: Object.freeze({
    cookingNotes: ['Less spicy', 'Extra spicy', 'No onion', 'No garlic', 'Jain', 'Less oil', 'Parcel'],
    orderNotes: ['Birthday', 'Rush order', 'VIP guest', 'Serve together'],
    cancelReasons: ['Customer left', 'Wrong order', 'Duplicate order', 'Kitchen unable to serve'],
    voidReasons: ['Customer changed mind', 'Wrong item', 'Quality issue', 'Delay'],
    discountPercents: [5, 10, 15, 20],
  }),

  /** When a KOT card turns amber / red on the kitchen display (minutes since it was sent) */
  kitchen: Object.freeze({ warnAfterMin: 15, lateAfterMin: 25 }),
  /** A table is flagged as overdue after this many minutes */
  tableOverdueMin: 60,

  /** Background refresh and timing (milliseconds) */
  timing: Object.freeze({
    clockMs: 15_000,
    tablesRefreshMs: 30_000,
    kitchenRefreshMs: 20_000,
    reconnectCheckMs: 4_000,
    searchDebounceMs: 200,
    toastMs: 2_600,
    errorToastMs: 4_500,
  }),
});
