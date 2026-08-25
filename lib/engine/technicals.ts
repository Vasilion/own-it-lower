/**
 * Price-based technicals: the "discount" half of the thesis.
 *
 * Pure functions over an array of closes. No network, no framework.
 *
 * The single most important thing in this file is `classifyTrend`. A quality stock
 * sitting on its 200-day average with that average RISING is a pullback -- the setup
 * the whole product is looking for. The same stock on a 200-day average that is
 * ROLLING OVER is a value trap, and selling puts into it is how people end up owning
 * something that keeps falling. Screeners that only measure distance-to-average
 * cannot tell those apart, and will happily rank the second one highest because the
 * premium is richer.
 */

export type TrendState =
  /** Above a rising 200-day. Healthy, but not on sale. */
  | 'uptrend_extended'
  /** Near a rising 200-day. The setup this product exists to find. */
  | 'uptrend_pullback'
  /** Below a rising 200-day. Deeper pullback; the trend has not broken yet. */
  | 'uptrend_deep'
  /** Below a falling 200-day. Falling knife -- structurally different from a dip. */
  | 'downtrend'
  /** Above a falling 200-day. Bounce inside a downtrend. */
  | 'downtrend_bounce'
  /** Not enough history to judge. */
  | 'unknown'

export interface Technicals {
  spot: number
  sma50: number | null
  sma200: number | null
  /** Fractional change in the 200-day average over the last ~20 sessions. */
  sma200Slope: number | null
  /** Distance from the 200-day as a fraction: +0.10 means 10% above. */
  distanceFrom200: number | null
  low52: number | null
  high52: number | null
  /** Position in the 52-week range, 0 at the low and 1 at the high. */
  rangePosition: number | null
  rsi14: number | null
  /** Bollinger %B (20, 2): 0 at the lower band, 1 at the upper. */
  percentB: number | null
  trend: TrendState
  /** True when price is within 4% of the 200-day, either side. */
  atSupport: boolean
  observations: number
}

function sma(values: number[], period: number, offsetFromEnd = 0): number | null {
  const end = values.length - offsetFromEnd
  if (end < period || end <= 0) return null
  const slice = values.slice(end - period, end)
  return slice.reduce((a, b) => a + b, 0) / period
}

/** Wilder's RSI. */
function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null

  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
  }

  if (loss === 0) return gain === 0 ? 50 : 100
  const rs = gain / loss
  return 100 - 100 / (1 + rs)
}

/** Bollinger %B over a 20-period, 2-standard-deviation band. */
function percentB(values: number[], period = 20, mult = 2): number | null {
  if (values.length < period) return null
  const slice = values.slice(-period)
  const mean = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period
  const sd = Math.sqrt(variance)
  if (sd === 0) return 0.5

  const upper = mean + mult * sd
  const lower = mean - mult * sd
  return (values[values.length - 1] - lower) / (upper - lower)
}

/**
 * Distinguish a pullback from a breakdown.
 *
 * Slope is measured on the 200-day average itself rather than on price, because
 * price is noisy enough that a single volatile week would flip the classification.
 */
export function classifyTrend(
  spot: number,
  sma200: number | null,
  slope: number | null,
): { trend: TrendState; atSupport: boolean } {
  if (!sma200 || slope === null) return { trend: 'unknown', atSupport: false }

  const distance = (spot - sma200) / sma200
  const atSupport = Math.abs(distance) <= 0.04
  // A flat average is treated as rising: a sideways 200-day is consolidation, not
  // a breakdown, and calling it a downtrend would wrongly exclude healthy names.
  const rising = slope >= -0.005

  if (rising) {
    if (distance > 0.04) return { trend: 'uptrend_extended', atSupport }
    if (distance >= -0.04) return { trend: 'uptrend_pullback', atSupport }
    return { trend: 'uptrend_deep', atSupport }
  }
  return { trend: distance >= 0 ? 'downtrend_bounce' : 'downtrend', atSupport }
}

export function computeTechnicals(closes: number[], spotOverride?: number): Technicals {
  const spot = spotOverride ?? closes[closes.length - 1] ?? 0
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)

  // Compare the 200-day against its own value ~20 sessions ago.
  const sma200Prev = sma(closes, 200, 20)
  const sma200Slope = sma200 && sma200Prev ? (sma200 - sma200Prev) / sma200Prev : null

  const window52 = closes.slice(-252)
  const low52 = window52.length > 0 ? Math.min(...window52) : null
  const high52 = window52.length > 0 ? Math.max(...window52) : null

  const { trend, atSupport } = classifyTrend(spot, sma200, sma200Slope)

  return {
    spot,
    sma50,
    sma200,
    sma200Slope,
    distanceFrom200: sma200 ? (spot - sma200) / sma200 : null,
    low52,
    high52,
    rangePosition: low52 !== null && high52 !== null && high52 > low52 ? (spot - low52) / (high52 - low52) : null,
    rsi14: rsi(closes),
    percentB: percentB(closes),
    trend,
    atSupport,
    observations: closes.length,
  }
}

/** Human-readable trend label, for tooltips and explanation text. */
export const TREND_LABEL: Record<TrendState, string> = {
  uptrend_extended: 'above a rising 200-day average',
  uptrend_pullback: 'pulling back to a rising 200-day average',
  uptrend_deep: 'below a rising 200-day average',
  downtrend: 'below a falling 200-day average',
  downtrend_bounce: 'above a falling 200-day average',
  unknown: 'insufficient price history',
}

/**
 * Discount score, 0-100: how much this looks like quality on sale.
 *
 * Peaks on a pullback to a rising average and collapses in a downtrend. The
 * asymmetry is intentional and is the whole point of `classifyTrend` -- a falling
 * knife scores badly no matter how cheap it has become.
 */
export function scoreDiscount(t: Technicals): number | null {
  if (t.trend === 'unknown') return null

  const base: Record<Exclude<TrendState, 'unknown'>, number> = {
    uptrend_pullback: 92,
    uptrend_deep: 74,
    uptrend_extended: 42,
    downtrend_bounce: 30,
    downtrend: 8,
  }

  let score = base[t.trend]

  // Oversold inside an uptrend sweetens a genuine pullback; inside a downtrend it
  // means nothing, so only apply it where the trend is intact.
  const inUptrend = t.trend.startsWith('uptrend')
  if (inUptrend && t.percentB !== null && t.percentB < 0.2) score += 6
  if (inUptrend && t.rsi14 !== null && t.rsi14 < 35) score += 4

  return Math.max(0, Math.min(100, score))
}
