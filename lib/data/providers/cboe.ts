/**
 * CBOE delayed-quotes provider.
 *
 * CBOE publishes the delayed option chains that power their own public website as
 * plain JSON, with no account, no API key and no brokerage onboarding:
 *
 *   https://cdn.cboe.com/api/global/delayed_quotes/options/AAPL.json
 *
 * One request returns the ENTIRE chain -- every expiration, every strike -- with
 * bid, ask, IV, open interest, volume and a full set of greeks per contract, plus
 * the underlying quote and CBOE's own 30-day IV for the name.
 *
 * Verified against AAPL on 2026-08-25: tight two-sided markets, IV 24.5-25.6%
 * (correct for AAPL), monotonic deltas, open interest decaying away from the money,
 * and a clean volatility smile. Genuine data, unlike Yahoo's hollowed-out feed.
 *
 * Two caveats, both deliberate trade-offs rather than oversights:
 *
 *  1. This is an undocumented endpoint serving CBOE's public site. It can change or
 *     be locked down without notice -- which is exactly why every provider sits
 *     behind an interface and why `pnpm check:provider` runs in CI before each
 *     snapshot.
 *  2. Free public access is not the same as a redistribution licence. Fine for
 *     development and for accumulating our own derived IV history; confirm terms
 *     with CBOE before showing their quotes to a paying user.
 */

import { RateLimitedError, RateLimiter, withRetry } from '../pool'
import type { OptionChain, OptionQuote, OptionsProvider } from '../types'

const BASE = 'https://cdn.cboe.com/api/global/delayed_quotes/options'

/**
 * Measured 2026-08-25: 60/min over distinct (uncached) symbols ran clean; 100/min
 * with 8 concurrent 1.5MB downloads drew sustained 429s roughly 55 symbols in.
 * Sit below the proven-good rate and let the limiter adapt from there.
 */
const RATE_PER_MINUTE = 50

/**
 * Raw payloads are ~1.5MB but we cache the PARSED form, which is far smaller, so a
 * few dozen symbols is affordable. Sized for someone browsing the screener and
 * clicking between names rather than for a single-symbol job -- at 8 entries the
 * cache evicted faster than a user could click, and every page load paid full
 * network cost again.
 *
 * TTL matches the 15-minute delay on the data itself: serving anything fresher is
 * impossible, so caching that long is lossless.
 */
const CACHE_MAX_ENTRIES = 60
const CACHE_TTL_MS = 15 * 60 * 1000

/** OCC contract symbol: root, YYMMDD, C or P, then strike x 1000 as 8 digits. */
const OCC = /^([A-Z0-9]{1,6})(\d{6})([CP])(\d{8})$/

interface RawContract {
  option: string
  bid: number | null
  ask: number | null
  iv: number | null
  delta: number | null
  open_interest: number | null
  volume: number | null
  last_trade_price: number | null
}

interface RawPayload {
  data?: {
    current_price?: number
    close?: number
    /** CBOE's own 30-day IV for the underlying, in percent (24.452 = 24.452%). */
    iv30?: number
    options?: RawContract[]
  }
}

interface ParsedChain {
  symbol: string
  spot: number
  /** CBOE's published 30-day IV as a decimal, useful as a sanity check on ours. */
  iv30: number | null
  byExpiry: Map<string, { calls: OptionQuote[]; puts: OptionQuote[] }>
  fetchedAt: number
}

/**
 * Map our ticker convention to CBOE's.
 *
 * The universe uses dashes for share classes (BRK-B). CBOE roots carry no
 * separator. Note that BRK-B and BF-B answer 403 under every root tried on
 * 2026-08-25, so a couple of share-class names are simply unavailable here --
 * 2 of 503 symbols, well inside the job's failure tolerance.
 */
function toCboeSymbol(symbol: string): string {
  return symbol.replace(/[-.]/g, '').toUpperCase()
}

function normalise(c: RawContract, strike: number, expiration: string): OptionQuote {
  return {
    contractSymbol: c.option,
    strike,
    bid: c.bid ?? 0,
    ask: c.ask ?? 0,
    lastPrice: c.last_trade_price ?? 0,
    // CBOE reports IV as a decimal already (0.2448), unlike iv30 which is percent.
    impliedVolatility: typeof c.iv === 'number' && c.iv > 0 ? c.iv : null,
    delta: typeof c.delta === 'number' ? c.delta : null,
    openInterest: c.open_interest ?? 0,
    volume: c.volume ?? 0,
    expiration,
  }
}

export class CboeProvider implements OptionsProvider {
  readonly name = 'cboe'
  readonly suppliesIv = true

  private readonly limiter = new RateLimiter(RATE_PER_MINUTE)
  /**
   * How long a caller will queue behind the rate limiter before giving up.
   *
   * Undefined for batch jobs, which should wait their turn. Set for anything
   * serving a page: when a scan is running in another process, both processes
   * pace independently, exceed the shared limit and trigger 429 backoffs. Without
   * a budget a page request simply sits inside that backoff -- which is precisely
   * how a click turned into a 57-second load.
   */
  private readonly waitBudgetMs?: number

