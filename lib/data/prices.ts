/**
 * Daily price history from Yahoo's chart endpoint.
 *
 * Unlike Yahoo's options endpoint -- which was hollowed out and is unusable -- the
 * chart endpoint still returns genuine OHLCV, needs no cookie/crumb handshake, and
 * costs nothing. Verified 2026-08-25: 251 bars for AAPL with a correct 200-day
 * average.
 *
 * Only closes are extracted; every technical the screener needs is close-based. If
 * that changes (ATR, gap analysis) the raw arrays are already in the response.
 */

import { RateLimiter, withRetry } from './pool'

const RATE_PER_MINUTE = 90

const limiter = new RateLimiter(RATE_PER_MINUTE)

export interface PriceHistory {
  symbol: string
  /** Chronological daily closes, nulls stripped. */
  closes: number[]
  /**
   * Full OHLCV bars aligned to `closes`. Needed for the volume profile, which
   * spreads each day's volume across its high-low range.
   */
  bars: Array<{ high: number; low: number; close: number; volume: number }>
  /** Unix seconds aligned to `closes`. */
  timestamps: number[]
  /** Latest regular-market price from the response metadata. */
  spot: number
}

interface RawChart {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number }
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
    error?: { description?: string } | null
  }
}

export async function fetchPriceHistory(symbol: string, range = '1y'): Promise<PriceHistory> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=1d`

  const raw = await withRetry(
    async () => {
      await limiter.acquire()
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      if (res.status === 429) {
        limiter.throttled(Number(res.headers.get('retry-after')) || undefined)
        throw new Error(`prices ${symbol} http 429`)
      }
      if (!res.ok) throw new Error(`prices ${symbol} http ${res.status}`)
      limiter.succeeded()
      return (await res.json()) as RawChart
    },
    { shouldRetry: (e) => !/http 40[34]/.test(String(e)) },
  )

  const result = raw.chart?.result?.[0]
  if (!result) throw new Error(`prices: no history for ${symbol}`)

  const quote = result.indicators?.quote?.[0]
  const rawCloses = quote?.close ?? []
  const rawHighs = quote?.high ?? []
  const rawLows = quote?.low ?? []
  const rawVolumes = quote?.volume ?? []
  const rawStamps = result.timestamp ?? []

  // Keep every series aligned while dropping halted/missing sessions.
  const closes: number[] = []
  const timestamps: number[] = []
  const bars: PriceHistory['bars'] = []

  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i]
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue

    closes.push(c)
    timestamps.push(rawStamps[i] ?? 0)

    const h = rawHighs[i]
    const l = rawLows[i]
    const v = rawVolumes[i]
    // A bar missing high/low/volume is unusable for the profile but its close is
    // still fine for moving averages, so only the bar is skipped.
    if (typeof h === 'number' && typeof l === 'number' && typeof v === 'number' && v > 0) {
      bars.push({ high: h, low: l, close: c, volume: v })
    }
  }

  if (closes.length === 0) throw new Error(`prices: empty history for ${symbol}`)

  return {
    symbol,
    closes,
    bars,
    timestamps,
    spot: result.meta?.regularMarketPrice ?? closes[closes.length - 1],
  }
}
