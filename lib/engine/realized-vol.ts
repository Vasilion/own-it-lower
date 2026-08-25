/**
 * Realized (historical) volatility, and the implied-to-realized ratio.
 *
 * Exists because IV Rank cannot answer anything yet. Rank needs a year of a
 * symbol's own implied volatility, which we are accumulating one day at a time,
 * so for the first couple of months the column is simply blank.
 *
 * This measures a related and arguably more direct question, and it can be
 * answered immediately from price history we already fetch: are these options
 * priced above how much the stock has actually been moving?
 *
 * IV Rank asks "is this expensive for THIS stock, historically?"
 * IV/HV asks   "is this expensive for how it is ACTUALLY moving, right now?"
 *
 * Both are worth having. The second is available today.
 */

/**
 * Annualised realized volatility from close-to-close log returns.
 *
 * Close-to-close understates true volatility for names that gap or swing
 * intraday, so the ratio below is a floor on richness rather than a precise one.
 * Parkinson or Garman-Klass estimators would use the high/low we already hold, if
 * this ever needs to be sharper.
 */
export function realizedVolatility(closes: number[], window = 30): number | null {
  if (closes.length < window + 1) return null

  const slice = closes.slice(-(window + 1))
  const returns: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] > 0 && slice[i - 1] > 0) returns.push(Math.log(slice[i] / slice[i - 1]))
  }
  if (returns.length < window * 0.8) return null

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)

  return Math.sqrt(variance) * Math.sqrt(252)
}

/**
 * Implied divided by realized volatility.
 *
 * Above 1.0 means options are priced for more movement than the stock has
 * recently delivered — the variance risk premium, and the structural reason
 * selling premium can pay. Typical readings sit near 1.1 to 1.3; well above that
 * usually means an event is priced in rather than a gift.
 *
 * Below 1.0 means the opposite: options are cheap relative to how the stock is
 * actually moving, which is a poor moment to be selling them.
 */
export function impliedToRealized(impliedVol: number | null, realizedVol: number | null): number | null {
  if (!impliedVol || !realizedVol || realizedVol <= 0) return null
  return impliedVol / realizedVol
}

/** Descriptive band for an IV/HV reading. Descriptive, never prescriptive. */
export function richnessLabel(ratio: number | null): string {
  if (ratio === null) return 'unknown'
  if (ratio >= 1.6) return 'options priced far above recent movement'
  if (ratio >= 1.15) return 'options priced above recent movement'
  if (ratio >= 0.9) return 'options priced close to recent movement'
  return 'options priced below recent movement'
}
