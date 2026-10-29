/**
 * Add the company columns to screener_results and fill them for the latest scan.
 *
 *   pnpm backfill:company
 *
 * The nightly scan writes name, industry, P/E, forward P/E and dividend yield from
 * now on. This exists so the columns are present before the code that reads them
 * deploys, and so today's screen shows them without waiting for tonight's run.
 * Safe to rerun: the ALTERs are IF NOT EXISTS and the updates are idempotent.
 */

import './load-env'

process.env.BATCH_MODE = '1'

import { and, eq, sql } from 'drizzle-orm'

import { UNIVERSE } from '../data/universe'
import { getDb } from '../db'
import { screenerResults } from '../db/schema'
import { mapPool } from '../lib/data'
import { fetchFundamentals } from '../lib/data/fundamentals'

async function main() {
  const db = getDb()

  await db.execute(sql`ALTER TABLE screener_results ADD COLUMN IF NOT EXISTS name text`)
  await db.execute(sql`ALTER TABLE screener_results ADD COLUMN IF NOT EXISTS industry text`)
  await db.execute(sql`ALTER TABLE screener_results ADD COLUMN IF NOT EXISTS trailing_pe real`)
  await db.execute(sql`ALTER TABLE screener_results ADD COLUMN IF NOT EXISTS forward_pe real`)
  await db.execute(sql`ALTER TABLE screener_results ADD COLUMN IF NOT EXISTS dividend_yield real`)
  console.log('[backfill] columns present')

  const [latest] = await db
    .select({ date: screenerResults.snapshotDate })
    .from(screenerResults)
    .orderBy(sql`${screenerResults.snapshotDate} desc`)
    .limit(1)
  if (!latest?.date) {
    console.log('[backfill] no scan rows yet, nothing to fill')
    return
  }

  const rows = await db
    .select({ symbol: screenerResults.symbol })
    .from(screenerResults)
    .where(eq(screenerResults.snapshotDate, latest.date))
  const symbols = rows.map((r) => r.symbol)
  console.log(`[backfill] ${symbols.length} rows on ${latest.date}`)

  // The name is free from the universe list, so every row gets one even if the
  // fundamentals call fails for it.
  const names = new Map(UNIVERSE.map((u) => [u.symbol, u.name]))

  let done = 0
  const results = await mapPool(symbols, 3, async (symbol) => {
    const f = await fetchFundamentals(symbol).catch(() => null)
    await db
      .update(screenerResults)
      .set({
        name: f?.name ?? names.get(symbol) ?? null,
        industry: f?.industry ?? null,
        trailingPe: f?.trailingPe ?? null,
        forwardPe: f?.forwardPe ?? null,
        dividendYield: f?.dividendYield ?? null,
      })
      .where(and(eq(screenerResults.symbol, symbol), eq(screenerResults.snapshotDate, latest.date)))
    if (++done % 50 === 0) console.log(`[backfill] ${done}/${symbols.length}`)
    return f !== null
  })

  const withData = results.filter((r) => r.value).length
  console.log(`[backfill] done: ${withData}/${symbols.length} with fundamentals`)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
