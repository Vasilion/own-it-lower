/**
 * Black-Scholes-Merton pricing and greeks.
 *
 * Why this exists: greeks are DERIVED data, not licensed data. Given implied
 * volatility, spot, strike, time to expiry and the risk-free rate, every greek
 * falls out of a closed-form equation. That means we never have to pay for a
 * greeks feed -- we only need chain quotes (bid/ask/IV/OI) from a vendor, which
 * is dramatically cheaper and more widely available.
 */

/** Abramowitz & Stegun 7.1.26. Max absolute error ~1.5e-7 -- far tighter than our inputs. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

export interface BsInputs {
  /** Spot price of the underlying. */
  spot: number
  /** Strike price. */
  strike: number
  /** Time to expiry in YEARS. Use `yearsToExpiry()`. */
  t: number
  /** Annualised risk-free rate as a decimal (0.043 = 4.3%). Sourced from FRED. */
  rate: number
  /** Annualised implied volatility as a decimal (0.28 = 28%). */
  iv: number
  /** Continuous annual dividend yield as a decimal. Defaults to 0. */
  dividendYield?: number
}

export interface Greeks {
  price: number
  delta: number
  gamma: number
  /** Per-calendar-day theta (the raw model value divided by 365). */
  theta: number
  /** Vega per 1 percentage point move in IV. */
  vega: number
  /**
   * Risk-neutral probability the option expires out of the money, i.e. N(-d2)
   * for a put. This is the mathematically correct figure.
   */
  probOtm: number
  /**
   * The trader's shorthand: 1 - |delta|. Close to probOtm but not identical --
   * delta overstates ITM probability because it embeds the discounting term.
   * Exposed separately so the UI can show the familiar number without pretending
   * the two are the same thing.
   */
  probOtmDeltaApprox: number
}

/** Convert days-to-expiry into the year fraction Black-Scholes expects. */
export function yearsToExpiry(days: number): number {
  return Math.max(days, 0) / 365
}

function d1d2({ spot, strike, t, rate, iv, dividendYield = 0 }: BsInputs) {
  const vsqrt = iv * Math.sqrt(t)
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + (iv * iv) / 2) * t) / vsqrt
  return { d1, d2: d1 - vsqrt, vsqrt }
}

/**
 * Greeks for a European put -- the only contract type Own It Lower deals in.
 *
 * Degenerate inputs (expiry today, zero IV) would divide by zero, so they return
 * intrinsic value with a hard 0/1 delta rather than NaN. A NaN leaking into the
 * ranking engine would silently poison a whole scan.
 */
export function putGreeks(inputs: BsInputs): Greeks {
  const { spot, strike, t, rate, iv, dividendYield = 0 } = inputs

  if (!(t > 0) || !(iv > 0) || !(spot > 0) || !(strike > 0)) {
    const intrinsic = Math.max(strike - spot, 0)
    const itm = intrinsic > 0
    return {
      price: intrinsic,
      delta: itm ? -1 : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      probOtm: itm ? 0 : 1,
      probOtmDeltaApprox: itm ? 0 : 1,
    }
  }

  const { d1, d2 } = d1d2(inputs)
  const discount = Math.exp(-rate * t)
  const carry = Math.exp(-dividendYield * t)

  const price = strike * discount * normCdf(-d2) - spot * carry * normCdf(-d1)
  const delta = carry * (normCdf(d1) - 1) // negative for a long put
  const gamma = (carry * normPdf(d1)) / (spot * iv * Math.sqrt(t))
  const vega = (spot * carry * normPdf(d1) * Math.sqrt(t)) / 100
  const theta =
    (-(spot * carry * normPdf(d1) * iv) / (2 * Math.sqrt(t)) +
      rate * strike * discount * normCdf(-d2) -
      dividendYield * spot * carry * normCdf(-d1)) /
    365

  return {
    price,
    delta,
    gamma,
    theta,
    vega,
    probOtm: normCdf(d2),
    probOtmDeltaApprox: 1 - Math.abs(delta),
  }
}

/**
 * Back out implied volatility from an observed option price (Newton-Raphson with a
 * bisection fallback). Not needed while Yahoo supplies IV directly, but any vendor
 * that ships prices without IV will need it.
 */
export function impliedVolPut(
  targetPrice: number,
  inputs: Omit<BsInputs, 'iv'>,
  { tolerance = 1e-6, maxIterations = 60 } = {},
): number | null {
  const intrinsic = Math.max(inputs.strike * Math.exp(-inputs.rate * inputs.t) - inputs.spot, 0)
  if (targetPrice < intrinsic - tolerance) return null

  let lo = 1e-4
  let hi = 5
  let iv = 0.3

  for (let i = 0; i < maxIterations; i++) {
    const { price, vega } = putGreeks({ ...inputs, iv })
    const diff = price - targetPrice
    if (Math.abs(diff) < tolerance) return iv

    if (diff > 0) hi = iv
    else lo = iv

    // vega is per 1% here, so rescale before stepping
    const step = vega > 1e-8 ? iv - diff / (vega * 100) : NaN
    iv = Number.isFinite(step) && step > lo && step < hi ? step : (lo + hi) / 2
  }

  return Math.abs(hi - lo) < 1e-3 ? iv : null
}
