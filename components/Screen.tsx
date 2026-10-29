'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'

import GlossaryList from '@/components/GlossaryList'
import Term from '@/components/Term'
import { KEYS, readLocal, writeLocal } from '@/lib/client/local'
import { explainContract } from '@/lib/engine/explain'
import { rankPuts, soleBlockers, tallyExclusions } from '@/lib/engine/fit'
import { makePreset, type AssignmentStance, type FitResult, type StrategyPreset } from '@/lib/engine/types'
import { computeVolumeProfile } from '@/lib/engine/volume-profile'
import VolumeProfilePanel from '@/components/VolumeProfilePanel'
import type { GlossaryKey } from '@/lib/glossary'
import type { AnalysisPayload } from '@/lib/server/analyze'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
const usd = (v: number) => `$${v.toFixed(2)}`
const money = (v: number) => `$${Math.round(v).toLocaleString()}`

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** What the settings panel remembers between tickers, in this browser only. */
interface SavedSettings {
  stance: AssignmentStance
  capital: number
  maxPositionPct: number
  minDte: number
  maxDte: number
  avoidEarnings: boolean
  minIv: number
  maxIv: number
  lookback: number
}

const DEFAULTS: SavedSettings = {
  stance: 'neutral',
  // 0 means "no limit". A default figure here previously excluded every contract
  // on any stock above roughly $125, so most symbols opened on an empty screen.
  capital: 0,
  maxPositionPct: 0.5,
  minDte: 21,
  maxDte: 49,
  avoidEarnings: false,
  minIv: 0,
  maxIv: 0,
  // 252 sessions is one year; shorter windows weight recent trading more heavily.
  lookback: 252,
}

/** Stored values are untrusted: a hand-edited or older shape falls back per field. */
function sanitize(raw: Partial<SavedSettings> | null): SavedSettings {
  if (!raw || typeof raw !== 'object') return DEFAULTS
  const n = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d
  const minDte = n(raw.minDte, 7, 90, DEFAULTS.minDte)
  return {
    stance: raw.stance === 'want' || raw.stance === 'avoid' || raw.stance === 'neutral' ? raw.stance : DEFAULTS.stance,
    capital: n(raw.capital, 0, 1e9, DEFAULTS.capital),
    maxPositionPct: n(raw.maxPositionPct, 0.1, 1, DEFAULTS.maxPositionPct),
    minDte,
    maxDte: Math.max(minDte, n(raw.maxDte, 7, 90, DEFAULTS.maxDte)),
    avoidEarnings: typeof raw.avoidEarnings === 'boolean' ? raw.avoidEarnings : DEFAULTS.avoidEarnings,
    minIv: n(raw.minIv, 0, 500, DEFAULTS.minIv),
    maxIv: n(raw.maxIv, 0, 500, DEFAULTS.maxIv),
    lookback: [60, 130, 252].includes(raw.lookback as number) ? (raw.lookback as number) : DEFAULTS.lookback,
  }
}

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
  | 'impliedVolatility'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; term: GlossaryKey }> = [
  { key: 'fitScore', label: 'Fit', term: 'fit' },
  { key: 'strike', label: 'Strike', align: 'right', term: 'strike' },
  { key: 'dte', label: 'Days', align: 'right', term: 'dte' },
  { key: 'delta', label: 'Delta', align: 'right', term: 'delta' },
  { key: 'premium', label: 'Credit', align: 'right', term: 'credit' },
  { key: 'annualizedReturn', label: 'Annualised', align: 'right', term: 'annualised' },
  { key: 'downsideBuffer', label: 'Buffer', align: 'right', term: 'buffer' },
  { key: 'effectiveCostBasis', label: 'If assigned', align: 'right', term: 'ifAssigned' },
  { key: 'impliedVolatility', label: 'IV', align: 'right', term: 'iv' },
  { key: 'openInterest', label: 'OI', align: 'right', term: 'oi' },
  { key: 'spreadPct', label: 'Spread', align: 'right', term: 'spread' },
]

