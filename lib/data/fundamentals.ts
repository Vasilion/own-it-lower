/**
 * Company fundamentals and the next earnings date, from Yahoo's quoteSummary.
 *
 * Free, no API key, and it supplies every input the quality gate needs:
 * market cap, free cash flow, debt/equity, earnings growth, margins and ROE —
 * plus the earnings date that drives the earnings-before-expiry rule.
 *
 * Unlike Yahoo's options endpoint (hollowed out — see providers/yahoo.ts), this
 * one still returns real values. Verified against KO on 2026-08-25.
 */

import { RateLimiter, withRetry } from './pool'
import { raw, yahooGet } from './yahoo-session'

const RATE_PER_MINUTE = 60
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

const MODULES = 'financialData,defaultKeyStatistics,summaryDetail,calendarEvents,price'

const limiter = new RateLimiter(RATE_PER_MINUTE)
const cache = new Map<string, { value: Fundamentals; fetchedAt: number }>()

export interface Fundamentals {
  symbol: string
  marketCap: number | null
  freeCashflow: number | null
  operatingCashflow: number | null
  /**
   * Debt-to-equity as a RATIO (1.155), not the percentage Yahoo returns.
   *
   * Yahoo reports this field as a percent — KO comes back as 115.519 meaning
   * 1.155x. Passing that straight into a "debt/equity below 2.0" test would fail
   * essentially every company on earth, silently and plausibly. Normalised once
   * here so no caller has to remember.
   */
  debtToEquity: number | null
  earningsGrowth: number | null
  revenueGrowth: number | null
  profitMargins: number | null
  returnOnEquity: number | null
  currentRatio: number | null
  /** Next scheduled earnings date, ISO. */
  nextEarnings: string | null
  sector: string | null
}

interface RawQuoteSummary {
  quoteSummary?: {
    result?: Array<{
      financialData?: Record<string, unknown>
      defaultKeyStatistics?: Record<string, unknown>
      summaryDetail?: Record<string, unknown>
      price?: Record<string, unknown>
      calendarEvents?: { earnings?: { earningsDate?: unknown[] } }
    }>
  }
}

function nextEarningsDate(dates: unknown[] | undefined): string | null {
  if (!dates?.length) return null
  const now = Date.now()
  const upcoming = dates
    .map((d) => raw(d))
    .filter((t): t is number => t !== null)
    .map((t) => t * 1000)
    .filter((ms) => ms >= now - 86_400_000) // tolerate one day of staleness
    .sort((a, b) => a - b)[0]
  return upcoming ? new Date(upcoming).toISOString().slice(0, 10) : null
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value

  const data = await withRetry(
    async () => {
      await limiter.acquire()
      const json = await yahooGet<RawQuoteSummary>(
        `/v10/finance/quoteSummary/${encodeURIComponent(key)}`,
        { modules: MODULES },
      )
      limiter.succeeded()
      return json
    },
    { shouldRetry: (e) => !/http 40[34]/.test(String(e)) },
  )

  const r = data.quoteSummary?.result?.[0]
  if (!r) throw new Error(`fundamentals: no data for ${key}`)

  const fd = r.financialData ?? {}
  const sd = r.summaryDetail ?? {}
  const price = r.price ?? {}

  const debtToEquityPct = raw(fd.debtToEquity)

  const value: Fundamentals = {
    symbol: key,
    marketCap: raw(price.marketCap) ?? raw(sd.marketCap),
    freeCashflow: raw(fd.freeCashflow),
    operatingCashflow: raw(fd.operatingCashflow),
    // Percent -> ratio. See the field docs above.
    debtToEquity: debtToEquityPct === null ? null : debtToEquityPct / 100,
    earningsGrowth: raw(fd.earningsGrowth),
    revenueGrowth: raw(fd.revenueGrowth),
    profitMargins: raw(fd.profitMargins),
    returnOnEquity: raw(fd.returnOnEquity),
    currentRatio: raw(fd.currentRatio),
    nextEarnings: nextEarningsDate(r.calendarEvents?.earnings?.earningsDate),
    sector: typeof price.sector === 'string' ? price.sector : null,
  }

  cache.set(key, { value, fetchedAt: Date.now() })
  return value
}
