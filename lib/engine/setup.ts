/**
 * Symbol-level setup score: is this business worth looking at today?
 *
 * Distinct from the fit score, which ranks CONTRACTS against a user's settings.
 * This ranks SYMBOLS, and deliberately takes no user input at all — which is why
 * it can be precomputed nightly for the whole universe while contract fit cannot.
 *
 * It is the thesis in three terms:
 *
 *   Quality  — a business worth owning if the shares are put to you
 *   Discount — trading into support rather than extended or breaking down
 *   IV Rank  — its own options are expensive relative to their history, so the
 *              premium is fat and the effective entry price is lower
 *
 * Discount carries the most weight because it is the timing signal. Quality changes
 * over quarters; a pullback is what makes today different from last week.
 */

import { clamp01to100, combine, scoreAbove, type Component } from './scoring'

export interface SetupInputs {
  qualityScore: number | null
  discountScore: number | null
  /** 0-100 from our own accumulated history. Null until ~40 observations exist. */
  ivRank: number | null
  /** Hard quality-floor breaches. Any of these caps the setup score. */
  qualityFailures: string[]
}

export interface SetupResult {
  score: number | null
  components: Component[]
  abstainedWeight: number
  /** True when a hard quality floor was breached. */
  disqualified: boolean
}

/**
 * Ceiling applied when the underlying breaches a hard quality floor.
 *
 * Capped rather than zeroed, and never removed from the list. A screener that
 * silently drops rows teaches the user nothing; one that shows a disqualified name
 * sitting low, with the reason attached, teaches them what the floor is for. It
 * also means a user who disagrees with the floor can still find the name.
 */
const DISQUALIFIED_CEILING = 35

export function scoreSetup(input: SetupInputs): SetupResult {
  const components: Component[] = [
    {
      key: 'quality',
      label: 'Quality',
      score: input.qualityScore,
      weight: 0.3,
      detail:
        input.qualityScore === null
          ? 'fundamentals unavailable'
          : `fundamentals score ${Math.round(input.qualityScore)}`,
    },
    {
      key: 'discount',
      label: 'Discount',
      score: input.discountScore,
      weight: 0.4,
      detail:
        input.discountScore === null
          ? 'price history unavailable'
          : `technical setup ${Math.round(input.discountScore)}`,
    },
    {
      key: 'ivrank',
      label: 'IV Rank',
      // Abstains, rather than scoring zero, until enough history exists. Treating
      // "not measured yet" as "no premium available" would rank the entire
      // universe as unattractive for the first two months of the product's life.
      score: input.ivRank === null ? null : scoreAbove(input.ivRank, 20, 65),
      weight: 0.3,
      detail:
        input.ivRank === null
          ? 'building IV history'
          : `IV Rank ${Math.round(input.ivRank)}`,
    },
  ]

  const { total, abstainedWeight } = combine(components)
  const disqualified = input.qualityFailures.length > 0

  return {
    score: abstainedWeight >= 1 ? null : clamp01to100(disqualified ? Math.min(total, DISQUALIFIED_CEILING) : total),
    components,
    abstainedWeight,
    disqualified,
  }
}