  private readonly cache = new Map<string, ParsedChain>()
  /** In-flight requests, so concurrent callers for one symbol share a single fetch. */
  private readonly inFlight = new Map<string, Promise<ParsedChain>>()

  constructor(opts: { waitBudgetMs?: number } = {}) {
    this.waitBudgetMs = opts.waitBudgetMs
  }

  private async load(symbol: string): Promise<ParsedChain> {
    const key = symbol.toUpperCase()

    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      // Refresh LRU position.
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }

    // Without this, a page that calls listExpirations() and getChain() -- or two
    // visitors landing on the same symbol at once -- each start their own 1.5MB
    // download and each consume a rate-limit slot for identical data.
    const pending = this.inFlight.get(key)
    if (pending) return pending

    const request = this.fetchAndParse(key)
      .then((parsed) => {
        this.cache.set(key, parsed)
        while (this.cache.size > CACHE_MAX_ENTRIES) {
          const oldest = this.cache.keys().next().value
          if (oldest === undefined) break
          this.cache.delete(oldest)
        }
        return parsed
      })
      .finally(() => {
        this.inFlight.delete(key)
      })

    this.inFlight.set(key, request)
    return request
  }

  private async fetchAndParse(symbol: string): Promise<ParsedChain> {
    const url = `${BASE}/${encodeURIComponent(toCboeSymbol(symbol))}.json`

    const raw = await withRetry(
      async () => {
        await this.limiter.acquire(this.waitBudgetMs)
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        })

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          // Slow every worker, not just this one -- the limit is per-host.
          this.limiter.throttled(Number.isFinite(retryAfter) ? retryAfter : undefined)
          throw new Error(`cboe ${symbol} http 429`)
        }
        if (!res.ok) throw new Error(`cboe ${symbol} http ${res.status}`)

        this.limiter.succeeded()
        return (await res.json()) as RawPayload
      },
      {
        attempts: 4,
        baseDelayMs: 1000,
        // 403/404 mean this symbol has no chain here (NVR, BRK-B) and retrying
        // cannot help. RateLimitedError is a decision not to wait, so retrying it
        // would just re-make the same decision three more times. 429 IS retried,
        // and each attempt widens the pacing further.
        shouldRetry: (e) => !(e instanceof RateLimitedError) && !/http 40[34]/.test(String(e)),
      },
    )

    const data = raw.data
    const contracts = data?.options ?? []
    if (contracts.length === 0) throw new Error(`cboe: empty chain for ${symbol}`)

    const spot = data?.current_price || data?.close || 0
    if (!spot) throw new Error(`cboe: no underlying price for ${symbol}`)

    const byExpiry = new Map<string, { calls: OptionQuote[]; puts: OptionQuote[] }>()
    for (const c of contracts) {
      const m = OCC.exec((c.option ?? '').trim())
      if (!m) continue

      const [, , yymmdd, type, strikeRaw] = m
      const expiration = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
      const strike = Number(strikeRaw) / 1000
      if (!Number.isFinite(strike) || strike <= 0) continue

      let bucket = byExpiry.get(expiration)
      if (!bucket) {
        bucket = { calls: [], puts: [] }
        byExpiry.set(expiration, bucket)
      }
      ;(type === 'C' ? bucket.calls : bucket.puts).push(normalise(c, strike, expiration))
    }

    if (byExpiry.size === 0) throw new Error(`cboe: no parseable contracts for ${symbol}`)

    return {
      symbol,
      spot,
      // iv30 arrives as a percent; store a decimal to match every other IV we handle.
      iv30: typeof data?.iv30 === 'number' && data.iv30 > 0 ? data.iv30 / 100 : null,
      byExpiry,
      fetchedAt: Date.now(),
    }
  }

  async listExpirations(symbol: string): Promise<string[]> {
    const chain = await this.load(symbol)
    return [...chain.byExpiry.keys()].sort()
  }

  async getChain(symbol: string, expiry: string): Promise<OptionChain> {
    const chain = await this.load(symbol)
    const bucket = chain.byExpiry.get(expiry)
    if (!bucket) throw new Error(`cboe: ${symbol} has no expiry ${expiry}`)

    return {
      symbol,
      spot: chain.spot,
      expiry,
      calls: bucket.calls,
      puts: bucket.puts,
    }
  }

  async getSpot(symbol: string): Promise<number> {
    return (await this.load(symbol)).spot
  }

  /**
   * CBOE's own 30-day IV for the underlying. Not part of the provider interface --
   * it is a free second opinion on the ATM IV we interpolate ourselves, and a
   * large divergence between the two is a signal that our maths or the feed has
   * drifted.
   */
  async getPublishedIv30(symbol: string): Promise<number | null> {
    return (await this.load(symbol)).iv30
  }
}
