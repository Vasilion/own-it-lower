/**
 * The quality gate: is this a business worth owning if the shares are put to you?
 *
 * This is the half of the thesis that the technicals cannot see. A stock can sit
 * beautifully on a rising 200-day average and still be a company you would hate to
 * own at any price. Selling a cash-secured put is a commitment to buy, so the
 * question "would I want this business" has to be answered before "is the premium
 * good".
 *
 * Pure functions over a Fundamentals record. No network.
 */

import type { Fundamentals } from '../data/fundamentals'
import { clamp01to100, scoreAbove, scoreBelow, type Component } from './scoring'

/** Luke's stated floors. Failing any of these is disqualifying, not just a low score. */
export const QUALITY_GATE = {
  minMarketCap: 10_000_000_000,
  maxDebtToEquity: 2.0,
  requirePositiveFreeCashflow: true,
} as const

export interface QualityResult {
  /** 0-100 composite, or null when too little was available to judge. */
  score: number | null
  /** Hard-gate failures. Non-empty means the underlying is disqualified. */
  failures: string[]
  /** Inputs that were missing, so the UI can say what it could not check. */
  unknowns: string[]
  components: Component[]
}

const billions = (v: number) => `$${(v / 1e9).toFixed(1)}B`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * Apply the hard gate.
 *
 * A missing value is NOT a failure. We cannot assert that a company breaches a
 * limit we were unable to measure, and treating absence as breach would silently
 * disqualify every symbol whose fundamentals request happened to fail. Missing
 * values are reported separately as unknowns.
 */
export function gateQuality(f: Fundamentals): { failures: string[]; unknowns: string[] } {
  const failures: string[] = []
  const unknowns: string[] = []

  if (f.marketCap === null) unknowns.push('market cap')
  else if (f.marketCap < QUALITY_GATE.minMarketCap) {
    failures.push(`market cap ${billions(f.marketCap)} is below ${billions(QUALITY_GATE.minMarketCap)}`)
  }

  if (f.debtToEquity === null) unknowns.push('debt/equity')
  else if (f.debtToEquity > QUALITY_GATE.maxDebtToEquity) {
    failures.push(`debt/equity ${f.debtToEquity.toFixed(2)} is above ${QUALITY_GATE.maxDebtToEquity.toFixed(1)}`)
  }

  if (f.freeCashflow === null) unknowns.push('free cash flow')
  else if (QUALITY_GATE.requirePositiveFreeCashflow && f.freeCashflow <= 0) {
    failures.push(`free cash flow is negative at ${billions(f.freeCashflow)}`)
  }

  return { failures, unknowns }
}

export function scoreQuality(f: Fundamentals): QualityResult {
  const { failures, unknowns } = gateQuality(f)

  const components: Component[] = [
    {
      key: 'size',
      label: 'Size',
      // Above roughly $200B the extra scale stops telling us much, so the curve
      // flattens rather than rewarding mega-caps indefinitely.
      score: f.marketCap === null ? null : scoreAbove(Math.log10(f.marketCap), 10, 11.3),
      weight: 0.15,
      detail: f.marketCap === null ? 'market cap unavailable' : `${billions(f.marketCap)} market cap`,
    },
    {
      key: 'cashflow',
      label: 'Cash flow',
      score:
        f.freeCashflow === null
          ? null
          : f.freeCashflow <= 0
            ? 0
            : scoreAbove(Math.log10(f.freeCashflow), 8.5, 10.2),
      weight: 0.25,
      detail:
        f.freeCashflow === null
          ? 'free cash flow unavailable'
          : `${billions(f.freeCashflow)} free cash flow`,
    },
    {
      key: 'balance',
      label: 'Balance sheet',
      // Debt-free is not automatically best — modest leverage is normal — but the
      // score falls away steadily as it approaches and passes the 2.0 limit.
      score: f.debtToEquity === null ? null : scoreBelow(f.debtToEquity, 0.4, 2.5),
      weight: 0.25,
      detail:
        f.debtToEquity === null
          ? 'debt/equity unavailable'
          : `${f.debtToEquity.toFixed(2)} debt/equity`,
    },
    {
      key: 'growth',
      label: 'Growth',
      score:
        f.earningsGrowth === null && f.revenueGrowth === null
          ? null
          : blendGrowth(f.earningsGrowth, f.revenueGrowth),
      weight: 0.2,
      detail: growthDetail(f),
    },
    {
      key: 'profitability',
      label: 'Profitability',
      score:
        f.returnOnEquity === null && f.profitMargins === null
          ? null
          : blendProfitability(f.returnOnEquity, f.profitMargins),
      weight: 0.15,
      detail: profitabilityDetail(f),
    },
  ]

  const scored = components.filter((c) => c.score !== null)
  const availableWeight = scored.reduce((s, c) => s + c.weight, 0)

  // Below half the weight the composite is more noise than signal, so report no
  // score rather than a confident-looking number built from two fields.
  const score =
    availableWeight < 0.5
      ? null
      : clamp01to100(scored.reduce((s, c) => s + c.score! * c.weight, 0) / availableWeight)

  return { score, failures, unknowns, components }
}

function blendGrowth(earnings: number | null, revenue: number | null): number {
  // Earnings growth carries more weight but is far noisier quarter to quarter, so
  // revenue growth acts as the steadying half of the blend.
  const e = earnings === null ? null : scoreAbove(earnings, -0.1, 0.2)
  const r = revenue === null ? null : scoreAbove(revenue, -0.05, 0.15)
  if (e !== null && r !== null) return e * 0.6 + r * 0.4
  return (e ?? r)!
}

function growthDetail(f: Fundamentals): string {
  const bits: string[] = []
  if (f.earningsGrowth !== null) bits.push(`earnings ${pct(f.earningsGrowth)}`)
  if (f.revenueGrowth !== null) bits.push(`revenue ${pct(f.revenueGrowth)}`)
  return bits.length ? bits.join(', ') : 'growth unavailable'
}

function blendProfitability(roe: number | null, margins: number | null): number {
  const r = roe === null ? null : scoreAbove(roe, 0.05, 0.25)
  const m = margins === null ? null : scoreAbove(margins, 0.03, 0.2)
  if (r !== null && m !== null) return r * 0.5 + m * 0.5
  return (r ?? m)!
}

function profitabilityDetail(f: Fundamentals): string {
  const bits: string[] = []
  if (f.returnOnEquity !== null) bits.push(`ROE ${pct(f.returnOnEquity)}`)
  if (f.profitMargins !== null) bits.push(`margin ${pct(f.profitMargins)}`)
  return bits.length ? bits.join(', ') : 'profitability unavailable'
}
