/**
 * Daily 30-day at-the-money implied volatility snapshot.
 *
 * Run nightly. Every execution appends one row per symbol to `iv_snapshots`, and
 * those rows are what IV Rank is later computed from. History cannot be backfilled
 * from a cheap source, so a day this job does not run is a day of data permanently
 * lost -- which is why it exists before any UI does.
 *
 *   pnpm snapshot:iv                  # full universe
 *   pnpm snapshot:iv AAPL MSFT        # named symbols, for spot checks
 *   pnpm snapshot:iv --dry AAPL       # fetch and parse only, no database needed
 */

// Must come first: it populates process.env before db/index.ts reads DATABASE_URL.
import './load-env'

import { eq, sql } from 'drizzle-orm'

import { UNIVERSE } from '../data/universe'
import { getDb } from '../db'
import { ivSnapshots, snapshotRuns, universe } from '../db/schema'
import { getOptionsProvider, mapPool, type OptionQuote, type OptionsProvider } from '../lib/data'
import { CboeProvider } from '../lib/data/providers/cboe'

const TARGET_DTE = 30
const MIN_DTE = 14
const MAX_DTE = 60
/**
 * The provider's rate limiter does the real pacing, but concurrency still matters:
 * CBOE payloads are ~1.5MB each, and many simultaneous large transfers draw 429s
 * even when the request rate looks acceptable. Keep the in-flight count small.
 */
const CONCURRENCY = 3

/** Symbols with no chain at the provider (403/404) — retrying them is pointless. */
const PERMANENT_FAILURE = /http 40[34]/

/** Trading date in US market terms, so a late-night UTC run still books to the right day. */
function marketDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function dteFrom(iso: string, now = Date.now()): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - now) / 86_400_000)
}

/**
 * Keep only quotes with a genuine two-sided market and a real IV.
 *
 * Vendors return rows for strikes that have never traded, carrying placeholder IV
 * and a 0/0 market -- Yahoo's free endpoint served a repeating 0.500005 across
 * entire chains. Interpolating across those poisons the ATM figure with a number
 * nobody ever quoted, and it fails silently: the output is a plausible float, not
 * an error.
 */
function tradeable(q: OptionQuote): boolean {
  return (
    typeof q.impliedVolatility === 'number' &&
    Number.isFinite(q.impliedVolatility) &&
    q.impliedVolatility > 0.001 &&
    q.impliedVolatility < 5 &&
    Number.isFinite(q.strike) &&
    q.strike > 0 &&
    (q.bid > 0 || q.openInterest > 0)
  )
}

/** Linearly interpolate IV at the spot price from the two strikes bracketing it. */
function atmIv(quotes: OptionQuote[], spot: number): number | null {
  const usable = quotes.filter(tradeable).sort((a, b) => a.strike - b.strike)
  if (usable.length === 0) return null
  if (usable.length === 1) return usable[0].impliedVolatility

  const above = usable.find((q) => q.strike >= spot)
  const below = [...usable].reverse().find((q) => q.strike <= spot)

  // Spot sits outside the usable strike range -- fall back to the closest strike.
  if (!above || !below) return (above ?? below)!.impliedVolatility
  if (above.strike === below.strike) return above.impliedVolatility

  const w = (spot - below.strike) / (above.strike - below.strike)
  return below.impliedVolatility! + w * (above.impliedVolatility! - below.impliedVolatility!)
}

interface SnapshotRow {
  symbol: string
  snapshotDate: string
  atmIv: number
  callIv: number | null
  putIv: number | null
  publishedIv30: number | null
  nearStrikeCount: number
  spot: number
  expiry: string
  dte: number
}

/** Strikes this close to spot are what the ATM interpolation actually rests on. */
const NEAR_MONEY_BAND = 0.1

function countNearMoney(quotes: OptionQuote[], spot: number): number {
  return quotes.filter((q) => tradeable(q) && Math.abs(q.strike - spot) / spot <= NEAR_MONEY_BAND).length
}

