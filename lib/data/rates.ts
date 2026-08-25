/**
 * Risk-free rate for Black-Scholes.
 *
 * Sourced from FRED when a key is configured, with a constant fallback otherwise.
 *
 * The fallback is acceptable here in a way it would not be elsewhere. The rate only
 * enters through Black-Scholes, and at 30 days to expiry a full percentage point of
 * error moves put delta by roughly a thousandth. On top of that, CBOE supplies delta
 * per contract directly, so our own computation is usually just a cross-check. This
 * is the one input where being approximately right costs nothing.
 *
 * If that ever stops being true -- LEAPS, or a provider that omits greeks -- set
 * FRED_API_KEY and this starts tracking the real curve.
 */

const FRED_SERIES = 'DGS1MO'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Fallback: approximate 1-month Treasury yield.
 * Last reviewed 2026-08-25. Revisit if short rates move materially.
 */
const FALLBACK_RATE = 0.043

let cached: { rate: number; source: string; fetchedAt: number } | null = null

interface FredResponse {
  observations?: Array<{ date: string; value: string }>
}

export interface RiskFreeRate {
  /** Annualised decimal, e.g. 0.043. */
  rate: number
  source: 'fred' | 'fallback'
  asOf: string | null
}

export async function getRiskFreeRate(): Promise<RiskFreeRate> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { rate: cached.rate, source: cached.source as 'fred' | 'fallback', asOf: null }
  }

  const key = process.env.FRED_API_KEY?.trim()
  if (key) {
    try {
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${FRED_SERIES}` +
        `&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=8`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (res.ok) {
        const json = (await res.json()) as FredResponse
        // FRED marks holidays and weekends with "."; walk back to the last real print.
        const latest = (json.observations ?? []).find((o) => o.value && o.value !== '.')
        const parsed = latest ? Number(latest.value) / 100 : NaN
        if (Number.isFinite(parsed) && parsed >= 0 && parsed < 0.25) {
          cached = { rate: parsed, source: 'fred', fetchedAt: Date.now() }
          return { rate: parsed, source: 'fred', asOf: latest?.date ?? null }
        }
      }
    } catch {
      // Fall through to the constant. A rate lookup must never fail a scan.
    }
  }

  cached = { rate: FALLBACK_RATE, source: 'fallback', fetchedAt: Date.now() }
  return { rate: FALLBACK_RATE, source: 'fallback', asOf: null }
}
