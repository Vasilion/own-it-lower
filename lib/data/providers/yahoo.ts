/**
 * Yahoo Finance options provider — RETAINED BUT NOT USABLE FOR IV.
 *
 * Verified 2026-08-25: the free `/v7/finance/options` endpoint still returns chain
 * structure (strikes, expirations, lastPrice) but has been stripped of everything
 * that matters. Across a full AAPL chain of 168 contracts: zero bids, zero asks,
 * zero open interest, and an `impliedVolatility` field populated with 0 and a
 * recurring 0.500005 placeholder.
 *
 * Crucially it does not error — it returns a well-formed, plausible-looking payload
 * full of dead numbers. That is exactly the failure mode that silently poisons a
 * dataset, which is why `pnpm check:provider` exists and why `suppliesIv` is false
 * here regardless of the field being present.
 *
 * Kept because spot price and the expiration calendar are still accurate and free.
 * Note that Yahoo's OTHER endpoints are fine: price history (data/prices.ts) and
 * fundamentals (data/fundamentals.ts) both return real values. The rot is specific
 * to options.
 */

import { withRetry } from '../pool'
import type { OptionChain, OptionQuote, OptionsProvider } from '../types'
import { yahooGet } from '../yahoo-session'

interface RawChainResponse {
  optionChain: {
    result?: Array<{
      underlyingSymbol: string
      expirationDates: number[]
      quote?: { regularMarketPrice?: number }
      options?: Array<{
        expirationDate: number
        calls: RawOptionQuote[]
        puts: RawOptionQuote[]
      }>
    }>
    error?: { description?: string } | null
  }
}

interface RawOptionQuote {
  contractSymbol: string
  strike: number
  bid?: number
  ask?: number
  lastPrice?: number
  impliedVolatility?: number
  openInterest?: number
  volume?: number
  expiration: number
}

const isoDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10)

function normalise(o: RawOptionQuote): OptionQuote {
  return {
    contractSymbol: o.contractSymbol,
    strike: o.strike,
    bid: o.bid ?? 0,
    ask: o.ask ?? 0,
    lastPrice: o.lastPrice ?? 0,
    // Deliberately surfaced as-is rather than sanitised: check:provider needs to
    // see the real values to report the endpoint as degraded.
    impliedVolatility: typeof o.impliedVolatility === 'number' ? o.impliedVolatility : null,
    delta: null, // Yahoo never supplies greeks; we compute them from IV.
    openInterest: o.openInterest ?? 0,
    volume: o.volume ?? 0,
    expiration: isoDate(o.expiration),
  }
}

export class YahooProvider implements OptionsProvider {
  readonly name = 'yahoo'
  /** False by verified behaviour, not by absence of the field. See the file header. */
  readonly suppliesIv = false

  private async raw(symbol: string, expiryUnix?: number) {
    const params: Record<string, string> = {}
    if (expiryUnix) params.date = String(expiryUnix)
    const raw = await withRetry(() =>
      yahooGet<RawChainResponse>(`/v7/finance/options/${encodeURIComponent(symbol)}`, params),
    )
    const result = raw.optionChain?.result?.[0]
    if (!result) throw new Error(`yahoo: no chain for ${symbol}`)
    return result
  }

  async listExpirations(symbol: string): Promise<string[]> {
    const r = await this.raw(symbol)
    return (r.expirationDates ?? []).map(isoDate)
  }

  async getChain(symbol: string, expiry: string): Promise<OptionChain> {
    const meta = await this.raw(symbol)
    const match = (meta.expirationDates ?? []).find((e) => isoDate(e) === expiry)
    if (!match) throw new Error(`yahoo: ${symbol} has no expiry ${expiry}`)

    const result =
      isoDate(meta.options?.[0]?.expirationDate ?? 0) === expiry ? meta : await this.raw(symbol, match)
    const slice = result.options?.[0]

    return {
      symbol,
      spot: result.quote?.regularMarketPrice ?? 0,
      expiry,
      calls: (slice?.calls ?? []).map(normalise),
      puts: (slice?.puts ?? []).map(normalise),
    }
  }

  async getSpot(symbol: string): Promise<number> {
    const r = await this.raw(symbol)
    const price = r.quote?.regularMarketPrice
    if (!price) throw new Error(`yahoo: no spot price for ${symbol}`)
    return price
  }
}
