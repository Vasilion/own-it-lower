'use client'

import type { VolumeProfile } from '@/lib/engine/volume-profile'

const usd = (v: number) => `$${v.toFixed(2)}`

const LOOKBACKS = [
  { sessions: 60, label: '3M' },
  { sessions: 130, label: '6M' },
  { sessions: 252, label: '1Y' },
]

/**
 * Volume-at-price, drawn as a horizontal histogram with the candidate strikes
 * marked against it.
 *
 * The point is confluence: seeing that a strike sits under a thick shelf of prior
 * trading is a different piece of evidence from its delta, and the two together
 * are a better risk read than either alone. Where a moving average says where
 * price has been on average, this says where shares actually changed hands.
 *
 * Rendered as plain divs rather than a charting library — it is a bar chart of
 * sixty numbers, and a dependency would cost more than it saves.
 */
export default function VolumeProfilePanel({
  profile,
  spot,
  strikes,
  lookback,
  onLookbackChange,
}: {
  profile: VolumeProfile | null
  spot: number
  /** Break-even prices of the currently qualifying contracts. */
  strikes: number[]
  lookback: number
  onLookbackChange: (sessions: number) => void
}) {
  if (!profile) {
    return (
      <div className="card p-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Not enough price history to build a volume profile.
      </div>
    )
  }

  const maxShare = Math.max(...profile.buckets.map((b) => b.share))
  // Drawn high price at top, matching how every chart shows it.
  const ordered = [...profile.buckets].reverse()
  const priceToPct = (p: number) =>
    ((profile.high - p) / (profile.high - profile.low)) * 100

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-sm font-semibold">Where the volume traded</h2>
        <div className="flex gap-1">
          {LOOKBACKS.map((l) => (
            <button
              key={l.sessions}
              onClick={() => onLookbackChange(l.sessions)}
              className="rounded-md px-2 py-1 text-[11px] border transition-colors"
              style={{
                borderColor: lookback === l.sessions ? 'var(--accent)' : 'var(--border)',
                color: lookback === l.sessions ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Heaviest traded price is {usd(profile.poc)}; 70% of volume changed hands between{' '}
        {usd(profile.valueAreaLow)} and {usd(profile.valueAreaHigh)}. The lookback matters — a
        shorter window weights recent trading more heavily.
      </p>

      <div className="relative" style={{ height: 260 }}>
        {/* Value area band */}
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            top: `${priceToPct(profile.valueAreaHigh)}%`,
            height: `${priceToPct(profile.valueAreaLow) - priceToPct(profile.valueAreaHigh)}%`,
            background: 'rgba(245,245,240,0.04)',
          }}
        />

        {/* Histogram */}
        <div className="absolute inset-0 flex flex-col">
          {ordered.map((b, i) => {
            const isPoc = Math.abs(b.price - profile.poc) < 1e-9
            return (
              <div key={i} className="flex-1 flex items-center" title={`${usd(b.price)} — ${(b.share * 100).toFixed(1)}% of volume`}>
                <div
                  style={{
                    width: `${(b.share / maxShare) * 100}%`,
                    height: '100%',
                    background: isPoc ? 'var(--accent)' : 'rgba(245,245,240,0.18)',
                    minWidth: b.share > 0 ? 1 : 0,
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Spot */}
        <Level price={spot} profile={profile} color="var(--text)" label={`spot ${usd(spot)}`} />

        {/* Break-evens of qualifying contracts — the confluence read. */}
        {strikes.map((s) => (
          <Level key={s} price={s} profile={profile} color="var(--tier-mid)" dashed />
        ))}
      </div>

      <div className="flex items-center gap-4 mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        <Legend color="var(--accent)" text="heaviest traded" />
        <Legend color="var(--text)" text="spot" />
        <Legend color="var(--tier-mid)" text="your break-evens" />
        <span className="ml-auto nums">{profile.sessions} sessions</span>
      </div>
    </div>
  )
}

function Level({
  price,
  profile,
  color,
  label,
  dashed,
}: {
  price: number
  profile: VolumeProfile
  color: string
  label?: string
  dashed?: boolean
}) {
  if (price < profile.low || price > profile.high) return null
  const top = ((profile.high - price) / (profile.high - profile.low)) * 100

  return (
    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: `${top}%` }}>
      <div
        style={{
          borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${color}`,
          opacity: dashed ? 0.55 : 1,
        }}
      />
      {label && (
        <span
          className="absolute right-0 -top-4 text-[10px] nums px-1"
          style={{ color, background: 'var(--bg-raised)' }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span style={{ width: 10, height: 2, background: color, display: 'inline-block' }} />
      {text}
    </span>
  )
}
