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
  /**
   * Implied divided by realised volatility, used as the premium measure until IV
   * Rank has enough history to take over.
   *
   * Without this the IV leg abstained for every symbol, so the screener ranked on
   * quality and discount alone -- and put GOOG second at 95 while its options were
   * priced at 0.68x realised volatility. A premium screener that ignores whether
   * the premium is any good is only doing two thirds of its job.
   */
  ivToHv: number | null
  /** Hard quality-floor breaches. Any of these caps the setup score. */
  qualityFailures: string[]
}

/**
 * Score implied-to-realised richness, 0-100.
 *
 * Deliberately not monotonic. Below parity the options are cheap relative to how
 * the stock actually moves, which is a bad moment to sell them. The sweet spot is
 * the ordinary variance risk premium. Far above it, the extra is usually an event
 * being priced in -- real compensation for real risk, not an edge -- so the curve
 * comes back down rather than rewarding it without limit.
 */
export function scoreIvRichness(ratio: number): number {
  if (ratio <= 0.7) return 0
  if (ratio < 1.0) return ((ratio - 0.7) / 0.3) * 45
  if (ratio < 1.2) return 45 + ((ratio - 1.0) / 0.2) * 40
  if (ratio <= 1.6) return 85 + ((ratio - 1.2) / 0.4) * 15
  if (ratio <= 2.2) return 100 - ((ratio - 1.6) / 0.6) * 45
  return 50
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
      key: 'premium',
      label: 'Premium',
      // Prefers IV Rank once it exists -- it is the better measure, because it
      // compares a stock to its own history rather than to its recent movement.
      // Falls back to implied-vs-realised, which is available immediately.
      // Abstains only when neither can be computed.
      score:
        input.ivRank !== null
          ? scoreAbove(input.ivRank, 20, 65)
          : input.ivToHv !== null
            ? scoreIvRichness(input.ivToHv)
            : null,
      weight: 0.3,
      detail:
        input.ivRank !== null
          ? `IV Rank ${Math.round(input.ivRank)}`
          : input.ivToHv !== null
            ? `options at ${input.ivToHv.toFixed(2)}x realised volatility`
            : 'no volatility measure available',
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