async function snapshotSymbol(
  provider: OptionsProvider,
  symbol: string,
  today: string,
  knownSpot?: number,
): Promise<SnapshotRow> {
  const expirations = await provider.listExpirations(symbol)
  if (expirations.length === 0) throw new Error('no expirations listed')

  const now = Date.now()
  const target = expirations
    .map((iso) => ({ iso, dte: dteFrom(iso, now) }))
    .filter((e) => e.dte >= MIN_DTE && e.dte <= MAX_DTE)
    .sort((a, b) => Math.abs(a.dte - TARGET_DTE) - Math.abs(b.dte - TARGET_DTE))[0]

  if (!target) throw new Error(`no expiry within ${MIN_DTE}-${MAX_DTE} DTE`)

  const chain = await provider.getChain(symbol, target.iso, { spot: knownSpot })
  if (!chain.spot) throw new Error('no spot price')

  const callIv = atmIv(chain.calls, chain.spot)
  const putIv = atmIv(chain.puts, chain.spot)

  // Blending call and put IV cancels most of the directional skew that would
  // otherwise make the series track sentiment rather than volatility.
  const blended = callIv !== null && putIv !== null ? (callIv + putIv) / 2 : (callIv ?? putIv)
  if (blended === null) throw new Error('no tradeable strikes near the money')

  // Free second opinion from providers that publish their own 30-day IV.
  const publishedIv30 =
    provider instanceof CboeProvider ? await provider.getPublishedIv30(symbol) : null

  return {
    symbol,
    snapshotDate: today,
    atmIv: blended,
    callIv,
    putIv,
    publishedIv30,
    nearStrikeCount: countNearMoney(chain.puts, chain.spot),
    spot: chain.spot,
    expiry: target.iso,
    dte: target.dte,
  }
}

