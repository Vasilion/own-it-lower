import 'server-only'

import { desc, eq } from 'drizzle-orm'

import { UNIVERSE } from '../../data/universe'
import { getDb } from '../../db'
import { screenerResults } from '../../db/schema'

const NAMES = new Map(UNIVERSE.map((u) => [u.symbol, u.name]))

/**
 * Only the columns the screener and home page render.
 *
 * The full row is ~40 fields; shipping all of them for ~600 symbols made /screener
 * a 1.4MB page, because the rows are serialised into the client payload for
 * in-browser filtering.
 */
const COLUMNS = {
  symbol: screenerResults.symbol,
  sector: screenerResults.sector,
  name: screenerResults.name,
  setupScore: screenerResults.setupScore,
  qualityScore: screenerResults.qualityScore,
  discountScore: screenerResults.discountScore,
  qualityFailures: screenerResults.qualityFailures,
  trend: screenerResults.trend,
  atmIv: screenerResults.atmIv,
  ivRank: screenerResults.ivRank,
  ivObservations: screenerResults.ivObservations,
  ivToHv: screenerResults.ivToHv,
  bestAnnualized: screenerResults.bestAnnualized,
  bestCollateral: screenerResults.bestCollateral,
  trailingPe: screenerResults.trailingPe,
  forwardPe: screenerResults.forwardPe,
}

export type ScreenRow = {
  [K in keyof typeof COLUMNS]: (typeof COLUMNS)[K]['_']['notNull'] extends true
    ? (typeof COLUMNS)[K]['_']['data']
    : (typeof COLUMNS)[K]['_']['data'] | null
}

/**
 * Read the most recent completed scan.
 *
 * Deliberately resolves the latest date first and then selects that whole day,
 * rather than ordering the entire table and taking the top N. A scan that is
 * mid-flight or partially failed would otherwise blend two dates into one screen,
 * silently mixing yesterday's numbers with today's.
 */
export async function getLatestScreen(): Promise<{ rows: ScreenRow[]; date: string | null }> {
  const db = getDb()

  const [latest] = await db
    .select({ date: screenerResults.snapshotDate })
    .from(screenerResults)
    .orderBy(desc(screenerResults.snapshotDate))
    .limit(1)

  if (!latest?.date) return { rows: [], date: null }

  const rows = await db
    .select(COLUMNS)
    .from(screenerResults)
    .where(eq(screenerResults.snapshotDate, latest.date))
    .orderBy(desc(screenerResults.setupScore))

  // Rows scanned before the name column existed fall back to the universe list.
  return {
    rows: rows.map((r) => ({ ...r, name: r.name ?? NAMES.get(r.symbol) ?? null })),
    date: latest.date,
  }
}
