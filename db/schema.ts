import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The candidate pool the nightly scan walks. Seeded from the S&P 500; the real
 * market-cap and fundamental gates are applied during the scan, not here.
 */
export const universe = pgTable('universe', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  sector: text('sector').notNull(),
  active: boolean('active').notNull().default(true),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One row per symbol per day: the ~30-day at-the-money implied volatility.
 *
 * This is the most valuable table in the product. IV Rank requires a rolling
 * 52-week history of a ticker's own IV, and no vendor sells that cheaply --
 * ORATS is $99/mo and most providers don't offer it at all. Every day this job
 * runs adds a day of history that cannot be reconstructed later, so the table
 * appreciates on its own and becomes a genuine moat at this price point.
 *
 * Call and put IV are stored separately alongside the blended figure so that a
 * skew signal can be derived later without a schema migration or a backfill.
 */
export const ivSnapshots = pgTable(
  'iv_snapshots',
  {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    /** Blended ATM IV -- the mean of the interpolated call and put IV. */
    atmIv: real('atm_iv').notNull(),
    callIv: real('call_iv'),
    putIv: real('put_iv'),
    /**
     * The provider's own published 30-day IV, when it offers one (CBOE does).
     *
     * Stored rather than discarded because it is an independent second opinion on
     * a number we derived ourselves. On liquid names the two agree to within a
     * tenth of a point; where they diverge, it is a reliable signal that our
     * interpolation had too little to work with.
     */
    publishedIv30: real('published_iv30'),
    /**
     * Tradeable put strikes within 10% of spot -- a data-quality marker.
     *
     * Measured 2026-08-25: divergence from the published IV tracks this almost
     * perfectly. AES had ONE usable near-money strike and came out 6.8 points
     * high; AAPL had six and landed within 0.1. Recording the count lets the read
     * side filter thin readings instead of trusting every row equally, which is
     * strictly better than either silently storing a bad number or dropping the
     * symbol and leaving a hole in its history.
     */
    nearStrikeCount: integer('near_strike_count'),
    spot: real('spot').notNull(),
    /** The expiry actually used, which is the one closest to the 30-day target. */
    expiry: date('expiry').notNull(),
    dte: integer('dte').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Makes the job idempotent: re-running on the same day updates instead of duplicating.
    uniqueIndex('iv_snapshots_symbol_date_idx').on(t.symbol, t.snapshotDate),
    index('iv_snapshots_symbol_idx').on(t.symbol),
  ],
)

/**
 * Observability for the nightly job. Partial failures in a fan-out scan are
 * silent by nature -- a fetcher returns nothing, a layer abstains, and the
 * stored numbers quietly drift below what a live recompute would produce. A run
 * ledger makes that visible instead of leaving it to be discovered downstream.
 */
export const snapshotRuns = pgTable('snapshot_runs', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  attempted: integer('attempted').notNull().default(0),
  succeeded: integer('succeeded').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  /** Sample of failure reasons, for triage without trawling CI logs. */
  notes: text('notes'),
})

export type IvSnapshot = typeof ivSnapshots.$inferSelect
export type UniverseRow = typeof universe.$inferSelect
