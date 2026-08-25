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

const MOBILE_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'fitScore', label: 'Fit score' },
  { key: 'annualizedReturn', label: 'Annualised return' },
  { key: 'downsideBuffer', label: 'Downside buffer' },
  { key: 'delta', label: 'Delta' },
  { key: 'strike', label: 'Strike' },
  { key: 'dte', label: 'Days to expiry' },
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
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const activeStance = STANCES.find((s) => s.value === stance)!

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr] items-start">
      {/* ---------------- Settings ---------------- */}
      <aside className="card lg:sticky lg:top-20">
        {/*
          Collapsed by default on mobile. The results are what the user came for;
          making them scroll past a full settings form to reach the table would
          bury the product behind its own configuration.
        */}
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className="lg:hidden w-full flex items-center justify-between px-4 py-3 text-[13px]"
          aria-expanded={settingsOpen}
        >
          <span>
            <span className="font-medium">{activeStance.title}</span>
            <span className="nums ml-2" style={{ color: 'var(--text-faint)' }}>
              {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)}Δ · {money(capital)}
            </span>
          </span>
          <span style={{ color: 'var(--text-faint)' }}>{settingsOpen ? '▲' : 'Edit ▼'}</span>
        </button>

        <div className={`${settingsOpen ? 'block' : 'hidden'} lg:block p-4 sm:p-5 lg:pt-5 pt-0`}>
          <h2 className="text-sm font-semibold mb-1 hidden lg:block">Screen settings</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
            Filter parameters, not a risk profile. Nothing here is stored.
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
                  className="text-left rounded-lg px-3 py-2.5 border transition-colors"
                  style={{
                    borderColor: stance === s.value ? 'var(--accent)' : 'var(--border)',
                    background: stance === s.value ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <div className="text-[13px] font-medium">{s.title}</div>
                  <div className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-faint)' }}>
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
              inputMode="numeric"
              onChange={(e) => setCapital(Math.max(1000, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
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
                inputMode="numeric"
                onChange={(e) => setMinDte(Math.min(Number(e.target.value) || 7, maxDte))}
                className="w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
                style={{ borderColor: 'var(--border)' }}
              />
              <input
                type="number"
                value={maxDte}
                min={minDte}
                max={90}
                inputMode="numeric"
                onChange={(e) => setMaxDte(Math.max(Number(e.target.value) || 90, minDte))}
                className="w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={avoidEarnings}
              onChange={(e) => setAvoidEarnings(e.target.checked)}
            />
            Exclude expiries after earnings
          </label>

          <label className="flex items-center justify-between gap-2 mt-4 lg:hidden text-[13px]">
            <span style={{ color: 'var(--text-muted)' }}>Sort by</span>
            <select
              value={sort.key}
              onChange={(e) => setSort({ key: e.target.value as SortKey, dir: 'desc' })}
              className="rounded-lg border px-2 py-1.5 bg-transparent"
              style={{ borderColor: 'var(--border)' }}
            >
              {MOBILE_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 pt-4 border-t hairline text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Delta band for this stance: {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)}
          </div>
        </div>
      </aside>

      {/* ---------------- Results ---------------- */}
      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            <span className="font-medium" style={{ color: 'var(--text)' }}>
              {ranked.length}
            </span>{' '}
            {ranked.length === 1 ? 'contract matches' : 'contracts match'} your settings, ranked by
            fit
          </p>
          {excluded.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Excluded: {excluded.slice(0, 2).map((e) => `${e.count} ${e.reason}`).join(' · ')}
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
          <>
            {/* ---------- Mobile: cards ---------- */}
            <ul className="md:hidden space-y-2">
              {sorted.map((r) => {
                const m = r.metrics
                const id = `${m.strike}-${m.expiry}`
                const t = tier(r.fitScore)
                const isOpen = expanded === id
                return (
                  <li key={id} className="card overflow-hidden">
                    <button
                      onClick={() => setExpanded(isOpen ? null : id)}
                      className="w-full text-left p-4"
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[15px] nums">{usd(m.strike)} put</div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                            {m.expiry} · {m.dte}d · {m.delta.toFixed(2)}Δ
                            {m.earningsBeforeExpiry ? ' · earnings' : ''}
                          </div>
                        </div>
                        <span
                          className="nums font-semibold text-2xl leading-none shrink-0"
                          style={{ color: t.color }}
                        >
                          {Math.round(r.fitScore)}
                        </span>
                      </div>

                      <dl className="grid grid-cols-4 gap-2 mt-3 text-center">
                        <MStat label="Credit" value={usd(m.premium)} />
                        <MStat label="Annual" value={pct(m.annualizedReturn)} emphasis />
                        <MStat label="Buffer" value={pct(m.downsideBuffer)} />
                        <MStat label="Basis" value={usd(m.effectiveCostBasis)} />
                      </dl>

                      <div className="text-[11px] mt-3" style={{ color: 'var(--accent)' }}>
                        {isOpen ? 'Hide detail ▲' : 'Show the maths ▼'}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4" style={{ background: 'var(--bg-sunken)' }}>
                        <p className="text-[13px] leading-relaxed pt-3 mb-4">
                          {explainContract(m, data.context, preset)}
                        </p>
                        <Breakdown components={r.components} abstained={r.abstainedWeight} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* ---------- Desktop: table ---------- */}
            <div className="card table-scroll hidden md:block">
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
                            <td
                              colSpan={COLUMNS.length}
                              className="px-3 pb-4 pt-1"
                              style={{ background: 'var(--bg-sunken)' }}
                            >
                              <p className="text-[13px] leading-relaxed mb-4 max-w-3xl">
                                {explainContract(m, data.context, preset)}
                              </p>
                              <Breakdown components={r.components} abstained={r.abstainedWeight} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          Credit uses the bid, not the mid — that is what a seller actually receives. Tap any
          contract for the full arithmetic.
        </p>
      </section>
    </div>
  )
}

function MStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </dt>
      <dd className={`nums text-[13px] mt-0.5 ${emphasis ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  )
}

function Breakdown({
  components,
  abstained,
}: {
  components: Array<{ key: string; label: string; score: number | null; detail: string }>
  abstained: number
}) {
  return (
    <>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 max-w-3xl">
        {components.map((c) => (
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
            <span className="min-w-0" style={{ color: 'var(--text-faint)' }}>
              {c.detail}
            </span>
          </div>
        ))}
      </div>
      {abstained > 0 && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {pct(abstained, 0)} of the scoring weight abstained because those inputs were
          unavailable. The score is computed across the rest.
        </p>
      )}
    </>
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
    <div className="card p-5 sm:p-6">
      <p className="text-sm font-medium mb-1">Nothing matches these settings right now.</p>
      <p className="text-[13px] mb-4" style={{ color: 'var(--text-muted)' }}>
        That is a result, not an error. Here is what ruled the contracts out:
      </p>
      <ul className="space-y-1 text-[13px]">
        {excluded.slice(0, 5).map((e) => (
          <li key={e.reason} className="flex gap-3">
            <span className="nums w-10 text-right shrink-0" style={{ color: 'var(--text-muted)' }}>
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
            className="mt-3 w-full sm:w-auto rounded-lg px-4 py-2 text-[13px] font-medium"
            style={{ background: 'var(--accent)', color: '#050507' }}
          >
            Set capital to {money(needed)}
          </button>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Your current delta band is {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)} and the
        per-position cap is {money(preset.capital * preset.maxPositionPct)}. Widening either usually
        opens things up.
      </p>
    </div>
  )
}
