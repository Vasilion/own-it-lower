/**
 * Assemble everything needed to rank one symbol's put chain.
 *
 * Server-only: it makes network calls. The ranking itself deliberately happens
 * elsewhere -- `rankPuts` is pure TypeScript with no framework or network
 * dependency, so the browser can re-rank instantly as the user moves a slider
 * without a round trip. This module's job is just to fetch the raw inputs once.
 */

import 'server-only'

import { getOptionsProvider } from '../data'
import { fetchFundamentals, type Fundamentals } from '../data/fundamentals'
import { fetchPriceHistory } from '../data/prices'
import { getRiskFreeRate } from '../data/rates'
import type { OptionQuote } from '../data/types'
import { scoreQuality, type QualityResult } from '../engine/quality'
import { computeTechnicals, scoreDiscount, type Technicals } from '../engine/technicals'
import type { UnderlyingContext } from '../engine/types'

/** Widest window we ever fetch. The preset narrows it client-side. */
const FETCH_MIN_DTE = 7
const FETCH_MAX_DTE = 90

export interface AnalysisPayload {
  symbol: string
  spot: number
  puts: OptionQuote[]
  /** ISO expiry -> days to expiry, resolved server-side so the client agrees. */
  dte: Record<string, number>
  context: UnderlyingContext
  technicals: Technicals
  /**
   * Daily OHLCV bars, sent so the client can compute the volume profile itself.
   *
   * The profile's lookback genuinely changes the answer — GOOG's point of control
   * was $342 over 130 sessions and $317 over 252 — so it has to be adjustable, and
   * recomputing in the browser makes that instant. Roughly 250 bars, a few KB.
   */
  bars: Array<{ high: number; low: number; close: number; volume: number }>
  fundamentals: Fundamentals | null
  quality: QualityResult | null
  riskFreeRate: number
  rateSource: string
  provider: string
  /** When this was assembled, so the UI can state the data's age honestly. */
  fetchedAt: string
}

export async function analyzeSymbol(rawSymbol: string): Promise<AnalysisPayload> {
  const symbol = rawSymbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error(`Invalid symbol: ${rawSymbol}`)

  const provider = getOptionsProvider()

  // Fundamentals are allowed to fail without taking the page down: the quality
  // component abstains and the rest of the analysis still stands.
  const [expirations, history, rate, fundamentals] = await Promise.all([
    provider.listExpirations(symbol),
    fetchPriceHistory(symbol),
    getRiskFreeRate(),
    fetchFundamentals(symbol).catch(() => null),
  ])

  const now = Date.now()
  const wanted = expirations
    .map((iso) => ({ iso, dte: Math.round((Date.parse(`${iso}T00:00:00Z`) - now) / 86_400_000) }))
    .filter((e) => e.dte >= FETCH_MIN_DTE && e.dte <= FETCH_MAX_DTE)

  if (wanted.length === 0) throw new Error(`${symbol} has no expirations between ${FETCH_MIN_DTE} and ${FETCH_MAX_DTE} days out`)

  // Served from the provider's cached payload, so this loop is one network call.
  const puts: OptionQuote[] = []
  const dte: Record<string, number> = {}
  let spot = 0

  for (const e of wanted) {
    const chain = await provider.getChain(symbol, e.iso)
    puts.push(...chain.puts)
    dte[e.iso] = e.dte
    spot = chain.spot || spot
  }

  const resolvedSpot = spot || history.spot
  const technicals = computeTechnicals(history.closes, resolvedSpot)

  const quality = fundamentals ? scoreQuality(fundamentals) : null

  const context: UnderlyingContext = {
    spot: resolvedSpot,
    sma200: technicals.sma200 ?? undefined,
    sma200Slope: technicals.sma200Slope ?? undefined,
    sma50: technicals.sma50 ?? undefined,
    low52: technicals.low52 ?? undefined,
    high52: technicals.high52 ?? undefined,
    discountScore: scoreDiscount(technicals) ?? undefined,
    qualityScore: quality?.score ?? undefined,
    nextEarnings: fundamentals?.nextEarnings ?? undefined,
  }

  return {
    symbol,
    spot: resolvedSpot,
    // Trim the payload: contracts with no bid can never be sold, so they would
    // only bloat the response and be discarded by the first measurement pass.
    puts: puts.filter((p) => p.bid > 0),
    dte,
    context,
    technicals,
    bars: history.bars,
    fundamentals,
    quality,
    riskFreeRate: rate.rate,
    rateSource: rate.source,
    provider: provider.name,
    fetchedAt: new Date().toISOString(),
  }
}