const MOBILE_TERMS: Array<{ k: GlossaryKey; label: string }> = [
  { k: 'fit', label: 'Fit (the big number)' },
  { k: 'delta', label: 'Delta (Δ)' },
  { k: 'credit', label: 'Credit' },
  { k: 'annualised', label: 'Annual' },
  { k: 'buffer', label: 'Buffer' },
  { k: 'ifAssigned', label: 'Basis' },
  { k: 'iv', label: 'IV' },
]

const MOBILE_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'fitScore', label: 'Fit score' },
  { key: 'annualizedReturn', label: 'Annualised return' },
  { key: 'downsideBuffer', label: 'Downside buffer' },
  { key: 'delta', label: 'Delta' },
  { key: 'impliedVolatility', label: 'Implied volatility' },
  { key: 'strike', label: 'Strike' },
  { key: 'dte', label: 'Days to expiry' },
]

export default function Screen({ data }: { data: AnalysisPayload }) {
  const [stance, setStance] = useState<AssignmentStance>(DEFAULTS.stance)
  const [capital, setCapital] = useState(DEFAULTS.capital)
  const [maxPositionPct, setMaxPositionPct] = useState(DEFAULTS.maxPositionPct)
  const [minDte, setMinDte] = useState(DEFAULTS.minDte)
  const [maxDte, setMaxDte] = useState(DEFAULTS.maxDte)
  const [avoidEarnings, setAvoidEarnings] = useState(DEFAULTS.avoidEarnings)
  const [minIv, setMinIv] = useState(DEFAULTS.minIv)
  const [maxIv, setMaxIv] = useState(DEFAULTS.maxIv)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'fitScore', dir: 'desc' })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lookback, setLookback] = useState(DEFAULTS.lookback)

  /*
   * Settings carry over from ticker to ticker. Before this, every symbol opened on
   * defaults, so comparing two names meant re-entering stance and capital each time.
   * Loaded after mount so the server render and first client render still agree;
   * nothing is written until the stored value has been read.
   */
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    apply(sanitize(readLocal<Partial<SavedSettings> | null>(KEYS.settings, null)))
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    writeLocal<SavedSettings>(KEYS.settings, {
      stance, capital, maxPositionPct, minDte, maxDte, avoidEarnings, minIv, maxIv, lookback,
    })
  }, [loaded, stance, capital, maxPositionPct, minDte, maxDte, avoidEarnings, minIv, maxIv, lookback])

  function apply(v: SavedSettings) {
    setStance(v.stance)
    setCapital(v.capital)
    setMaxPositionPct(v.maxPositionPct)
    setMinDte(v.minDte)
    setMaxDte(v.maxDte)
    setAvoidEarnings(v.avoidEarnings)
    setMinIv(v.minIv)
    setMaxIv(v.maxIv)
    setLookback(v.lookback)
  }

  const isDefault =
    stance === DEFAULTS.stance && capital === DEFAULTS.capital && maxPositionPct === DEFAULTS.maxPositionPct &&
    minDte === DEFAULTS.minDte && maxDte === DEFAULTS.maxDte && avoidEarnings === DEFAULTS.avoidEarnings &&
    minIv === DEFAULTS.minIv && maxIv === DEFAULTS.maxIv

  const preset: StrategyPreset = useMemo(
    () =>
      makePreset({
        capital,
        maxPositionPct,
        assignmentStance: stance,
        minDte,
        maxDte,
        earningsPolicy: avoidEarnings ? 'avoid' : 'allow',
        minIv: minIv / 100,
        maxIv: maxIv / 100,
      }),
    [capital, maxPositionPct, stance, minDte, maxDte, avoidEarnings, minIv, maxIv],
  )

  // Recomputed here rather than server-side so changing the lookback is instant.
  const volumeProfile = useMemo(
    () => computeVolumeProfile(data.bars, lookback),
    [data.bars, lookback],
  )

  const context = useMemo(
    () => ({ ...data.context, volumeProfile: volumeProfile ?? undefined }),
    [data.context, volumeProfile],
  )

  // Ranking runs in the browser. The engine is pure TypeScript with no network or
  // framework dependency, so every settings change re-ranks instantly rather than
  // costing a server round trip.
  const { ranked, excluded, blockers } = useMemo(() => {
    const all = rankPuts({
      symbol: data.symbol,
      puts: data.puts,
      dteByExpiry: new Map(Object.entries(data.dte)),
      context,
      preset,
      riskFreeRate: data.riskFreeRate,
      includeExcluded: true,
    })

    // A first-failure tally buries the actionable answer, so also find the
    // contracts blocked by exactly one setting the user can flip.
    const blockers = soleBlockers(all)

    return {
      ranked: all.filter((r) => r.exclusions.length === 0),
      excluded: tallyExclusions(all),
      blockers: {
        capitalCount: blockers.capital.length,
        cheapestCollateral: blockers.capital.length
          ? Math.min(...blockers.capital.map((r) => r.metrics.collateral))
          : 0,
        earnings: blockers.earnings,
        iv: blockers.iv,
      },
    }
  }, [data, preset, context])

  const sorted = useMemo(() => {
    const rows = [...ranked]
    rows.sort((a, b) => {
      const pick = (r: (typeof rows)[number]) =>
        sort.key === 'fitScore' ? r.fitScore : (r.metrics[sort.key] as number | null)
      const av = pick(a)
      const bv = pick(b)
      // IV can be null; a missing value is not a low one, so it sorts last either way.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
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
              {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)}Δ
              {capital > 0 ? ` · ${money(capital)}` : ''}
              {minIv > 0 || maxIv > 0 ? ` · IV ${minIv || 0}-${maxIv || '∞'}%` : ''}
            </span>
          </span>
          <span style={{ color: 'var(--text-faint)' }}>{settingsOpen ? '▲' : 'Edit ▼'}</span>
        </button>

        <div className={`${settingsOpen ? 'block' : 'hidden'} lg:block p-4 sm:p-5 lg:pt-5 pt-0`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold mb-1 hidden lg:block">Screen settings</h2>
            {!isDefault && (
              <button
                type="button"
                onClick={() => apply({ ...DEFAULTS, lookback })}
                className="text-[11px] underline underline-offset-2 ml-auto"
                style={{ color: 'var(--text-faint)' }}
              >
                Reset
              </button>
            )}
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
            Filter settings, not a risk profile. Remembered in this browser so they carry over to the
            next ticker. Nothing is sent anywhere.
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
              Capital available <span style={{ color: 'var(--text-faint)' }}>— optional</span>
            </span>
            <input
              type="number"
              value={capital || ''}
              placeholder="No limit"
              min={0}
              step={1000}
              inputMode="numeric"
              onChange={(e) => setCapital(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
              style={{ borderColor: 'var(--border)' }}
            />
            <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-faint)' }}>
              Leave blank to see every contract regardless of collateral.
            </span>
          </label>

          {capital > 0 && (
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
          )}

          <div className="mb-4">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Implied volatility <span style={{ color: 'var(--text-faint)' }}>— optional, %</span>
            </span>
            <div className="flex gap-2 mt-1 items-center">
              <input
                type="number"
                value={minIv || ''}
                placeholder="min"
                min={0}
                max={500}
                inputMode="numeric"
                onChange={(e) => setMinIv(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
                style={{ borderColor: 'var(--border)' }}
              />
              <span style={{ color: 'var(--text-faint)' }}>–</span>
              <input
                type="number"
                value={maxIv || ''}
                placeholder="max"
                min={0}
                max={500}
                inputMode="numeric"
                onChange={(e) => setMaxIv(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border px-3 py-2 text-sm nums bg-transparent"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-faint)' }}>
              A ceiling matters as much as a floor — IV far above normal usually
              means an event is priced in.
            </span>
          </div>

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
      <section className="min-w-0">
        {ranked.length > 0 && (
          <TopFit
            r={ranked[0]}
            symbol={data.symbol}
            spot={data.spot}
            sma200={data.context.sma200 ?? null}
            onShowMaths={() => {
              const m = ranked[0].metrics
              const id = `${m.strike}-${m.expiry}`
              setSort({ key: 'fitScore', dir: 'desc' })
              setExpanded(id)
              requestAnimationFrame(() =>
                document.getElementById('contracts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              )
            }}
          />
        )}

        <div id="contracts" className="scroll-mt-28" />
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
            blockers={blockers}
            onRaiseCapital={setCapital}
            onAllowEarnings={() => setAvoidEarnings(false)}
            onClearIv={() => {
              setMinIv(0)
              setMaxIv(0)
            }}
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
                            {m.impliedVolatility !== null ? ` · ${pct(m.impliedVolatility, 0)} IV` : ''}
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
                          {explainContract(m, context, preset)}
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
                        className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                          c.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                        style={{ color: sort.key === c.key ? 'var(--text)' : 'var(--text-muted)' }}
                      >
                        <Term k={c.term}>{c.label}</Term>
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
                          <td className="px-3 py-2.5 text-right nums">
                            {m.impliedVolatility === null ? '—' : pct(m.impliedVolatility, 0)}
                          </td>
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
                                {explainContract(m, context, preset)}
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

        <GlossaryList items={MOBILE_TERMS} className="md:hidden mt-4" />

        <div className="mt-6">
          <VolumeProfilePanel
            profile={volumeProfile}
            spot={data.spot}
            strikes={ranked.slice(0, 8).map((r) => r.metrics.breakeven)}
            lookback={lookback}
            onLookbackChange={setLookback}
          />
        </div>
      </section>
    </div>
  )
}

/**
 * The answer first: the contract at the top of the ranking, with both outcomes in
 * plain words.
 *
 * Worded as "closest to your settings", never "best": the ranking is a match to
 * filters the user chose, and the card must read as arithmetic, not a pick. The
 * two outcomes are the question a first-time put seller actually has, and every
 * figure in them is the same one the table shows.
 */
function TopFit({
  r,
  symbol,
  spot,
  sma200,
  onShowMaths,
}: {
  r: FitResult
  symbol: string
  spot: number
  sma200: number | null
  onShowMaths: () => void
}) {
  const m = r.metrics
  const t = tier(r.fitScore)
  const below = spot > 0 ? (spot - m.effectiveCostBasis) / spot : null
  const vs200 = sma200 ? (m.effectiveCostBasis - sma200) / sma200 : null

  return (
    <div className="card p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--accent-dim)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Closest fit to your settings</p>
          <p className="text-lg sm:text-xl font-semibold nums">
            {usd(m.strike)} put · {formatDate(m.expiry)}
            <span className="text-[13px] font-normal ml-2" style={{ color: 'var(--text-faint)' }}>
              {m.dte} days · {m.delta.toFixed(2)} delta
            </span>
          </p>
        </div>
        <span className="nums font-semibold text-3xl leading-none shrink-0" style={{ color: t.color }} title={t.label}>
          {Math.round(r.fitScore)}
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <MStat label="You collect" value={`${usd(m.premium)}/sh · ${money(m.premium * 100)}`} emphasis />
        <MStat label="Annualised" value={pct(m.annualizedReturn)} />
        <MStat label="Cash set aside" value={money(m.collateral)} />
        <MStat label="If assigned" value={`${usd(m.effectiveCostBasis)}/sh`} />
      </dl>

      <div className="grid gap-2 sm:grid-cols-2 mt-4 text-[13px] leading-relaxed">
        <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-sunken)' }}>
          <span className="font-medium">If {symbol} stays above {usd(m.strike)}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            {' '}on {formatDate(m.expiry)}, the put expires. You keep {money(m.premium * 100)} and the{' '}
            {money(m.collateral)} is free again.
          </span>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-sunken)' }}>
          <span className="font-medium">If it closes below {usd(m.strike)}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            , you buy 100 shares at {usd(m.strike)}. Counting the premium that is {usd(m.effectiveCostBasis)} a
            share{below !== null ? `, ${pct(below)} below today’s ${usd(spot)}` : ''}
            {vs200 !== null ? ` and ${pct(Math.abs(vs200))} ${vs200 <= 0 ? 'below' : 'above'} the 200-day average` : ''}.
          </span>
        </div>
      </div>

      {m.earningsBeforeExpiry === true && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--warn-text)' }}>
          Earnings land before this expiry, so the stock can move sharply while the put is open.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Ranked by fit to the settings you chose. A match to your filters, not a recommendation.
        </p>
        <button
          type="button"
          onClick={onShowMaths}
          className="text-[12px] underline underline-offset-2"
          style={{ color: 'var(--accent)' }}
        >
          Show the maths and every other match
        </button>
      </div>
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
  blockers,
  onRaiseCapital,
  onAllowEarnings,
  onClearIv,
}: {
  excluded: Array<{ reason: string; count: number }>
  preset: StrategyPreset
  blockers: { capitalCount: number; cheapestCollateral: number; earnings: number; iv: number }
  onRaiseCapital: (amount: number) => void
  onAllowEarnings: () => void
  onClearIv: () => void
}) {
  // Round up to a tidy figure so the button does not offer "$38,110".
  const needed = blockers.cheapestCollateral
    ? Math.ceil(blockers.cheapestCollateral / preset.maxPositionPct / 1000) * 1000
    : 0

  const hasFix = blockers.capitalCount > 0 || blockers.earnings > 0 || blockers.iv > 0

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

      {/*
        The list above credits each contract's FIRST failure, which reliably buries
        the useful answer. What the user needs is the contracts that are one
        setting away, and a way to flip that setting.
      */}
      {hasFix && (
        <div
          className="mt-5 rounded-lg border p-4 space-y-3"
          style={{ background: 'var(--bg-sunken)', borderColor: 'var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            One setting away
          </p>

          {blockers.capitalCount > 0 && (
            <Fix
              text={`${blockers.capitalCount} ${blockers.capitalCount === 1 ? 'contract fits' : 'contracts fit'} everything except position size. The cheapest ties up ${money(blockers.cheapestCollateral)}, needing about ${money(needed)} of capital at a ${pct(preset.maxPositionPct, 0)} cap.`}
              action={`Set capital to ${money(needed)}`}
              onClick={() => onRaiseCapital(needed)}
            />
          )}

          {blockers.earnings > 0 && (
            <Fix
              text={`${blockers.earnings} ${blockers.earnings === 1 ? 'contract expires' : 'contracts expire'} after this company reports earnings, and your settings exclude those.`}
              action="Allow expiries after earnings"
              onClick={onAllowEarnings}
            />
          )}

          {blockers.iv > 0 && (
            <Fix
              text={`${blockers.iv} ${blockers.iv === 1 ? 'contract falls' : 'contracts fall'} outside your implied volatility band.`}
              action="Clear the IV filter"
              onClick={onClearIv}
            />
          )}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Your delta band for this stance is {preset.minDelta.toFixed(2)}–{preset.maxDelta.toFixed(2)}
        {preset.capital > 0 ? ` and the per-position cap is ${money(preset.capital * preset.maxPositionPct)}` : ''}.
        Switching stance widens the delta band.
      </p>
    </div>
  )
}

function Fix({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div>
      <p className="text-[13px] leading-relaxed">{text}</p>
      <button
        onClick={onClick}
        className="mt-2 w-full sm:w-auto rounded-lg px-4 py-2 text-[13px] font-medium"
        style={{ background: 'var(--accent)', color: '#050507' }}
      >
        {action}
      </button>
    </div>
  )
}
