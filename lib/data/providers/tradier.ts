/**
 * Tradier options provider.
 *
 * Greeks and implied volatility on Tradier's chains are supplied by ORATS, which
 * makes it one of the very few cheap sources that returns usable IV per contract.
 *
 * Two hosts:
 *   sandbox.tradier.com - free developer account, 15-minute delayed, no funding
 *                         required. This is the prototype path.
 *   api.tradier.com     - production, ~$10/mo for market data.
 *
 * IMPORTANT: sandbox data is licensed for development only. Before any of this is
 * shown to a paying user, confirm delayed-redistribution rights in writing (see
 * vendor-email.md). That confirmation gates production use, not prototyping.
 */

import { RateLimiter, withRetry } from '../pool'
import type { OptionChain, OptionQuote, OptionsProvider } from '../types'

const SANDBOX = 'https://sandbox.tradier.com/v1'
const PRODUCTION = 'https://api.tradier.com/v1'

/** Published limits are 60/min sandbox and 120/min production; stay under both. */
const RATE_PER_MINUTE = { sandbox: 55, production: 110 } as const

/** /markets/quotes accepts a comma-separated list; this keeps the URL sane. */
const QUOTE_BATCH_SIZE = 100

interface RawGreeks {
  delta?: number
  gamma?: number
  theta?: number
  vega?: number
  /** ORATS mid implied volatility -- the field we prefer. */
  mid_iv?: number
  bid_iv?: number
  ask_iv?: number
  /** ORATS smoothed volatility; steadier, used as a fallback. */
  smv_vol?: number
}

interface RawOption {
  symbol: string
  strike: number
  bid: number | null
  ask: number | null
  last: number | null
  open_interest: number | null
  volume: number | null
  option_type: 'put' | 'call'
  expiration_date: string
  greeks?: RawGreeks
}

/** Tradier collapses single-element arrays into the bare object. Always normalise. */
function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function pickIv(g: RawGreeks | undefined): number | null {
  if (!g) return null
  for (const v of [g.mid_iv, g.smv_vol, g.bid_iv, g.ask_iv]) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 5) return v
  }
  return null
}

function normalise(o: RawOption): OptionQuote {
  return {
    contractSymbol: o.symbol,
    strike: o.strike,
    bid: o.bid ?? 0,
    ask: o.ask ?? 0,
    lastPrice: o.last ?? 0,
    impliedVolatility: pickIv(o.greeks),
    delta: typeof o.greeks?.delta === 'number' ? o.greeks.delta : null,
    openInterest: o.open_interest ?? 0,
    volume: o.volume ?? 0,
    expiration: o.expiration_date,
  }
}

export class TradierProvider implements OptionsProvider {
  readonly name: string
  readonly suppliesIv = true
  private readonly base: string
  private readonly token: string
  private readonly limiter: RateLimiter

  constructor(token: string, mode: 'sandbox' | 'production' = 'sandbox') {
    if (!token.trim()) throw new Error('TradierProvider: empty access token')
    this.token = token.trim()
    this.base = mode === 'production' ? PRODUCTION : SANDBOX
    this.name = `tradier:${mode}`
    this.limiter = new RateLimiter(RATE_PER_MINUTE[mode])
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${this.base}${path}?${new URLSearchParams(params)}`
    return withRetry(
      async () => {
        await this.limiter.acquire()
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        })
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          this.limiter.throttled(Number.isFinite(retryAfter) ? retryAfter : undefined)
          throw new Error(`tradier ${path} http 429`)
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`tradier ${path} http ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`)
        }

        this.limiter.succeeded()
        return (await res.json()) as T
      },
      // 401/403 are credential problems; retrying just burns quota.
      { shouldRetry: (e) => !/http 40[13]/.test(String(e)) },
    )
  }

  async listExpirations(symbol: string): Promise<string[]> {
    const raw = await this.get<{ expirations: { date?: string | string[] } | null }>(
      '/markets/options/expirations',
      { symbol, includeAllRoots: 'true', strikes: 'false' },
    )
    return toArray(raw.expirations?.date)
  }

  async getChain(symbol: string, expiry: string, opts?: { spot?: number }): Promise<OptionChain> {
    const [raw, spot] = await Promise.all([
      this.get<{ options: { option?: RawOption | RawOption[] } | null }>('/markets/options/chains', {
        symbol,
        expiration: expiry,
        greeks: 'true',
      }),
      opts?.spot && opts.spot > 0 ? Promise.resolve(opts.spot) : this.getSpot(symbol),
    ])

    const options = toArray(raw.options?.option)
    if (options.length === 0) throw new Error(`tradier: empty chain for ${symbol} ${expiry}`)

    return {
      symbol,
      spot,
      expiry,
      calls: options.filter((o) => o.option_type === 'call').map(normalise),
      puts: options.filter((o) => o.option_type === 'put').map(normalise),
    }
  }

  async getSpot(symbol: string): Promise<number> {
    const price = (await this.getSpots([symbol])).get(symbol)
    if (!price) throw new Error(`tradier: no spot price for ${symbol}`)
    return price
  }

  async getSpots(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()

    for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
      const batch = symbols.slice(i, i + QUOTE_BATCH_SIZE)
      const raw = await this.get<{
        quotes: {
          quote?: RawQuote | RawQuote[]
        } | null
      }>('/markets/quotes', { symbols: batch.join(','), greeks: 'false' })

      for (const q of toArray(raw.quotes?.quote)) {
        const price = q.last ?? q.close ?? q.prevclose
        if (q.symbol && typeof price === 'number' && Number.isFinite(price) && price > 0) {
          out.set(q.symbol, price)
        }
      }
    }

    return out
  }
}

interface RawQuote {
  symbol?: string
  last?: number | null
  close?: number | null
  prevclose?: number | null
}
