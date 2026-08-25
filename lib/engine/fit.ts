/**
 * The fit engine.
 *
 * Competing screeners are filters: you type numeric ranges and get matching rows.
 * This is a ranking engine. The same option chain is ordered differently for two
 * different users, because assignment stance reweights the whole model rather than
 * just narrowing the filter.
 *
 * Structure is deliberately three separate passes:
 *
 *   measure -> gate -> score
 *
 * `measure` is pure arithmetic on quoted numbers, with no opinion in it. `gate`
 * applies the user's hard limits. Only `score` holds a view. Keeping them apart is
 * what lets the UI show its work: every number on screen traces back to the
 * measurement pass and is checkable against the user's broker.
 */

import { putGreeks, yearsToExpiry } from './blackscholes'
import { combine, scoreAbove, scoreBelow, scorePeak, type Component } from './scoring'
import type {
  AssignmentStance,
  ContractMetrics,
  FitResult,
  StrategyPreset,
  UnderlyingContext,
} from './types'
import type { OptionQuote } from '../data/types'

/**
 * Component weights per stance. Each column sums to 1.
 *
 * This table IS the differentiator, so it is written out in full rather than
 * derived, and every column is meant to be readable as a sentence:
 *
 *   want    - "I am trying to buy this stock cheaper." Entry price dominates.
 *   avoid   - "I want the premium and not the shares." Safety and return dominate,
 *             and entry price barely matters because assignment is the bad case.
 */
const WEIGHTS: Record<AssignmentStance, Record<string, number>> = {
  want: { return: 0.14, safety: 0.14, entry: 0.26, liquidity: 0.13, timing: 0.08, discount: 0.15, quality: 0.10 },
  neutral: { return: 0.20, safety: 0.21, entry: 0.15, liquidity: 0.13, timing: 0.10, discount: 0.11, quality: 0.10 },
  avoid: { return: 0.26, safety: 0.30, entry: 0.05, liquidity: 0.13, timing: 0.13, discount: 0.07, quality: 0.06 },
}

