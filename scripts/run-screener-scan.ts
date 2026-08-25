/**
 * Nightly universe scan.
 *
 *   pnpm scan            # full universe
 *   pnpm scan AAPL KO    # named symbols
 *   pnpm scan --dry KO   # compute and print, write nothing
 *
 * Produces one `screener_results` row per symbol per day: quality, discount, IV
 * rank, and a single representative near-30-delta contract so the screener can show
 * a concrete number rather than an abstract score.
 *
 * Runs in GitHub Actions, never in a request path. It fans out to roughly three
 * third-party calls per symbol across two hosts, and takes minutes.
 */

import './load-env'

// Batch job: queue patiently behind the rate limiter rather than failing fast.
process.env.BATCH_MODE = '1'

import { desc, eq, inArray, sql } from 'drizzle-orm'

import { UNIVERSE } from '../data/universe'
import { getDb } from '../db'
import { ivSnapshots, screenerResults, snapshotRuns } from '../db/schema'
import { mapPool } from '../lib/data'
import { computeIvRank } from '../lib/engine/ivrank'
import { impliedToRealized, realizedVolatility } from '../lib/engine/realized-vol'
import { scoreSetup } from '../lib/engine/setup'
import { analyzeSymbol } from '../lib/server/analyze'
import { BatchWriter } from './batch-writer'

const CONCURRENCY = 3
const TARGET_DELTA = 0.3
const MIN_DTE = 21
const MAX_DTE = 49
const PERMANENT_FAILURE = /http 40[34]/

function marketDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

type ScanRow = typeof screenerResults.$inferInsert

/** Closes are not on the payload directly, but the bars carry them. */
function closesFrom(data: Awaited<ReturnType<typeof analyzeSymbol>>): number[] {
  return data.bars.map((b) => b.close)
}

/**
 * Load each symbol's IV history in one query rather than one per symbol.
 *
 * 503 separate round trips to Neon would dominate the scan's wall-clock and add
 * nothing — the whole table is small enough to slice in memory.
 */
async function loadIvHistory(symbols: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (symbols.length === 0) return out

  const rows = await getDb()
    .select({ symbol: ivSnapshots.symbol, atmIv: ivSnapshots.atmIv })
    .from(ivSnapshots)
    .where(inArray(ivSnapshots.symbol, symbols))
    .orderBy(desc(ivSnapshots.snapshotDate))

  for (const r of rows) {
    const list = out.get(r.symbol) ?? []
    // Cap at a year of trading days; older observations are outside the rank window.
    if (list.length < 252) list.push(r.atmIv)
    out.set(r.symbol, list)
  }
  return out
}

async function scanSymbol(symbol: string, today: string, ivHistory: number[]): Promise<ScanRow> {
  const data = await analyzeSymbol(symbol)
  const t = data.technicals
  const f = data.fundamentals

  // Latest observation is the head of the history; rank it against the rest.
  const currentIv = ivHistory[0] ?? null
  const ivr =
    currentIv !== null ? computeIvRank(currentIv, ivHistory.slice(1)) : null

  const hv30 = realizedVolatility(data.technicals ? closesFrom(data) : [], 30)

  const setup = scoreSetup({
    qualityScore: data.quality?.score ?? null,
    discountScore: data.context.discountScore ?? null,
    ivRank: ivr?.ivRank ?? null,
    qualityFailures: data.quality?.failures ?? [],
  })

  // Representative contract: closest to 30-delta inside the standard window, with a
  // real market. Illustration, not recommendation -- the deep-dive does the ranking.
  const candidates = data.puts
    .map((p) => ({ p, dte: data.dte[p.expiration] }))
    .filter(
      ({ p, dte }) =>
        dte >= MIN_DTE &&
        dte <= MAX_DTE &&
        p.bid > 0 &&
        p.openInterest >= 25 &&
        p.delta !== null &&
        Math.abs(p.delta) > 0,
    )
    .sort(
      (a, b) => Math.abs(Math.abs(a.p.delta!) - TARGET_DELTA) - Math.abs(Math.abs(b.p.delta!) - TARGET_DELTA),
    )

  const best = candidates[0]
  const bestMetrics = best
    ? (() => {
        const breakeven = best.p.strike - best.p.bid
        const staticReturn = breakeven > 0 ? best.p.bid / breakeven : 0
        return {
          bestStrike: best.p.strike,
          bestExpiry: best.p.expiration,
          bestDte: best.dte,
          bestDelta: Math.abs(best.p.delta!),
          bestPremium: best.p.bid,
          bestAnnualized: best.dte > 0 ? staticReturn * (365 / best.dte) : 0,
          bestDownsideBuffer: data.spot > 0 ? (data.spot - breakeven) / data.spot : 0,
          bestOpenInterest: best.p.openInterest,
          bestCollateral: breakeven * 100,
        }
      })()
    : {}

  return {
    symbol,
    snapshotDate: today,
    spot: data.spot,
    sector: f?.sector ?? UNIVERSE.find((u) => u.symbol === symbol)?.sector ?? null,
    setupScore: setup.score,
    qualityScore: data.quality?.score ?? null,
    discountScore: data.context.discountScore ?? null,
    qualityFailures: data.quality?.failures.length ? data.quality.failures.join(' | ') : null,
    trend: t.trend,
    sma200: t.sma200,
    distanceFrom200: t.distanceFrom200,
    rsi14: t.rsi14,
    percentB: t.percentB,
    marketCap: f?.marketCap ?? null,
    debtToEquity: f?.debtToEquity ?? null,
    freeCashflow: f?.freeCashflow ?? null,
    nextEarnings: f?.nextEarnings ?? null,
    atmIv: currentIv,
    ivRank: ivr?.ivRank ?? null,
    ivObservations: ivHistory.length,
    hv30,
    ivToHv: impliedToRealized(currentIv, hv30),
    ...bestMetrics,
  }
}

