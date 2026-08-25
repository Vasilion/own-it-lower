'use client'

import { Fragment, useMemo, useState } from 'react'

import { explainContract } from '@/lib/engine/explain'
import { rankPuts, tallyExclusions } from '@/lib/engine/fit'
import { makePreset, type AssignmentStance, type StrategyPreset } from '@/lib/engine/types'
import type { AnalysisPayload } from '@/lib/server/analyze'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
const usd = (v: number) => `$${v.toFixed(2)}`
const money = (v: number) => `$${Math.round(v).toLocaleString()}`

/**
 * Colour tier for the fit score.
 *
 * The score renders as a NUMBER plus a colour, never as a word. A label like
 * "Strong" sitting in a table row reads as an instruction to act, which is exactly
 * what this tool must not do -- so the wording lives in a hover tooltip where it
 * describes the number rather than commanding the reader.
 */
function tier(score: number): { color: string; label: string } {
  if (score >= 70) return { color: 'var(--tier-high)', label: 'Fits your settings closely' }
  if (score >= 50) return { color: 'var(--tier-mid)', label: 'Fits your settings partially' }
  if (score >= 30) return { color: 'var(--tier-low)', label: 'Weak fit to your settings' }
  return { color: 'var(--tier-none)', label: 'Poor fit to your settings' }
}

const STANCES: Array<{ value: AssignmentStance; title: string; blurb: string }> = [
  { value: 'want', title: 'Happy to own it', blurb: 'Weights entry price and cost basis most heavily' },
  { value: 'neutral', title: 'Either way', blurb: 'Balances entry price against premium' },
  { value: 'avoid', title: 'Premium only', blurb: 'Weights probability of expiring worthless most heavily' },
]

type SortKey =
  | 'fitScore'
  | 'strike'
  | 'dte'
  | 'delta'
  | 'premium'
  | 'annualizedReturn'
  | 'downsideBuffer'
  | 'effectiveCostBasis'
  | 'openInterest'
  | 'spreadPct'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; hint?: string }> = [
  { key: 'fitScore', label: 'Fit', hint: 'How closely this contract matches the settings you chose' },
  { key: 'strike', label: 'Strike', align: 'right' },
  { key: 'dte', label: 'Days', align: 'right' },
  { key: 'delta', label: 'Delta', align: 'right', hint: 'Roughly the chance of being assigned' },
  { key: 'premium', label: 'Credit', align: 'right', hint: 'Per share, using the bid — what a seller actually receives' },
  { key: 'annualizedReturn', label: 'Annualised', align: 'right', hint: 'Return on collateral if it expires worthless, scaled to a year' },
  { key: 'downsideBuffer', label: 'Buffer', align: 'right', hint: 'How far the stock can fall before break-even' },
  { key: 'effectiveCostBasis', label: 'If assigned', align: 'right', hint: 'Your cost per share if the shares are put to you' },
  { key: 'openInterest', label: 'OI', align: 'right' },
  { key: 'spreadPct', label: 'Spread', align: 'right' },
]