// Note: there is deliberately no "delta preference" component. Delta is already a
// hard gate, and its effect within the band shows up through return and safety --
// a higher delta earns more premium and carries a thinner buffer. Scoring delta
// again on top of those would double-count the same trade-off.

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`
const usd = (v: number) => `$${v.toFixed(2)}`

// ---------------------------------------------------------------------------
// 1. Measure — arithmetic only, no judgement
// ---------------------------------------------------------------------------

export function measureContract(
  quote: OptionQuote,
  ctx: UnderlyingContext,
  preset: StrategyPreset,
  riskFreeRate: number,
  symbol: string,
  dte: number,
): ContractMetrics | null {
  const { strike, bid, ask, openInterest, volume, expiration } = quote
  const spot = ctx.spot
  if (!(strike > 0) || !(spot > 0)) return null

  // Selling means receiving the bid. A contract with no bid cannot be sold at all,
  // so it is not a candidate regardless of how attractive the rest of it looks.
  const premium = bid
  if (!(premium > 0)) return null

  const mid = ask > 0 ? (bid + ask) / 2 : bid
  const spreadPct = ask > 0 && mid > 0 ? (ask - bid) / mid : 1

  const breakeven = strike - premium
  const collateral = breakeven * 100
  if (!(collateral > 0)) return null

  const staticReturn = premium / breakeven
  const annualizedReturn = dte > 0 ? staticReturn * (365 / dte) : 0

  const iv = quote.impliedVolatility
  const t = yearsToExpiry(dte)
  const greeks =
    iv && iv > 0 ? putGreeks({ spot, strike, t, rate: riskFreeRate, iv }) : null

  // A vendor's delta reflects their own volatility surface and beats our
  // recomputation; ours is the fallback when they do not supply one.
  const delta = Math.abs(quote.delta ?? greeks?.delta ?? 0)
  const deltaSource: 'provider' | 'computed' = quote.delta != null ? 'provider' : 'computed'
  if (!(delta > 0)) return null

  const budget = preset.capital * preset.maxPositionPct
  const contractsAffordable = Math.floor(budget / collateral)

  let earningsBeforeExpiry: boolean | null = null
  if (ctx.nextEarnings) {
    const e = Date.parse(`${ctx.nextEarnings}T00:00:00Z`)
    const x = Date.parse(`${expiration}T00:00:00Z`)
    earningsBeforeExpiry = Number.isFinite(e) && Number.isFinite(x) ? e <= x && e >= Date.now() : null
  }

  return {
    symbol,
    strike,
    expiry: expiration,
    dte,
    bid,
    ask,
    mid,
    premium,
    collateral,
    staticReturn,
    annualizedReturn,
    breakeven,
    effectiveCostBasis: breakeven,
    downsideBuffer: (spot - breakeven) / spot,
    delta,
    probOtm: greeks?.probOtm ?? 1 - delta,
    deltaSource,
    spreadPct,
    openInterest,
    volume,
    contractsAffordable,
    earningsBeforeExpiry,
  }
}

// ---------------------------------------------------------------------------
// 2. Gate — the user's hard limits
// ---------------------------------------------------------------------------

export function gateContract(m: ContractMetrics, preset: StrategyPreset): string[] {
  const out: string[] = []

  if (m.delta < preset.minDelta) out.push(`delta ${m.delta.toFixed(2)} below ${preset.minDelta}`)
  if (m.delta > preset.maxDelta) out.push(`delta ${m.delta.toFixed(2)} above ${preset.maxDelta}`)
  if (m.dte < preset.minDte) out.push(`${m.dte}d expiry shorter than ${preset.minDte}d`)
  if (m.dte > preset.maxDte) out.push(`${m.dte}d expiry longer than ${preset.maxDte}d`)
  if (m.openInterest < preset.minOpenInterest) {
    out.push(`open interest ${m.openInterest} below ${preset.minOpenInterest}`)
  }
  // Passes on either the relative or the absolute test -- see maxSpreadAbs.
  const spreadAbs = m.ask - m.bid
  if (m.spreadPct > preset.maxSpreadPct && spreadAbs > preset.maxSpreadAbs) {
    out.push(`spread ${pct(m.spreadPct)} (${usd(spreadAbs)}) wider than ${pct(preset.maxSpreadPct)} / ${usd(preset.maxSpreadAbs)}`)
  }
  if (m.contractsAffordable < 1) {
    out.push(`needs ${usd(m.collateral)} collateral, over the per-position cap`)
  }
  if (preset.earningsPolicy === 'avoid' && m.earningsBeforeExpiry === true) {
    out.push('earnings falls before expiry')
  }

  return out
}

// ---------------------------------------------------------------------------
// 3. Score — the only pass that holds an opinion
// ---------------------------------------------------------------------------

function scoreComponents(
  m: ContractMetrics,
  ctx: UnderlyingContext,
  preset: StrategyPreset,
): Component[] {
  const w = WEIGHTS[preset.assignmentStance]

  // -- Return: annualised yield on the cash actually tied up.
  const returnScore = scoreAbove(m.annualizedReturn, 0.03, 0.25)

  // -- Safety: how far the stock can fall before the position hurts, blended with
  //    the chance of never being assigned at all.
  const bufferScore = scoreAbove(m.downsideBuffer, 0, 0.15)
  const otmScore = scoreAbove(m.probOtm, 0.55, 0.92)
  const safetyScore = bufferScore * 0.55 + otmScore * 0.45

  // -- Entry: only meaningful against a reference price. Abstains without one,
  //    rather than scoring zero and punishing symbols whose history failed to load.
  let entryScore: number | null = null
  let entryDetail = 'no 200-day average available'
  if (ctx.sma200 && ctx.sma200 > 0) {
    const discount = (ctx.sma200 - m.effectiveCostBasis) / ctx.sma200
    entryScore = scoreAbove(discount, -0.06, 0.14)
    entryDetail =
      discount >= 0
        ? `cost basis ${pct(discount)} below the 200-day`
        : `cost basis ${pct(-discount)} above the 200-day`
  }

  // -- Liquidity: can this actually be filled, and closed later.
  // Score the spread on whichever measure treats it more favourably, matching the
  // gate: a tight absolute market on a cheap option is genuinely liquid.
  const spreadAbs = m.ask - m.bid
  const spreadScore = Math.max(
    scoreBelow(m.spreadPct, 0.02, 0.15),
    scoreBelow(spreadAbs, 0.03, 0.2),
  )
  const liquidityScore = spreadScore * 0.6 + scoreAbove(m.openInterest, 10, 500) * 0.4

  // -- Timing: expiry near the middle of the requested window, plus earnings.
  const dtePeak = (preset.minDte + preset.maxDte) / 2
  let timingScore = scorePeak(m.dte, preset.minDte - 7, dtePeak, preset.maxDte + 7)
  let timingDetail = `${m.dte} days to expiry`
  if (m.earningsBeforeExpiry === true) {
    // Allowed by the preset, but it is still a volatility event inside the window.
    timingScore *= 0.55
    timingDetail += ', earnings before expiry'
  }

  // -- Discount and quality are separate questions and get separate slots. Each
  //    abstains independently when its inputs have not been loaded.
  const discountScore = ctx.discountScore ?? null
  const qualityScore = ctx.qualityScore ?? null

  return [
    {
      key: 'return',
      label: 'Return',
      score: returnScore,
      weight: w.return,
      detail: `${pct(m.annualizedReturn)} annualised on ${usd(m.collateral)} collateral`,
    },
    {
      key: 'safety',
      label: 'Safety',
      score: safetyScore,
      weight: w.safety,
      detail: `${pct(m.downsideBuffer)} downside buffer, ${pct(m.probOtm, 0)} chance of expiring worthless`,
    },
    { key: 'entry', label: 'Entry price', score: entryScore, weight: w.entry, detail: entryDetail },
    {
      key: 'liquidity',
      label: 'Liquidity',
      score: liquidityScore,
      weight: w.liquidity,
      detail: `${pct(m.spreadPct)} (${usd(spreadAbs)}) spread, ${m.openInterest.toLocaleString()} open interest`,
    },
    { key: 'timing', label: 'Timing', score: timingScore, weight: w.timing, detail: timingDetail },
    {
      key: 'discount',
      label: 'Discount',
      score: discountScore,
      weight: w.discount,
      detail: discountScore === null ? 'price history not loaded' : `technical setup scores ${discountScore.toFixed(0)}`,
    },
    {
      key: 'quality',
      label: 'Quality',
      score: qualityScore,
      weight: w.quality,
      detail: qualityScore === null ? 'fundamentals not loaded' : `fundamentals score ${qualityScore.toFixed(0)}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RankOptions {
  symbol: string
  puts: OptionQuote[]
  /** Days to expiry per ISO expiry date. */
  dteByExpiry: Map<string, number>
  context: UnderlyingContext
  preset: StrategyPreset
  riskFreeRate: number
  /** Include contracts that failed a hard gate, marked with their exclusions. */
  includeExcluded?: boolean
}

