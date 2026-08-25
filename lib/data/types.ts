/**
 * Vendor-neutral options data contract.
 *
 * Every provider normalises into these shapes so the engine never learns which
 * vendor it is talking to. This is not speculative abstraction -- Yahoo's free
 * endpoint was gutted mid-development (chains still returned, but with every bid,
 * open interest and IV stripped out), and the vendor licensing question is still
 * open. Swapping providers has to be a config change, not a refactor.
 */

export interface OptionQuote {
  contractSymbol: string
  strike: number
  bid: number
  ask: number
  lastPrice: number
  /** Annualised IV as a decimal (0.28 = 28%). Null when the vendor omits it. */
  impliedVolatility: number | null
  /** Vendor-supplied delta, when available. Otherwise we compute it ourselves. */
  delta: number | null
  openInterest: number
  volume: number
  /** ISO date, e.g. "2026-09-25". */
  expiration: string
}

export interface OptionChain {
  symbol: string
  spot: number
  /** ISO date of the expiry this chain represents. */
  expiry: string
  calls: OptionQuote[]
  puts: OptionQuote[]
}

export interface OptionsProvider {
  readonly name: string
  /**
   * Whether this vendor actually returns usable implied volatility. Yahoo claims
   * an `impliedVolatility` field and fills it with zeros and 0.5 placeholders, so
   * the flag reflects verified reality rather than the presence of a field.
   */
  readonly suppliesIv: boolean
  /** ISO dates of every listed expiration for the underlying. */
  listExpirations(symbol: string): Promise<string[]>
  /**
   * Pass a known `spot` to skip the provider's own underlying-quote call. Over a
   * 500-symbol scan that is 500 requests saved, which matters against a
   * 60-request-per-minute sandbox limit.
   */
  getChain(symbol: string, expiry: string, opts?: { spot?: number }): Promise<OptionChain>
  /** Last / regular-market price of the underlying. */
  getSpot(symbol: string): Promise<number>
  /**
   * Optional batch spot lookup. Providers whose quote endpoint accepts multiple
   * symbols implement this; callers should feature-detect and fall back to
   * per-symbol `getSpot`.
   */
  getSpots?(symbols: string[]): Promise<Map<string, number>>
}

/** Mid price, falling back to last when only one side is quoted. */
export function midPrice(q: OptionQuote): number | null {
  if (q.bid > 0 && q.ask > 0) return (q.bid + q.ask) / 2
  if (q.lastPrice > 0) return q.lastPrice
  return null
}

/** Bid/ask spread as a fraction of mid — the core options-liquidity gate. */
export function spreadPct(q: OptionQuote): number | null {
  if (!(q.bid > 0) || !(q.ask > 0)) return null
  const mid = (q.bid + q.ask) / 2
  return mid > 0 ? (q.ask - q.bid) / mid : null
}