export default function Screen({ data }: { data: AnalysisPayload }) {
  const [stance, setStance] = useState<AssignmentStance>('neutral')
  const [capital, setCapital] = useState(25_000)
  const [maxPositionPct, setMaxPositionPct] = useState(0.5)
  const [minDte, setMinDte] = useState(21)
  const [maxDte, setMaxDte] = useState(49)
  const [avoidEarnings, setAvoidEarnings] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'fitScore', dir: 'desc' })
  const [expanded, setExpanded] = useState<string | null>(null)

  const preset: StrategyPreset = useMemo(
    () =>
      makePreset({
        capital,
        maxPositionPct,
        assignmentStance: stance,
        minDte,
        maxDte,
        earningsPolicy: avoidEarnings ? 'avoid' : 'allow',
      }),
    [capital, maxPositionPct, stance, minDte, maxDte, avoidEarnings],
  )

  // Ranking runs in the browser. The engine is pure TypeScript with no network or
  // framework dependency, so every settings change re-ranks instantly rather than
  // costing a server round trip.
  const { ranked, excluded, capitalShortfall } = useMemo(() => {
    const all = rankPuts({
      symbol: data.symbol,
      puts: data.puts,
      dteByExpiry: new Map(Object.entries(data.dte)),
      context: data.context,
      preset,
      riskFreeRate: data.riskFreeRate,
      includeExcluded: true,
    })

    // A first-failure tally can bury the real blocker. On an expensive stock most
    // contracts trip the delta gate first, so "delta above range" tops the list
    // while position size is what actually makes the symbol unusable at this
    // account size. Detect that case specifically and offer the fix.
    const capitalOnly = all.filter(
      (r) => r.exclusions.length > 0 && r.exclusions.every((e) => e.includes('collateral')),
    )

    return {
      ranked: all.filter((r) => r.exclusions.length === 0),
      excluded: tallyExclusions(all),
      capitalShortfall:
        capitalOnly.length > 0
          ? {
              count: capitalOnly.length,
              cheapest: Math.min(...capitalOnly.map((r) => r.metrics.collateral)),
            }
          : null,
    }
  }, [data, preset])

  const sorted = useMemo(() => {
    const rows = [...ranked]
    rows.sort((a, b) => {
      const av = sort.key === 'fitScore' ? a.fitScore : (a.metrics[sort.key] as number)
      const bv = sort.key === 'fitScore' ? b.fitScore : (b.metrics[sort.key] as number)
      return sort.dir === 'desc' ? bv - av : av - bv
    })
    return rows
  }, [ranked, sort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr] items-start">
      {/* ---------------- Settings ---------------- */}
      <aside className="card p-5 md:p-6 lg:sticky lg:top-6">
        <h2 className="text-sm font-semibold mb-1">Screen settings</h2>
        <p className="text-xs mb-5" style={{ color: 'var(--text-faint)' }}>
          These are filter parameters, not a risk profile. Nothing here is stored.
        </p>

        <fieldset className="mb-5">
          <legend className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            If you were assigned the shares
          </legend>
          <div className="flex flex-col gap-1.5">
            {STANCES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStance(s.value)}
                className="text-left rounded-lg px-3 py-2 border transition-colors"
                style={{
                  borderColor: stance === s.value ? 'var(--accent)' : 'var(--border)',
                  background: stance === s.value ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <div className="text-[13px] font-medium">{s.title}</div>
                <div className="text-[11px] leading-snug" style={{ color: 'var(--text-faint)' }}>
                  {s.blurb}
                </div>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block mb-4">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Capital available
          </span>
          <input
            type="number"
            value={capital}
            min={1000}
            step={1000}
            onChange={(e) => setCapital(Math.max(1000, Number(e.target.value) || 0))}
            className="mt-1 w-full rounded-lg border px-3 py-1.5 text-sm nums bg-transparent"
            style={{ borderColor: 'var(--border)' }}
          />
        </label>

        <label className="block mb-4">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Max per position — {pct(maxPositionPct, 0)} ({money(capital * maxPositionPct)})
          </span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={maxPositionPct * 100}
            onChange={(e) => setMaxPositionPct(Number(e.target.value) / 100)}
            className="mt-2 w-full"
          />
        </label>

        <div className="mb-4">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Days to expiry — {minDte} to {maxDte}
          </span>
          <div className="flex gap-2 mt-1">
            <input
              type="number"
              value={minDte}
              min={7}
              max={maxDte}
              onChange={(e) => setMinDte(Math.min(Number(e.target.value) || 7, maxDte))}
              className="w-full rounded-lg border px-3 py-1.5 text-sm nums bg-transparent"
              style={{ borderColor: 'var(--border)' }}
            />
            <input
              type="number"
              value={maxDte}
              min={minDte}
              max={90}
              onChange={(e) => setMaxDte(Math.max(Number(e.target.value) || 90, minDte))}
              className="w-full rounded-lg border px-3 py-1.5 text-sm nums bg-transparent"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={avoidEarnings}
            onChange={(e) => setAvoidEarnings(e.target.checked)}
          />
          Exclude expiries after earnings
        </label>

        <div className="mt-5 pt-4 border-t hairline text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Delta band for this stance: {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)}
        </div>
      </aside>

      {/* ---------------- Results ---------------- */}
      <section>
        <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            <span className="font-medium" style={{ color: 'var(--text)' }}>
              {ranked.length}
            </span>{' '}
            {ranked.length === 1 ? 'contract matches' : 'contracts match'} your settings, ranked by
            fit
          </p>
          {excluded.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Excluded: {excluded.slice(0, 3).map((e) => `${e.count} ${e.reason}`).join(' · ')}
            </p>
          )}
        </div>

        {ranked.length === 0 ? (
          <EmptyState
            excluded={excluded}
            preset={preset}
            capitalShortfall={capitalShortfall}
            onRaiseCapital={(amount) => setCapital(amount)}
          />
        ) : (
          <div className="card table-scroll">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      data-sortable
                      onClick={() => toggleSort(c.key)}
                      title={c.hint}
                      className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                        c.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                      style={{ color: sort.key === c.key ? 'var(--text)' : 'var(--text-muted)' }}
                    >
                      {c.label}
                      <span className="ml-1 text-[10px]">
                        {sort.key === c.key ? (sort.dir === 'desc' ? '▼' : '▲') : ''}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const m = r.metrics
                  const id = `${m.strike}-${m.expiry}`
                  const t = tier(r.fitScore)
                  const isOpen = expanded === id
                  const toggle = () => setExpanded(isOpen ? null : id)

                  return (
                    <Fragment key={id}>
                      <tr
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggle()
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isOpen}
                        className="border-b hairline cursor-pointer"
                        style={{ background: isOpen ? 'var(--bg-sunken)' : undefined }}
                      >
                        <td className="px-3 py-2.5">
                          <span
                            className="nums font-semibold text-[15px]"
                            style={{ color: t.color }}
                            title={t.label}
                          >
                            {Math.round(r.fitScore)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right nums">{usd(m.strike)}</td>
                        <td className="px-3 py-2.5 text-right nums">{m.dte}</td>
                        <td className="px-3 py-2.5 text-right nums">{m.delta.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right nums">{usd(m.premium)}</td>
                        <td className="px-3 py-2.5 text-right nums font-medium">
                          {pct(m.annualizedReturn)}
                        </td>
                        <td className="px-3 py-2.5 text-right nums">{pct(m.downsideBuffer)}</td>
                        <td className="px-3 py-2.5 text-right nums">{usd(m.effectiveCostBasis)}</td>
                        <td className="px-3 py-2.5 text-right nums" style={{ color: 'var(--text-muted)' }}>
                          {m.openInterest.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right nums" style={{ color: 'var(--text-muted)' }}>
                          {pct(m.spreadPct)}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-b hairline">
                          <td colSpan={COLUMNS.length} className="px-3 pb-4 pt-1" style={{ background: 'var(--bg-sunken)' }}>
                            <p className="text-[13px] leading-relaxed mb-4 max-w-3xl">
                              {explainContract(m, data.context, preset)}
                            </p>
                            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 max-w-3xl">
                              {r.components.map((c) => (
                                <div key={c.key} className="flex items-baseline gap-2 text-xs">
                                  <span className="w-16 shrink-0" style={{ color: 'var(--text-muted)' }}>
                                    {c.label}
                                  </span>
                                  <span className="nums w-7 shrink-0 text-right">
                                    {c.score === null ? '—' : Math.round(c.score)}
                                  </span>
                                  <span
                                    className="h-1 rounded-full shrink-0 overflow-hidden"
                                    style={{ width: 44, background: 'var(--border)' }}
                                  >
                                    <span
                                      className="block h-1 rounded-full"
                                      style={{
                                        width: `${c.score ?? 0}%`,
                                        background: c.score === null ? 'transparent' : 'var(--accent)',
                                      }}
                                    />
                                  </span>
                                  <span style={{ color: 'var(--text-faint)' }}>{c.detail}</span>
                                </div>
                              ))}
                            </div>
                            {r.abstainedWeight > 0 && (
                              <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                                {pct(r.abstainedWeight, 0)} of the scoring weight abstained because
                                those inputs were unavailable. The score is computed across the rest.
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Credit uses the bid, not the mid — that is what a seller actually receives. Click any row
          for the full arithmetic.
        </p>
      </section>
    </div>
  )
}

function EmptyState({
  excluded,
  preset,
  capitalShortfall,
  onRaiseCapital,
}: {
  excluded: Array<{ reason: string; count: number }>
  preset: StrategyPreset
  capitalShortfall: { count: number; cheapest: number } | null
  onRaiseCapital: (amount: number) => void
}) {
  // Round up to a tidy figure so the button does not offer "$38,110".
  const needed = capitalShortfall
    ? Math.ceil(capitalShortfall.cheapest / preset.maxPositionPct / 1000) * 1000
    : 0

  return (
    <div className="card p-6">
      <p className="text-sm font-medium mb-1">Nothing matches these settings right now.</p>
      <p className="text-[13px] mb-4" style={{ color: 'var(--text-muted)' }}>
        That is a result, not an error. Here is what ruled the contracts out:
      </p>
      <ul className="space-y-1 text-[13px]">
        {excluded.slice(0, 5).map((e) => (
          <li key={e.reason} className="flex gap-3">
            <span className="nums w-10 text-right" style={{ color: 'var(--text-muted)' }}>
              {e.count}
            </span>
            <span>{e.reason}</span>
          </li>
        ))}
      </ul>

      {capitalShortfall && (
        <div
          className="mt-5 rounded-lg border px-4 py-3"
          style={{ background: 'var(--bg-sunken)', borderColor: 'var(--border)' }}
        >
          <p className="text-[13px] leading-relaxed">
            <span className="font-medium">
              {capitalShortfall.count}{' '}
              {capitalShortfall.count === 1 ? 'contract fits' : 'contracts fit'} every setting except
              position size.
            </span>{' '}
            The cheapest ties up {money(capitalShortfall.cheapest)}, which at a{' '}
            {pct(preset.maxPositionPct, 0)} cap needs about {money(needed)} of capital.
          </p>
          <button
            onClick={() => onRaiseCapital(needed)}
            className="mt-3 rounded-lg px-3 py-1.5 text-[13px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--bg-raised)' }}
          >
            Set capital to {money(needed)}
          </button>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: 'var(--text-faint)' }}>
        Your current delta band is {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)} and the
        per-position cap is {money(preset.capital * preset.maxPositionPct)}. Widening either usually
        opens things up.
      </p>
    </div>
  )
}
