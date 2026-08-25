import type { Component } from './scoring'

/**
 * How the user feels about actually being assigned the shares.
 *
 * This single field is the product. It does not filter the chain differently -- it
 * reweights the entire scoring model, so the same option chain comes back in a
 * different order for two people looking at the same stock on the same day.
 *
 *   want    - selling puts as a way to buy the stock cheaper. Assignment is the
 *             goal, so effective cost basis dominates and higher deltas are fine.
 *   neutral - happy either way.
 *   avoid   - selling puts purely for income. Assignment is the failure case, so
 *             probability of expiring worthless dominates and deltas stay low.
 */
export type AssignmentStance = 'want' | 'neutral' | 'avoid'

/**
 * User-chosen screen settings.
 *
 * Deliberately named a "strategy preset" and NOT a "risk tolerance profile".
 * Risk tolerance is the language of suitability analysis, which is what investment
 * advisers do. These are tool parameters: no net worth, no income, no tax status,
 * no goals. That framing is load-bearing for staying inside the publisher's
 * exemption, and it costs nothing in usability.
 */
export interface StrategyPreset {
  /** Cash available to secure puts, in dollars. */
  capital: number
  /** Ceiling on how much of that capital one position may tie up (0-1). */
  maxPositionPct: number

  assignmentStance: AssignmentStance

  /** Absolute delta bounds. Defaults derive from the stance. */
  minDelta: number
  maxDelta: number

  minDte: number
  maxDte: number

  /** Whether a contract whose expiry straddles an earnings date is acceptable. */
  earningsPolicy: 'allow' | 'avoid'

  /** Hard liquidity floors -- a great-looking contract nobody trades is unusable. */
  minOpenInterest: number
  maxSpreadPct: number
  /**
   * Absolute spread ceiling in dollars per share. A contract passes the liquidity
   * gate if it satisfies EITHER this or `maxSpreadPct`.
   *
   * A percentage-only rule quietly discriminates against low-priced options: a
   * perfectly normal $0.10 market on a $1.00 put reads as a 10% spread and gets
   * cut, while the same $0.10 market on a $10.00 put sails through at 1%. On a
   * liquid name like KO most 30-delta puts trade for around a dollar, so the
   * percentage rule alone was excluding the entire chain.
   */
  maxSpreadAbs: number
}

/** Sensible starting points per stance; every field stays user-overridable. */
export const STANCE_DEFAULTS: Record<AssignmentStance, Pick<StrategyPreset, 'minDelta' | 'maxDelta'>> = {
  want: { minDelta: 0.28, maxDelta: 0.48 },
  neutral: { minDelta: 0.18, maxDelta: 0.36 },
  avoid: { minDelta: 0.08, maxDelta: 0.24 },
}

export function makePreset(input: Partial<StrategyPreset> = {}): StrategyPreset {
  const assignmentStance = input.assignmentStance ?? 'neutral'
  const deltaDefaults = STANCE_DEFAULTS[assignmentStance]

  // Explicit user input always wins over the stance-derived default.
  return {
    capital: input.capital ?? 25_000,
    // Cash-secured put sellers typically run two or three positions, not ten, so
    // half the account in one name is normal rather than reckless. An earlier 0.34
    // default rejected a 0.34-delta KO put with 2,805 open interest purely because
    // its $8,904 collateral overran an $8,500 budget by $404.
    maxPositionPct: input.maxPositionPct ?? 0.5,
    assignmentStance,
    minDelta: input.minDelta ?? deltaDefaults.minDelta,
    maxDelta: input.maxDelta ?? deltaDefaults.maxDelta,
    minDte: input.minDte ?? 21,
    maxDte: input.maxDte ?? 49,
    earningsPolicy: input.earningsPolicy ?? 'avoid',
    minOpenInterest: input.minOpenInterest ?? 25,
    maxSpreadPct: input.maxSpreadPct ?? 0.12,
    maxSpreadAbs: input.maxSpreadAbs ?? 0.1,
  }
}

/**
 * Everything measurable about one put, before any opinion is applied.
 *
 * All of it is arithmetic on quoted numbers. Keeping the measurement layer strictly
 * separate from the scoring layer is what lets the UI show its work: every figure
 * here is checkable by the user against their broker.
 */
export interface ContractMetrics {
  symbol: string
  strike: number
  expiry: string
  dte: number

  bid: number
  ask: number
  mid: number
  /**
   * Credit assumed per share. This is the BID, not the mid.
   *
   * You are selling, so the bid is what a marketable order actually gets. Screeners
   * that quote mid systematically overstate every return they print, and the user
   * discovers the gap only when their fill comes in worse than advertised. Being
   * honest here costs a few basis points on paper and buys all of the credibility.
   */
  premium: number
  /** Cash the position ties up: (strike - premium) x 100. */
  collateral: number

  /** premium / collateral, i.e. the return if it expires worthless. */
  staticReturn: number
  /** staticReturn scaled to a year. Comparable across expiries. */
  annualizedReturn: number

  /** strike - premium: the price below which the position starts losing. */
  breakeven: number
  /** Same number viewed as an entry price, if assigned. */
  effectiveCostBasis: number
  /** (spot - breakeven) / spot: how far the stock can fall before it hurts. */
  downsideBuffer: number

  /** Absolute delta, 0-1. */
  delta: number
  /** Risk-neutral probability of expiring out of the money. */
  probOtm: number
  /** Where delta came from, since a vendor value beats our recomputation. */
  deltaSource: 'provider' | 'computed'

  spreadPct: number
  openInterest: number
  volume: number

  /** How many contracts the preset's capital and position cap actually allow. */
  contractsAffordable: number
  earningsBeforeExpiry: boolean | null
}

/** Optional context about the underlying. Absent fields make components abstain. */
export interface UnderlyingContext {
  spot: number
  /** Simple 200-day moving average. */
  sma200?: number
  /** 200-day average slope over the last ~20 sessions, as a fraction. */
  sma200Slope?: number
  sma50?: number
  /** 52-week low and high. */
  low52?: number
  high52?: number
  /** IV Rank 0-100, from our own accumulated history. */
  ivRank?: number
  /**
   * Composite 0-100 from the FUNDAMENTALS gate (market cap, free cash flow,
   * debt/equity, earnings growth). Distinct from `discountScore` -- quality asks
   * whether this is a business worth owning, discount asks whether now is a
   * reasonable price. Conflating them would let a cheap bad company score like a
   * good one on sale.
   */
  qualityScore?: number
  /** Composite 0-100 from price technicals -- see scoreDiscount(). */
  discountScore?: number
  /** Next confirmed earnings date, ISO. */
  nextEarnings?: string
}

export interface FitResult {
  metrics: ContractMetrics
  /** 0-100. Displayed as a number and a colour tier -- never as an instruction. */
  fitScore: number
  components: Component[]
  abstainedWeight: number
  /** Deterministic, template-generated. No language model in this path. */
  explanation: string
  /** Hard-gate failures. A non-empty list means the contract was excluded. */
  exclusions: string[]
}
