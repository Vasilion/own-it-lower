/**
 * Volume-at-price profile.
 *
 * Moving averages say where price has been on average. A volume profile says
 * where shares actually changed hands, which is a far better description of
 * support: a thick shelf of prior trading beneath your break-even is a price band
 * buyers have repeatedly defended, whereas a thin one is a gap price falls
 * through quickly.
 *
 * For a put seller that distinction is the whole risk question, so the profile
 * feeds the scoring rather than just decorating the page.
 *
 * Pure functions over daily bars. No network, no framework.
 *
 * NOTE ON THE WINDOW: this is the visible-range idea, and the answer genuinely
 * depends on how far back you look. On GOOG in August 2026 the point of control
 * sat at $342 over 130 sessions but $317 over 252 -- neither is wrong, they
 * answer different questions. The lookback is therefore a control the user can
 * change, never a constant hidden in the code.
 */

export interface Bar {
  high: number
  low: number
  close: number
  volume: number
}

export interface VolumeNode {
  /** Mid price of the bucket. */
  price: number
  /** Share of total volume in the window, 0-1. */
  share: number
}

export interface VolumeProfile {
  /** Price with the heaviest traded volume — the point of control. */
  poc: number
  /** Value area: the band containing 70% of traded volume. */
  valueAreaLow: number
  valueAreaHigh: number
  low: number
  high: number
  /** Every bucket, low price to high, for rendering the histogram. */
  buckets: VolumeNode[]
  /** Sessions actually used. */
  sessions: number
}

const DEFAULT_BUCKETS = 60
/** Standard convention: the value area holds 70% of traded volume. */
const VALUE_AREA_SHARE = 0.7

/**
 * Build the profile.
 *
 * Each bar's volume is spread evenly across the buckets its high-low range spans.
 * That is the standard approximation — without intraday data there is no way to
 * know where inside the day's range the volume actually printed, and assigning it
 * all to the close would fabricate precision the data does not support.
 */
export function computeVolumeProfile(
  bars: Bar[],
  lookbackSessions = 252,
  bucketCount = DEFAULT_BUCKETS,
): VolumeProfile | null {
  const window = bars.slice(-lookbackSessions).filter((b) => b.high > 0 && b.low > 0 && b.volume > 0)
  if (window.length < 20) return null

  const low = Math.min(...window.map((b) => b.low))
  const high = Math.max(...window.map((b) => b.high))
  if (!(high > low)) return null

  const width = (high - low) / bucketCount
  const volumes = new Array<number>(bucketCount).fill(0)

  for (const bar of window) {
    const first = Math.max(0, Math.floor((bar.low - low) / width))
    const last = Math.min(bucketCount - 1, Math.floor((bar.high - low) / width))
    const spanned = last - first + 1
    const perBucket = bar.volume / spanned
    for (let i = first; i <= last; i++) volumes[i] += perBucket
  }

  const total = volumes.reduce((a, b) => a + b, 0)
  if (total <= 0) return null

  const pocIndex = volumes.indexOf(Math.max(...volumes))

  // Grow outward from the point of control, always taking the heavier neighbour,
  // until 70% of volume is enclosed. This is the standard value-area construction.
  let lowIndex = pocIndex
  let highIndex = pocIndex
  let accumulated = volumes[pocIndex]
  while (accumulated < total * VALUE_AREA_SHARE && (lowIndex > 0 || highIndex < bucketCount - 1)) {
    const below = lowIndex > 0 ? volumes[lowIndex - 1] : -1
    const above = highIndex < bucketCount - 1 ? volumes[highIndex + 1] : -1
    if (above >= below) accumulated += volumes[++highIndex]
    else accumulated += volumes[--lowIndex]
  }

  return {
    poc: low + width * (pocIndex + 0.5),
    valueAreaLow: low + width * lowIndex,
    valueAreaHigh: low + width * (highIndex + 1),
    low,
    high,
    buckets: volumes.map((v, i) => ({ price: low + width * (i + 0.5), share: v / total })),
    sessions: window.length,
  }
}

/**
 * Share of traded volume sitting in the band just beneath a price, 0-1.
 *
 * This is the number that matters for a put seller. A strike with a thick shelf
 * of prior trading below its break-even has real buyers underneath it; one
 * hanging over a volume gap does not, however attractive its premium looks.
 *
 * `depth` is how far below to look, as a fraction of price. 12% roughly matches
 * the move that would put a 30-delta put meaningfully in the money.
 */
export function supportBelow(profile: VolumeProfile, price: number, depth = 0.12): number {
  const floor = price * (1 - depth)
  return profile.buckets
    .filter((b) => b.price <= price && b.price >= floor)
    .reduce((sum, b) => sum + b.share, 0)
}

/** Where a price sits relative to the value area. */
export function priceZone(
  profile: VolumeProfile,
  price: number,
): 'below_value' | 'in_value' | 'above_value' {
  if (price < profile.valueAreaLow) return 'below_value'
  if (price > profile.valueAreaHigh) return 'above_value'
  return 'in_value'
}

export const ZONE_LABEL: Record<ReturnType<typeof priceZone>, string> = {
  below_value: 'below the value area',
  in_value: 'inside the value area',
  above_value: 'above the value area',
}

/**
 * Score a break-even on structural support, 0-100.
 *
 * Rewards volume beneath the break-even. Deliberately does NOT reward sitting
 * inside the point of control: heavy volume at your exact strike is a price
 * magnet, not a floor, and the support that protects a put seller is the volume
 * BELOW where they would be assigned.
 */
export function scoreStructure(profile: VolumeProfile, breakeven: number): number {
  const support = supportBelow(profile, breakeven)
  // 25% of a year's volume packed into the 12% beneath break-even is a lot of
  // defended price; that is treated as a full score.
  const supportScore = Math.max(0, Math.min(100, (support / 0.25) * 100))

  // A break-even under the value area low means the market would have to leave
  // the band it has spent 70% of its time in before assignment bites.
  const zoneBonus = priceZone(profile, breakeven) === 'below_value' ? 12 : 0

  return Math.max(0, Math.min(100, supportScore + zoneBonus))
}
