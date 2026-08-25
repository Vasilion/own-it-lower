/**
 * IV Rank and IV Percentile, computed from our own accumulated snapshot history.
 *
 *   IV Rank       - where today's IV sits between the window's low and high (0-100)
 *   IV Percentile - what share of days in the window had a LOWER IV than today (0-100)
 *
 * They answer different questions. Rank is dominated by the two extreme days in the
 * window, so a single volatility spike can suppress it for a year. Percentile is
 * distribution-aware and generally the steadier signal. We compute and display both.
 */

/** Below this many observations, a rank is noise dressed up as a number. */
export const MIN_OBSERVATIONS = 40

/** A full year of trading days. */
export const FULL_WINDOW_DAYS = 252

export interface IvRankResult {
  ivRank: number | null
  ivPercentile: number | null
  /** Observations actually used. */
  observations: number
  /**
   * True once we hold roughly a year of history. Until then the numbers are still
   * computed but describe a shorter window, and the UI must say so -- labelling a
   * 60-day rank as "IV Rank" is the kind of quiet dishonesty that erodes trust the
   * moment a user cross-checks it against their broker.
   */
  isFullWindow: boolean
  /** Ready-to-render qualifier, e.g. "IV Rank" or "IV Rank (60d)". */
  label: string
  low: number | null
  high: number | null
}

export function computeIvRank(currentIv: number, history: number[]): IvRankResult {
  const clean = history.filter((v) => Number.isFinite(v) && v > 0)
  const observations = clean.length

  const insufficient: IvRankResult = {
    ivRank: null,
    ivPercentile: null,
    observations,
    isFullWindow: false,
    label: 'IV Rank (building history)',
    low: null,
    high: null,
  }

  if (!Number.isFinite(currentIv) || currentIv <= 0 || observations < MIN_OBSERVATIONS) {
    return insufficient
  }

  const low = Math.min(...clean)
  const high = Math.max(...clean)
  const isFullWindow = observations >= FULL_WINDOW_DAYS * 0.9

  // A flat window has no range to rank against; treat it as mid rather than dividing by zero.
  const span = high - low
  const ivRank = span > 1e-9 ? ((currentIv - low) / span) * 100 : 50

  const below = clean.reduce((n, v) => n + (v < currentIv ? 1 : 0), 0)
  const ivPercentile = (below / observations) * 100

  return {
    ivRank: clamp(ivRank),
    ivPercentile: clamp(ivPercentile),
    observations,
    isFullWindow,
    label: isFullWindow ? 'IV Rank' : `IV Rank (${observations}d)`,
    low,
    high,
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v))
}
