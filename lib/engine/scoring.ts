/**
 * Normalisation helpers for the fit engine.
 *
 * Every component score is expressed on a 0-100 scale so that weights are the only
 * thing that decides relative importance. Raw units (dollars, percentages, days,
 * open interest) never leak into the weighted sum, because if they did, changing a
 * unit would silently change the ranking.
 */

export const clamp01to100 = (v: number): number => Math.max(0, Math.min(100, v))

/** Higher is better. `floor` scores 0, `good` and above scores 100. */
export function scoreAbove(value: number, floor: number, good: number): number {
  if (!Number.isFinite(value)) return 0
  if (good === floor) return value >= good ? 100 : 0
  return clamp01to100(((value - floor) / (good - floor)) * 100)
}

/** Lower is better. `good` and below scores 100, `ceiling` scores 0. */
export function scoreBelow(value: number, good: number, ceiling: number): number {
  if (!Number.isFinite(value)) return 0
  if (ceiling === good) return value <= good ? 100 : 0
  return clamp01to100(((ceiling - value) / (ceiling - good)) * 100)
}

/**
 * Triangular preference: 0 at the edges, 100 at `peak`.
 *
 * Used where both too little and too much are bad -- delta is the obvious case.
 * A 0.05-delta put is nearly free money that pays nothing; a 0.60-delta put is
 * close to just buying the stock.
 */
export function scorePeak(value: number, lo: number, peak: number, hi: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= lo || value >= hi) return 0
  return value <= peak
    ? clamp01to100(((value - lo) / (peak - lo)) * 100)
    : clamp01to100(((hi - value) / (hi - peak)) * 100)
}

/**
 * One scored component, or an explicit abstention.
 *
 * Abstaining is deliberately distinct from scoring zero. A missing 200-day average
 * means we do not know whether the entry is good; it does not mean the entry is
 * bad. Collapsing those two cases would quietly punish every symbol whose
 * fundamentals or price history failed to load, and the resulting ranking would
 * look confident while being driven by data-availability noise.
 */
export interface Component {
  key: string
  label: string
  /** 0-100, or null when the inputs required to judge it were unavailable. */
  score: number | null
  weight: number
  /** Short human-readable reason, shown in the breakdown. */
  detail: string
}

export interface WeightedResult {
  /** 0-100 overall, computed only across components that actually scored. */
  total: number
  components: Component[]
  /** Share of total weight that abstained. High values mean a thin verdict. */
  abstainedWeight: number
}

/**
 * Combine components, renormalising over whatever actually scored.
 *
 * Renormalising rather than treating an abstention as zero is what keeps a symbol
 * with partial data comparable to one with complete data. `abstainedWeight` is
 * returned so the UI can mark a score that rests on half the evidence.
 */
export function combine(components: Component[]): WeightedResult {
  const scored = components.filter((c) => c.score !== null)
  const availableWeight = scored.reduce((sum, c) => sum + c.weight, 0)
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0)

  if (availableWeight <= 0) {
    return { total: 0, components, abstainedWeight: 1 }
  }

  const total = scored.reduce((sum, c) => sum + c.score! * c.weight, 0) / availableWeight

  return {
    total: clamp01to100(total),
    components,
    abstainedWeight: totalWeight > 0 ? (totalWeight - availableWeight) / totalWeight : 0,
  }
}