/** Upsert one batch of scan rows. */
async function writeBatch(rows: ScanRow[]): Promise<void> {
  await getDb()
    .insert(screenerResults)
    .values(rows)
    .onConflictDoUpdate({
      target: [screenerResults.symbol, screenerResults.snapshotDate],
      set: {
        spot: sql`excluded.spot`,
        sector: sql`excluded.sector`,
        setupScore: sql`excluded.setup_score`,
        qualityScore: sql`excluded.quality_score`,
        discountScore: sql`excluded.discount_score`,
        qualityFailures: sql`excluded.quality_failures`,
        trend: sql`excluded.trend`,
        sma200: sql`excluded.sma200`,
        distanceFrom200: sql`excluded.distance_from_200`,
        rsi14: sql`excluded.rsi14`,
        percentB: sql`excluded.percent_b`,
        marketCap: sql`excluded.market_cap`,
        debtToEquity: sql`excluded.debt_to_equity`,
        freeCashflow: sql`excluded.free_cashflow`,
        nextEarnings: sql`excluded.next_earnings`,
        atmIv: sql`excluded.atm_iv`,
        ivRank: sql`excluded.iv_rank`,
        ivObservations: sql`excluded.iv_observations`,
        hv30: sql`excluded.hv30`,
        ivToHv: sql`excluded.iv_to_hv`,
        bestStrike: sql`excluded.best_strike`,
        bestExpiry: sql`excluded.best_expiry`,
        bestDte: sql`excluded.best_dte`,
        bestDelta: sql`excluded.best_delta`,
        bestPremium: sql`excluded.best_premium`,
        bestAnnualized: sql`excluded.best_annualized`,
        bestDownsideBuffer: sql`excluded.best_downside_buffer`,
        bestOpenInterest: sql`excluded.best_open_interest`,
        bestCollateral: sql`excluded.best_collateral`,
      },
    })
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry')
  const requested = argv.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase())
  const symbols = requested.length > 0 ? requested : UNIVERSE.map((m) => m.symbol)
  const today = marketDate()

  console.log(`[scan] ${today} — ${symbols.length} symbols${dryRun ? ' — DRY RUN' : ''}`)

  const ivHistory = dryRun ? new Map<string, number[]>() : await loadIvHistory(symbols)
  if (!dryRun) {
    const withHistory = [...ivHistory.values()].filter((h) => h.length >= 40).length
    console.log(
      `[scan] IV history loaded for ${ivHistory.size} symbols; ${withHistory} have enough for a rank`,
    )
  }

  let runId: number | null = null
  if (!dryRun) {
    const [run] = await getDb()
      .insert(snapshotRuns)
      .values({ attempted: symbols.length })
      .returning({ id: snapshotRuns.id })
    runId = run.id
  }

  const started = Date.now()

  // Rows are written as they arrive, not accumulated for a single insert at the
  // end. A 20-minute job that fails at symbol 590 would otherwise discard every
  // row it had already computed, and the only symptom would be an empty screen
  // the next morning.
  const writer = new BatchWriter<ScanRow>(
    50,
    async (batch) => {
      if (!dryRun) await writeBatch(batch)
    },
    // Progress lands on the run ledger too, so a scan in flight can be watched
    // from the database rather than only from the console.
    async (total) => {
      console.log(`[scan] ${total}/${symbols.length} written`)
      if (runId !== null) {
        await getDb().update(snapshotRuns).set({ succeeded: total }).where(eq(snapshotRuns.id, runId))
      }
    },
  )

  const results = await mapPool(symbols, CONCURRENCY, async (s) => {
    const row = await scanSymbol(s, today, ivHistory.get(s) ?? [])
    writer.add(row)
    return row
  })

  const rows = results.flatMap((r) => (r.value ? [r.value] : []))
  let failures = results.filter((r) => r.error)

  // Same retry-sweep reasoning as the IV job: a transient failure otherwise leaves
  // this symbol missing from today's screen with no visible sign anything is wrong.
  const retryable = failures.filter((f) => !PERMANENT_FAILURE.test(f.error!.message))
  if (retryable.length > 0) {
    console.log(`[scan] retry sweep on ${retryable.length}...`)
    const swept = await mapPool(
      retryable.map((f) => f.item as string),
      1,
      async (s) => {
        const row = await scanSymbol(s, today, ivHistory.get(s) ?? [])
        writer.add(row)
        return row
      },
    )
    rows.push(...swept.flatMap((r) => (r.value ? [r.value] : [])))
    const stillBad = new Set(swept.filter((r) => r.error).map((r) => r.item))
    failures = failures.filter((f) => stillBad.has(f.item) || PERMANENT_FAILURE.test(f.error!.message))
  }

  const { written, failedBatches } = await writer.drain()
  if (failedBatches > 0) console.error(`[scan] ${failedBatches} batches failed to write`)

  if (runId !== null) {
    const reasons = [...new Set(failures.map((f) => f.error!.message))].slice(0, 10)
    await getDb()
      .update(snapshotRuns)
      .set({
        finishedAt: new Date(),
        succeeded: written,
        failed: failures.length,
        notes: `screener-scan${reasons.length ? `: ${reasons.join(' | ')}` : ''}`,
      })
      .where(eq(snapshotRuns.id, runId))
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`[scan] done in ${secs}s — ${rows.length} stored, ${failures.length} failed`)

  const disqualified = rows.filter((r) => r.qualityFailures).length
  const withContract = rows.filter((r) => r.bestStrike).length
  console.log(
    `[scan] ${disqualified} below the quality floor · ${withContract} have a tradeable 30-delta put`,
  )

  const top = [...rows]
    .filter((r) => r.setupScore !== null && !r.qualityFailures)
    .sort((a, b) => (b.setupScore ?? 0) - (a.setupScore ?? 0))
    .slice(0, 12)

  console.log('\n  setup  symbol  trend                 qual  disc   ann.ret   strike   dte')
  for (const r of top) {
    console.log(
      '  ' +
        String(Math.round(r.setupScore ?? 0)).padStart(5) +
        `  ${r.symbol.padEnd(6)}` +
        `  ${(r.trend ?? '').padEnd(20)}` +
        String(Math.round(r.qualityScore ?? 0)).padStart(5) +
        String(Math.round(r.discountScore ?? 0)).padStart(6) +
        (r.bestAnnualized ? `${(r.bestAnnualized * 100).toFixed(1)}%`.padStart(10) : '         —') +
        (r.bestStrike ? `$${r.bestStrike.toFixed(2)}`.padStart(9) : '        —') +
        String(r.bestDte ?? '—').padStart(6),
    )
  }

  const rate = symbols.length > 0 ? rows.length / symbols.length : 0
  if (rate < 0.8) {
    console.error(`[scan] FAILING: only ${(rate * 100).toFixed(0)}% stored (need 80%)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[scan] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
