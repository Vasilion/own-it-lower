/**
 * Deterministic explanation of a contract.
 *
 * No language model touches this path, for three reasons. It is free and instant.
 * It cannot hallucinate a number that contradicts the table above it. And most
 * importantly, a model cannot invent advice into the output if it is never in the
 * loop -- every sentence below is generated from arithmetic already computed in the
 * measurement pass.
 *
 * COMPLIANCE RULES FOR ANYTHING ADDED HERE:
 *   - State facts about the contract. Never tell the user what to do.
 *   - No "should", "recommend", "buy", "best", "opportunity", "we like".
 *   - Every figure must trace to ContractMetrics, so the user can check it against
 *     their own broker and find the same number.
 */

import type { ContractMetrics, StrategyPreset, UnderlyingContext } from './types'

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`
const usd = (v: number) => `$${v.toFixed(2)}`
const money = (v: number) => `$${Math.round(v).toLocaleString()}`

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Build the per-contract explanation.
 *
 * The "if assigned" sentence is the one place the stance changes the wording, and
 * it changes only emphasis, never the numbers: someone selling puts to acquire
 * shares is reading that line as the point of the trade, while someone selling for
 * income is reading it as the downside case.
 */
export function explainContract(
  m: ContractMetrics,
  ctx: UnderlyingContext,
  preset: StrategyPreset,
): string {
  const parts: string[] = []

  // -- Mechanics
  parts.push(
    `Selling the ${usd(m.strike)} put expiring ${formatDate(m.expiry)} (${m.dte} days) collects ` +
      `${usd(m.premium)} per share, or ${money(m.premium * 100)} per contract, against ` +
      `${money(m.collateral)} of secured cash.`,
  )

  // -- Return
  parts.push(
    `If it expires worthless that is ${pct(m.staticReturn)} over ${m.dte} days, ` +
      `equal to ${pct(m.annualizedReturn)} annualised.`,
  )

  // -- Downside
  parts.push(
    `Break-even is ${usd(m.breakeven)}, so ${ctx.spot > 0 ? `${pct(m.downsideBuffer)} below the current ` +
      `${usd(ctx.spot)}` : 'below the current price'}. ` +
      `Delta of ${m.delta.toFixed(2)} corresponds to roughly a ${pct(m.probOtm, 0)} chance of expiring worthless.`,
  )

  // -- Assignment
  const assigned = `If assigned, the effective cost basis is ${usd(m.effectiveCostBasis)}`
  if (ctx.sma200 && ctx.sma200 > 0) {
    const discount = (ctx.sma200 - m.effectiveCostBasis) / ctx.sma200
    parts.push(
      discount >= 0
        ? `${assigned} — ${pct(discount)} below the 200-day average of ${usd(ctx.sma200)}.`
        : `${assigned} — ${pct(-discount)} above the 200-day average of ${usd(ctx.sma200)}.`,
    )
  } else {
    parts.push(`${assigned}.`)
  }

  if (preset.capital > 0 && m.contractsAffordable > 1) {
    parts.push(
      `The ${pct(preset.maxPositionPct, 0)} position cap allows ${m.contractsAffordable} contracts.`,
    )
  }

  if (m.impliedVolatility) {
    parts.push(`Implied volatility on this contract is ${pct(m.impliedVolatility)}.`)
  }

  // -- Flags. Stated as conditions, not as verdicts.
  const flags: string[] = []
  if (m.earningsBeforeExpiry === true && ctx.nextEarnings) {
    flags.push(`earnings on ${formatDate(ctx.nextEarnings)} falls before this expiry`)
  }
  if (m.spreadPct > 0.08) flags.push(`the bid-ask spread is wide at ${pct(m.spreadPct)}`)
  if (m.openInterest < 50) flags.push(`open interest is thin at ${m.openInterest.toLocaleString()}`)
  if (ctx.sma200Slope !== undefined && ctx.sma200Slope < 0) {
    flags.push('the 200-day average is trending down rather than up')
  }
  if (ctx.ivRank !== undefined && ctx.ivRank < 30) {
    flags.push(`IV Rank is low at ${ctx.ivRank.toFixed(0)}, so the premium is small relative to this stock's own history`)
  }

  if (flags.length > 0) {
    parts.push(`Worth noting: ${flags.join('; ')}.`)
  }

  return parts.join(' ')
}

/**
 * One-line summary for a table row.
 *
 * Facts separated by middots. Deliberately not a verdict -- the fit score sits in
 * its own column as a number and a colour, and the label for that number lives in
 * a tooltip so a table row can never read as an instruction.
 */
export function summariseContract(m: ContractMetrics): string {
  const bits = [
    `${m.delta.toFixed(2)} delta`,
    `${pct(m.annualizedReturn)} annualised`,
    `${pct(m.downsideBuffer)} buffer`,
    `basis ${usd(m.effectiveCostBasis)}`,
  ]
  if (m.earningsBeforeExpiry === true) bits.push('earnings before expiry')
  return bits.join(' · ')
}
