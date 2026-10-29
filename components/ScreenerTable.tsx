'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import GlossaryList from '@/components/GlossaryList'
import Term from '@/components/Term'
import { KEYS, readLocal, useWatchlist, writeLocal } from '@/lib/client/local'
import { TREND_LABEL, type TrendState } from '@/lib/engine/technicals'
import type { GlossaryKey } from '@/lib/glossary'
import type { ScreenRow } from '@/lib/server/screener'

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`)
const money = (v: number | null) => (v === null ? '—' : `$${Math.round(v).toLocaleString()}`)
const num = (v: number | null) => (v === null ? '—' : String(Math.round(v)))
const ratio = (v: number | null) => (v === null ? '—' : v.toFixed(1))

/**
 * IV/HV is the one column where a HIGH number is not automatically good.
 *
 * Above roughly 1.6 usually means an event is priced in, so the premium is
 * compensation for a known risk rather than an edge. Amber marks that rather than
 * green, and the definition says why.
 */
function ivToHvColor(ratio: number | null): string {
  if (ratio === null) return 'var(--tier-none)'
  if (ratio >= 1.6) return 'var(--tier-mid)'
  if (ratio >= 1.15) return 'var(--tier-high)'
  if (ratio >= 0.9) return 'var(--text-muted)'
  return 'var(--tier-low)'
}

function tierColor(score: number | null): string {
  if (score === null) return 'var(--tier-none)'
  if (score >= 70) return 'var(--tier-high)'
  if (score >= 50) return 'var(--tier-mid)'
  if (score >= 30) return 'var(--tier-low)'
  return 'var(--tier-none)'
}

/**
 * How much of the setup score's weight had no data behind it.
 *
 * Derived from which inputs are present rather than stored, so it stays exact
 * without a migration. Weights mirror scoreSetup().
 *
 * This matters most for ETFs: an index fund has no debt/equity ratio, so quality
 * legitimately abstains and its score rests on discount alone. A 92 built from one
 * component should not look identical to a 92 built from three -- that is the same
 * honesty the IV Rank window label exists for.
 */
function abstainedWeight(r: ScreenRow): number {
  return (
    (r.qualityScore === null ? 0.3 : 0) +
    (r.discountScore === null ? 0.4 : 0) +
    (r.ivRank === null ? 0.3 : 0)
  )
}

/** Above this, the score is flagged as resting on partial evidence. */
const THIN_SCORE_THRESHOLD = 0.5

/** Rows rendered before "Show all". The full set is still filtered and sorted. */
const PAGE = 50

/** Short trend chips. The full sentence lives on the symbol page. */
const TREND_CHIP: Record<TrendState, string> = {
  uptrend_pullback: 'pullback',
  uptrend_deep: 'deep pullback',
  uptrend_extended: 'extended',
  downtrend_bounce: 'bounce',
  downtrend: 'downtrend',
  unknown: '—',
}

type SortKey =
  | 'setupScore'
  | 'qualityScore'
  | 'discountScore'
  | 'trailingPe'
  | 'forwardPe'
  | 'ivRank'
  | 'atmIv'
  | 'ivToHv'
  | 'bestAnnualized'
  | 'bestCollateral'
  | 'symbol'

/** Valuation reads naturally low-to-high, so those columns sort ascending first. */
const ASC_FIRST: SortKey[] = ['trailingPe', 'forwardPe', 'bestCollateral', 'symbol']

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; term?: GlossaryKey }> = [
  { key: 'setupScore', label: 'Setup', term: 'setup' },
  { key: 'symbol', label: 'Company' },
  { key: 'qualityScore', label: 'Quality', align: 'right', term: 'quality' },
  { key: 'discountScore', label: 'Discount', align: 'right', term: 'discount' },
  { key: 'trailingPe', label: 'P/E', align: 'right', term: 'pe' },
  { key: 'forwardPe', label: 'Fwd P/E', align: 'right', term: 'forwardPe' },
  { key: 'atmIv', label: 'IV', align: 'right', term: 'iv' },
  { key: 'ivToHv', label: 'IV/HV', align: 'right', term: 'ivHv' },
  { key: 'ivRank', label: 'IV Rank', align: 'right', term: 'ivRank' },
  { key: 'bestAnnualized', label: 'Annualised', align: 'right', term: 'annualised' },
  { key: 'bestCollateral', label: 'Collateral', align: 'right', term: 'collateral' },
]

/** Sort options offered on mobile, where table headers are not available to click. */
const MOBILE_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'setupScore', label: 'Setup score' },
  { key: 'bestAnnualized', label: 'Annualised return' },
  { key: 'forwardPe', label: 'Forward P/E (low first)' },
  { key: 'trailingPe', label: 'P/E (low first)' },
  { key: 'qualityScore', label: 'Quality' },
  { key: 'discountScore', label: 'Discount' },
  { key: 'ivToHv', label: 'IV vs realised' },
  { key: 'bestCollateral', label: 'Collateral (low first)' },
  { key: 'symbol', label: 'Symbol' },
]

const MOBILE_TERMS: Array<{ k: GlossaryKey; label: string }> = [
  { k: 'setup', label: 'Setup (the big number)' },
  { k: 'quality', label: 'Quality' },
  { k: 'forwardPe', label: 'Fwd P/E' },
  { k: 'annualised', label: 'Annual' },
  { k: 'collateral', label: 'Collateral' },
]

interface Filters {
  maxCollateral: number
  minAnnualized: number
  maxForwardPe: number
  pullbacksOnly: boolean
  hideDisqualified: boolean
  watchOnly: boolean
  sector: string
  sort: { key: SortKey; dir: 'asc' | 'desc' }
}

const DEFAULT_FILTERS: Filters = {
  maxCollateral: 0,
  // The setup score judges the STOCK, not the contract, so a fine setup can sit on
  // negligible premium -- HYG ranked second at 92 while paying 2.2% annualised.
  minAnnualized: 0,
  maxForwardPe: 0,
  pullbacksOnly: false,
  hideDisqualified: true,
  watchOnly: false,
  sector: 'all',
  sort: { key: 'setupScore', dir: 'desc' },
}

export default function ScreenerTable({ rows }: { rows: ScreenRow[] }) {
  /*
   * Filters are remembered in this browser, so opening a ticker and coming back
   * lands on the same screen rather than a reset one. Loaded after mount to keep
   * the server and first client render identical.
   */
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS)
  const [loaded, setLoaded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const watch = useWatchlist()

  useEffect(() => {
    const saved = readLocal<Partial<Filters> | null>(KEYS.screener, null)
    if (saved && typeof saved === 'object') {
      const sortOk =
        saved.sort && COLUMNS.some((c) => c.key === saved.sort!.key) && /^(asc|desc)$/.test(saved.sort.dir)
      setF({ ...DEFAULT_FILTERS, ...saved, sort: sortOk ? saved.sort! : DEFAULT_FILTERS.sort })
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (loaded) writeLocal(KEYS.screener, f)
  }, [f, loaded])

  const set = (patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }))
    setShowAll(false)
  }

  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s)))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    let out = rows
    if (f.watchOnly) out = out.filter((r) => watch.list.includes(r.symbol))
    if (f.hideDisqualified) out = out.filter((r) => !r.qualityFailures)
    if (f.pullbacksOnly) out = out.filter((r) => r.trend === 'uptrend_pullback' || r.trend === 'uptrend_deep')
    if (f.sector !== 'all') out = out.filter((r) => r.sector === f.sector)
    // Affordability is the filter that actually decides what a given account can
    // trade, and it is the one most screeners leave out entirely.
    if (f.maxCollateral > 0) out = out.filter((r) => r.bestCollateral !== null && r.bestCollateral <= f.maxCollateral)
    if (f.minAnnualized > 0) {
      out = out.filter((r) => r.bestAnnualized !== null && r.bestAnnualized * 100 >= f.minAnnualized)
    }
    // Unknown forward P/E (ETFs, loss-makers) is excluded rather than assumed cheap.
    if (f.maxForwardPe > 0) out = out.filter((r) => r.forwardPe !== null && r.forwardPe <= f.maxForwardPe)

    const { key, dir } = f.sort
    return [...out].sort((a, b) => {
      if (key === 'symbol') {
        return dir === 'desc' ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol)
      }
      // Nulls always sort last regardless of direction — a missing value is not a
      // low value, and letting it float to the top would bury the real answers.
      const av = a[key] as number | null
      const bv = b[key] as number | null
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return dir === 'desc' ? bv - av : av - bv
    })
  }, [rows, f, watch.list])

  const visible = showAll ? filtered : filtered.slice(0, PAGE)

  const toggleSort = (key: SortKey) =>
    set({
      sort:
        f.sort.key === key
          ? { key, dir: f.sort.dir === 'desc' ? 'asc' : 'desc' }
          : { key, dir: ASC_FIRST.includes(key) ? 'asc' : 'desc' },
    })

  const activeFilters =
    (f.maxCollateral > 0 ? 1 : 0) +
    (f.minAnnualized > 0 ? 1 : 0) +
    (f.maxForwardPe > 0 ? 1 : 0) +
    (f.pullbacksOnly ? 1 : 0) +
    (f.watchOnly ? 1 : 0) +
    (f.sector !== 'all' ? 1 : 0) +
    (f.hideDisqualified ? 1 : 0)

  const isDefault = JSON.stringify(f) === JSON.stringify(DEFAULT_FILTERS)

  return (
    <>
      {/* Filters — a collapsed summary bar on mobile so results are visible first. */}
      <div className="card mb-4">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="sm:hidden w-full flex items-center justify-between px-4 py-3 text-[13px]"
          aria-expanded={filtersOpen}
        >
          <span>
            Filters{' '}
            <span className="nums" style={{ color: 'var(--text-faint)' }}>
              ({activeFilters})
            </span>
          </span>
          <span className="nums" style={{ color: 'var(--text-faint)' }}>
            {filtered.length} of {rows.length} {filtersOpen ? '▲' : '▼'}
          </span>
        </button>

        <div
          className={`${filtersOpen ? 'block' : 'hidden'} sm:flex px-4 pb-4 sm:py-3 flex-wrap items-center gap-x-6 gap-y-3 text-[13px]`}
        >
          <NumberFilter
            label="Collateral under"
            value={f.maxCollateral}
            step={1000}
            width="w-28"
            onChange={(v) => set({ maxCollateral: v })}
          />
          <NumberFilter
            label="Annualised over"
            suffix="%"
            value={f.minAnnualized}
            step={1}
            width="w-16"
            onChange={(v) => set({ minAnnualized: v })}
          />
          <NumberFilter
            label="Fwd P/E under"
            value={f.maxForwardPe}
            step={1}
            width="w-16"
            onChange={(v) => set({ maxForwardPe: v })}
          />

          <label className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
            <span style={{ color: 'var(--text-muted)' }}>Sector</span>
            <select
              value={f.sector}
              onChange={(e) => set({ sector: e.target.value })}
              className="rounded-lg border px-2 py-1.5 bg-transparent max-w-[200px]"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="all">All</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2.5 w-full sm:w-auto">
            <input type="checkbox" checked={f.pullbacksOnly} onChange={(e) => set({ pullbacksOnly: e.target.checked })} />
            Pullbacks only
          </label>

          <label className="flex items-center gap-2.5 w-full sm:w-auto" title="Names failing the market cap, debt or cash flow floor">
            <input
              type="checkbox"
              checked={f.hideDisqualified}
              onChange={(e) => set({ hideDisqualified: e.target.checked })}
            />
            Hide below quality floor
          </label>

          <label className="flex items-center gap-2.5 w-full sm:w-auto">
            <input type="checkbox" checked={f.watchOnly} onChange={(e) => set({ watchOnly: e.target.checked })} />
            Watchlist only{' '}
            <span className="nums" style={{ color: 'var(--text-faint)' }}>
              ({watch.list.length})
            </span>
          </label>

          {/* Table headers do the sorting on desktop; mobile needs an explicit control. */}
          <label className="flex items-center justify-between gap-2 w-full sm:hidden">
            <span style={{ color: 'var(--text-muted)' }}>Sort by</span>
            <select
              value={f.sort.key}
              onChange={(e) => {
                const key = e.target.value as SortKey
                set({ sort: { key, dir: ASC_FIRST.includes(key) ? 'asc' : 'desc' } })
              }}
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

          <span className="ml-auto flex items-center gap-3">
            {!isDefault && (
              <button
                type="button"
                onClick={() => set(DEFAULT_FILTERS)}
                className="text-[12px] underline underline-offset-2"
                style={{ color: 'var(--text-faint)' }}
              >
                Reset
              </button>
            )}
            <span className="nums hidden sm:block" style={{ color: 'var(--text-faint)' }}>
              {filtered.length} of {rows.length}
            </span>
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {f.watchOnly && watch.list.length === 0
            ? 'Your watchlist is empty. Open any ticker and tap Watch to add it; the list is kept in this browser.'
            : 'No symbols match these filters. Raising the collateral limit or turning off “pullbacks only” is usually what opens it up.'}
        </div>
      ) : (
        <>
          {/* ---------- Mobile: cards ---------- */}
          <ul className="md:hidden space-y-2">
            {visible.map((r) => (
              <li key={r.symbol}>
                <Link href={`/put/${r.symbol}`} className="card card-interactive block p-4 active:opacity-80">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[15px]">{r.symbol}</span>
                        {watch.has(r.symbol) && (
                          <span className="text-[12px]" style={{ color: 'var(--accent)' }} aria-label="On watchlist">
                            ★
                          </span>
                        )}
                        {r.qualityFailures && (
                          <span className="text-[11px]" style={{ color: 'var(--warn-text)' }}>
                            ⚠
                          </span>
                        )}
                      </div>
                      {r.name && (
                        <div className="text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {r.name}
                        </div>
                      )}
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {TREND_CHIP[(r.trend ?? 'unknown') as TrendState]}
                        {r.sector ? ` · ${r.sector}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 flex items-start">
                      <span
                        className="nums font-semibold text-2xl leading-none"
                        style={{ color: tierColor(r.setupScore) }}
                      >
                        {num(r.setupScore)}
                      </span>
                      {abstainedWeight(r) >= THIN_SCORE_THRESHOLD && (
                        <span className="text-[11px] ml-0.5" style={{ color: 'var(--text-faint)' }}>
                          *
                        </span>
                      )}
                    </span>
                  </div>

                  <dl className="grid grid-cols-4 gap-2 mt-3 text-center">
                    <Stat label="Quality" value={num(r.qualityScore)} />
                    <Stat label="Fwd P/E" value={ratio(r.forwardPe)} />
                    <Stat label="Annual" value={pct(r.bestAnnualized)} emphasis />
                    <Stat label="Collateral" value={money(r.bestCollateral)} />
                  </dl>
                </Link>
              </li>
            ))}
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
                      className={`px-3 py-2.5 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                      style={{ color: f.sort.key === c.key ? 'var(--text)' : 'var(--text-muted)' }}
                    >
                      {c.term ? <Term k={c.term}>{c.label}</Term> : c.label}
                      <span className="ml-1 text-[10px]">
                        {f.sort.key === c.key ? (f.sort.dir === 'desc' ? '▼' : '▲') : ''}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-medium text-left" style={{ color: 'var(--text-muted)' }}>
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.symbol} className="border-b hairline last:border-0">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className="nums font-semibold text-[15px]"
                        style={{ color: tierColor(r.setupScore) }}
                        title={r.qualityFailures ? `Below the quality floor: ${r.qualityFailures}` : undefined}
                      >
                        {num(r.setupScore)}
                      </span>
                      {abstainedWeight(r) >= THIN_SCORE_THRESHOLD && (
                        <span
                          className="ml-1 text-[11px] align-super"
                          style={{ color: 'var(--text-faint)' }}
                          title={`${Math.round(abstainedWeight(r) * 100)}% of the scoring weight had no data — this rests on partial evidence`}
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => watch.toggle(r.symbol)}
                          aria-label={watch.has(r.symbol) ? `Remove ${r.symbol} from watchlist` : `Add ${r.symbol} to watchlist`}
                          aria-pressed={watch.has(r.symbol)}
                          className="text-[13px] leading-none"
                          style={{ color: watch.has(r.symbol) ? 'var(--accent)' : 'var(--text-faint)' }}
                        >
                          {watch.has(r.symbol) ? '★' : '☆'}
                        </button>
                        <Link href={`/put/${r.symbol}`} className="font-medium hover:underline underline-offset-2">
                          {r.symbol}
                        </Link>
                        {r.qualityFailures && (
                          <span className="text-[11px]" style={{ color: 'var(--warn-text)' }} title={r.qualityFailures}>
                            ⚠
                          </span>
                        )}
                      </div>
                      {r.name && (
                        <Link
                          href={`/put/${r.symbol}`}
                          className="block text-[11px] truncate pl-5"
                          style={{ color: 'var(--text-faint)' }}
                          title={r.name}
                        >
                          {r.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right nums">{num(r.qualityScore)}</td>
                    <td className="px-3 py-2.5 text-right nums">{num(r.discountScore)}</td>
                    <td className="px-3 py-2.5 text-right nums" style={{ color: 'var(--text-muted)' }}>
                      {ratio(r.trailingPe)}
                    </td>
                    <td className="px-3 py-2.5 text-right nums">{ratio(r.forwardPe)}</td>
                    <td className="px-3 py-2.5 text-right nums">{pct(r.atmIv, 0)}</td>
                    <td className="px-3 py-2.5 text-right nums" style={{ color: ivToHvColor(r.ivToHv) }}>
                      {r.ivToHv === null ? '—' : r.ivToHv.toFixed(2)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right nums"
                      style={{ color: 'var(--text-faint)' }}
                      title={
                        r.ivRank === null && r.ivObservations !== null
                          ? `Building — ${r.ivObservations} of 40 daily observations`
                          : undefined
                      }
                    >
                      {r.ivRank === null
                        ? r.ivObservations !== null
                          ? `${r.ivObservations}/40`
                          : '—'
                        : num(r.ivRank)}
                    </td>
                    <td className="px-3 py-2.5 text-right nums font-medium">{pct(r.bestAnnualized)}</td>
                    <td className="px-3 py-2.5 text-right nums" style={{ color: 'var(--text-muted)' }}>
                      {money(r.bestCollateral)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>
                      <span title={TREND_LABEL[(r.trend ?? 'unknown') as TrendState]}>
                        {TREND_CHIP[(r.trend ?? 'unknown') as TrendState]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > visible.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 w-full card py-3 text-[13px]"
              style={{ color: 'var(--accent)' }}
            >
              Show all {filtered.length}
            </button>
          )}
        </>
      )}

      <GlossaryList items={MOBILE_TERMS} className="md:hidden mt-4" />

      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Annualised and collateral come from a single representative 30-delta put, shown so the row
        carries a concrete number. Open a symbol to rank its whole chain against your own settings.
        IV Rank shows its progress (12/40) until enough daily history exists to compute it; IV/HV
        answers the related question today — above 1 means options are priced for more movement than
        the stock has actually delivered. A{' '}
        <span style={{ color: 'var(--text-muted)' }}>*</span> marks a setup score resting on partial
        evidence — usually an ETF, which has no balance sheet to score. Your filters and watchlist
        are remembered in this browser only.
      </p>
    </>
  )
}

function NumberFilter({
  label,
  value,
  step,
  width,
  suffix,
  onChange,
}: {
  label: string
  value: number
  step: number
  width: string
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value || ''}
          placeholder="any"
          inputMode="numeric"
          step={step}
          min={0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className={`${width} rounded-lg border px-2 py-1.5 nums bg-transparent text-right`}
          style={{ borderColor: 'var(--border)' }}
        />
        {suffix && <span style={{ color: 'var(--text-faint)' }}>{suffix}</span>}
      </span>
    </label>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </dt>
      <dd className={`nums text-[13px] mt-0.5 ${emphasis ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  )
}