export function rankPuts(opts: RankOptions): FitResult[] {
  const { symbol, puts, dteByExpiry, context, preset, riskFreeRate } = opts
  const results: FitResult[] = []

  for (const quote of puts) {
    const dte = dteByExpiry.get(quote.expiration)
    if (dte === undefined) continue

    const metrics = measureContract(quote, context, preset, riskFreeRate, symbol, dte)
    if (!metrics) continue

    const exclusions = gateContract(metrics, preset)
    if (exclusions.length > 0 && !opts.includeExcluded) continue

    const components = scoreComponents(metrics, context, preset)
    const { total, abstainedWeight } = combine(components)

    results.push({
      metrics,
      // An excluded contract keeps its measurements but forfeits its score, so it
      // can never outrank something the user actually said yes to.
      fitScore: exclusions.length > 0 ? 0 : total,
      components,
      abstainedWeight,
      explanation: '',
      exclusions,
    })
  }

  return results.sort((a, b) => b.fitScore - a.fitScore)
}

/**
 * Why contracts were excluded, tallied by cause.
 *
 * "No results" is the worst possible answer for a screener to give in silence --
 * the user cannot tell whether the market has nothing to offer today or whether one
 * of their own settings is too tight. Reporting the binding constraint turns a dead
 * end into an obvious next action ("287 excluded by position size" means raise the
 * capital, not go away).
 */
export function tallyExclusions(results: FitResult[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>()

  for (const r of results) {
    // Credit only the first failure per contract, so one contract failing four
    // gates does not inflate four separate tallies.
    const first = r.exclusions[0]
    if (!first) continue
    // Collapse "delta 0.12 below 0.18" into "delta below range" so the tally groups.
    const reason = first
      .replace(/delta [\d.]+ below [\d.]+/, 'delta below range')
      .replace(/delta [\d.]+ above [\d.]+/, 'delta above range')
      .replace(/\d+d expiry shorter than \d+d/, 'expiry too soon')
      .replace(/\d+d expiry longer than \d+d/, 'expiry too far out')
      .replace(/open interest \d+ below \d+/, 'open interest too low')
      .replace(/spread [\d.]+% \(\$[\d.]+\) wider than .+/, 'spread too wide')
      .replace(/needs \$[\d,.]+ collateral, over the per-position cap/, 'position size over cap')
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
}