async function seedUniverse(): Promise<void> {
  const rows = UNIVERSE.map((m) => ({ symbol: m.symbol, name: m.name, sector: m.sector }))
  for (let i = 0; i < rows.length; i += 200) {
    await getDb()
      .insert(universe)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: universe.symbol,
        set: { name: sql`excluded.name`, sector: sql`excluded.sector` },
      })
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry')
  const requested = argv.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase())
  const symbols = requested.length > 0 ? requested : UNIVERSE.map((m) => m.symbol)
  const today = marketDate()

  const provider = getOptionsProvider()

  // Refuse to run against a source that cannot supply IV. Writing a table full of
  // nulls or placeholders would be worse than writing nothing: the gap would be
  // invisible until someone tried to compute a rank from it months later.
  if (!provider.suppliesIv) {
    console.error(
      `[snapshot-iv] ABORT: provider "${provider.name}" does not supply usable implied volatility.\n` +
        `Run "pnpm check:provider" for details, and configure a provider that does.`,
    )
    process.exit(1)
  }

  console.log(
    `[snapshot-iv] ${today} — ${symbols.length} symbols via ${provider.name}` +
      (dryRun ? ' — DRY RUN, nothing will be written' : ''),
  )

  if (!dryRun && requested.length === 0) {
    await seedUniverse()
    console.log(`[snapshot-iv] universe seeded (${UNIVERSE.length} members)`)
  }

  // One batched call per 100 symbols instead of one per symbol.
  let spots = new Map<string, number>()
  if (provider.getSpots) {
    spots = await provider.getSpots(symbols)
    console.log(`[snapshot-iv] prefetched ${spots.size}/${symbols.length} spot prices`)
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
  const results = await mapPool(symbols, CONCURRENCY, (s) =>
    snapshotSymbol(provider, s, today, spots.get(s)),
  )

  const rows = results.flatMap((r) => (r.value ? [r.value] : []))
  let failures = results.filter((r) => r.error)

  /**
   * Retry sweep.
   *
   * Transient failures mid-scan are the quiet killer here: the symbol simply has
   * no row for the day, the job still reports mostly-success, and the gap only
   * surfaces months later as a hole in that ticker's IV history. By the time the
   * sweep runs the rate limiter has widened its pacing, so a second pass over a
   * much smaller set usually clears most of them.
   */
  const retryable = failures.filter((f) => !PERMANENT_FAILURE.test(f.error!.message))
  if (retryable.length > 0) {
    console.log(`[snapshot-iv] retry sweep on ${retryable.length} transient failures...`)
    const swept = await mapPool(
      retryable.map((f) => f.item as string),
      1,
      (s) => snapshotSymbol(provider, s, today, spots.get(s)),
    )

    const recovered = swept.flatMap((r) => (r.value ? [r.value] : []))
    rows.push(...recovered)

    const stillBad = new Set(swept.filter((r) => r.error).map((r) => r.item))
    failures = failures.filter((f) => stillBad.has(f.item) || PERMANENT_FAILURE.test(f.error!.message))
    console.log(`[snapshot-iv] sweep recovered ${recovered.length}, ${failures.length} still failing`)
  }

  if (!dryRun && rows.length > 0) {
    for (let i = 0; i < rows.length; i += 100) {
      await getDb()
        .insert(ivSnapshots)
        .values(rows.slice(i, i + 100))
        .onConflictDoUpdate({
          target: [ivSnapshots.symbol, ivSnapshots.snapshotDate],
          set: {
            atmIv: sql`excluded.atm_iv`,
            callIv: sql`excluded.call_iv`,
            putIv: sql`excluded.put_iv`,
            publishedIv30: sql`excluded.published_iv30`,
            nearStrikeCount: sql`excluded.near_strike_count`,
            spot: sql`excluded.spot`,
            expiry: sql`excluded.expiry`,
            dte: sql`excluded.dte`,
          },
        })
    }
  }

  // Keep a sample of reasons on the run row so triage doesn't require trawling CI logs.
  const reasons = [...new Set(failures.map((f) => f.error!.message))].slice(0, 10)
  if (runId !== null) {
    await getDb()
      .update(snapshotRuns)
      .set({
        finishedAt: new Date(),
        succeeded: rows.length,
        failed: failures.length,
        notes: reasons.length > 0 ? reasons.join(' | ') : null,
      })
      .where(eq(snapshotRuns.id, runId))
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[snapshot-iv] done in ${secs}s — ${rows.length} stored, ${failures.length} failed`)

  // Thin near-money chains are where our interpolation drifts from the provider's
  // own published IV. Surface them rather than letting them blend into the average.
  const thin = rows.filter((r) => r.nearStrikeCount < 3)
  const diverged = rows.filter(
    (r) => r.publishedIv30 !== null && Math.abs(r.atmIv - r.publishedIv30) > 0.03,
  )
  console.log(
    `[snapshot-iv] quality: ${thin.length} thin (<3 near-money strikes), ` +
      `${diverged.length} diverge >3pts from published IV`,
  )
  if (diverged.length > 0) {
    for (const r of diverged.slice(0, 8)) {
      console.log(
        `  ${r.symbol.padEnd(6)} ours ${(r.atmIv * 100).toFixed(1)}% vs published ` +
          `${(r.publishedIv30! * 100).toFixed(1)}%  (${r.nearStrikeCount} near strikes)`,
      )
    }
  }

  for (const r of rows.slice(0, dryRun ? 20 : 5)) {
    console.log(
      `  ${r.symbol.padEnd(6)} spot ${r.spot.toFixed(2).padStart(9)}  ${String(r.dte).padStart(2)}d  ` +
        `ATM IV ${(r.atmIv * 100).toFixed(1).padStart(5)}%`,
    )
  }

  if (failures.length > 0) {
    console.log('[snapshot-iv] failure sample:')
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${String(f.item).padEnd(6)} ${f.error!.message}`)
    }
  }

  // A run that stored almost nothing is a failed run, and CI should say so rather
  // than going green over an empty table.
  const successRate = symbols.length > 0 ? rows.length / symbols.length : 0
  if (successRate < 0.8) {
    console.error(
      `[snapshot-iv] FAILING: only ${(successRate * 100).toFixed(0)}% of symbols stored (need 80%)`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[snapshot-iv] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
