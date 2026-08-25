import 'server-only'

import { desc, eq } from 'drizzle-orm'

import { getDb } from '../../db'
import { screenerResults, type ScreenerRow } from '../../db/schema'

/**
 * Read the most recent completed scan.
 *
 * Deliberately resolves the latest date first and then selects that whole day,
 * rather than ordering the entire table and taking the top N. A scan that is
 * mid-flight or partially failed would otherwise blend two dates into one screen,
 * silently mixing yesterday's numbers with today's.
 */
export async function getLatestScreen(): Promise<{ rows: ScreenerRow[]; date: string | null }> {
  const db = getDb()

  const [latest] = await db
    .select({ date: screenerResults.snapshotDate })
    .from(screenerResults)
    .orderBy(desc(screenerResults.snapshotDate))
    .limit(1)

  if (!latest?.date) return { rows: [], date: null }

  const rows = await db
    .select()
    .from(screenerResults)
    .where(eq(screenerResults.snapshotDate, latest.date))
    .orderBy(desc(screenerResults.setupScore))

  return { rows, date: latest.date }
}
