'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { ScreenerRow } from '@/db/schema'
import { TREND_LABEL, type TrendState } from '@/lib/engine/technicals'

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`)
const money = (v: number | null) => (v === null ? '—' : `$${Math.round(v).toLocaleString()}`)
const num = (v: number | null) => (v === null ? '—' : String(Math.round(v)))

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
function abstainedWeight(r: ScreenerRow): number {
  return (
    (r.qualityScore === null ? 0.3 : 0) +
    (r.discountScore === null ? 0.4 : 0) +
    (r.ivRank === null ? 0.3 : 0)
  )
}

/** Above this, the score is flagged as resting on partial evidence. */
const THIN_SCORE_THRESHOLD = 0.5

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
  | 'ivRank'
  | 'bestAnnualized'
  | 'bestCollateral'
  | 'symbol'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; hint?: string }> = [
  { key: 'setupScore', label: 'Setup', hint: 'Quality, discount and IV rank combined — how much this is worth a look today' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'qualityScore', label: 'Quality', align: 'right', hint: 'Size, cash flow, balance sheet, growth, profitability' },
  { key: 'discountScore', label: 'Discount', align: 'right', hint: 'How much this looks like quality on sale rather than a breakdown' },
  { key: 'ivRank', label: 'IV Rank', align: 'right', hint: 'Where implied volatility sits against this stock’s own history' },
  { key: 'bestAnnualized', label: 'Annualised', align: 'right', hint: 'From a representative 30-delta put — an illustration, not a recommendation' },
  { key: 'bestCollateral', label: 'Collateral', align: 'right', hint: 'Cash that representative contract would tie up' },
]

/** Sort options offered on mobile, where table headers are not available to click. */
const MOBILE_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'setupScore', label: 'Setup score' },
  { key: 'bestAnnualized', label: 'Annualised return' },
  { key: 'qualityScore', label: 'Quality' },
  { key: 'discountScore', label: 'Discount' },
  { key: 'bestCollateral', label: 'Collateral' },
  { key: 'symbol', label: 'Symbol' },
]

export default function ScreenerTable({ rows }: { rows: ScreenerRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'setupScore', dir: 'desc' })
  const [maxCollateral, setMaxCollateral] = useState(0)
  const [pullbacksOnly, setPullbacksOnly] = useState(false)
  const [hideDisqualified, setHideDisqualified] = useState(true)
  const [sector, setSector] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s)))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    let out = rows
    if (hideDisqualified) out = out.filter((r) => !r.qualityFailures)
    if (pullbacksOnly) out = out.filter((r) => r.trend === 'uptrend_pullback' || r.trend === 'uptrend_deep')
    if (sector !== 'all') out = out.filter((r) => r.sector === sector)
    // Affordability is the filter that actually decides what a given account can
    // trade, and it is the one most screeners leave out entirely.
    if (maxCollateral > 0) out = out.filter((r) => r.bestCollateral !== null && r.bestCollateral <= maxCollateral)

    return [...out].sort((a, b) => {
      if (sort.key === 'symbol') {
        return sort.dir === 'desc' ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol)
      }
      // Nulls always sort last regardless of direction — a missing value is not a
      // low value, and letting it float to the top would bury the real answers.
      const av = a[sort.key] as number | null
      const bv = b[sort.key] as number | null
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sort.dir === 'desc' ? bv - av : av - bv
    })
  }, [rows, sort, maxCollateral, pullbacksOnly, hideDisqualified, sector])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  const activeFilters =
    (maxCollateral > 0 ? 1 : 0) + (pullbacksOnly ? 1 : 0) + (sector !== 'all' ? 1 : 0) + (hideDisqualified ? 1 : 0)

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
          <label className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
            <span style={{ color: 'var(--text-muted)' }}>Collateral under</span>
            <input
              type="number"
              value={maxCollateral || ''}
              placeholder="any"
              inputMode="numeric"
              step={1000}
              min={0}
              onChange={(e) => setMaxCollateral(Math.max(0, Number(e.target.value) || 0))}
              className="w-32 rounded-lg border px-2 py-1.5 nums bg-transparent text-right"
              style={{ borderColor: 'var(--border)' }}
            />
          </label>

          <label className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
            <span style={{ color: 'var(--text-muted)' }}>Sector</span>
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
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
            <input type="checkbox" checked={pullbacksOnly} onChange={(e) => setPullbacksOnly(e.target.checked)} />
            Pullbacks only
          </label>

          <label className="flex items-center gap-2.5 w-full sm:w-auto" title="Names failing the market cap, debt or cash flow floor">
            <input
              type="checkbox"
              checked={hideDisqualified}
              onChange={(e) => setHideDisqualified(e.target.checked)}
            />
            Hide below quality floor
          </label>

          {/* Table headers do the sorting on desktop; mobile needs an explicit control. */}
          <label className="flex items-center justify-between gap-2 w-full sm:hidden">
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

          <span className="ml-auto nums hidden sm:block" style={{ color: 'var(--text-faint)' }}>
            {filtered.length} of {rows.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No symbols match these filters. Raising the collateral limit or turning off “pullbacks
          only” is usually what opens it up.
        </div>
      ) : (
        <>
          {/* ---------- Mobile: cards ---------- */}
          <ul className="md:hidden space-y-2">
            {filtered.map((r) => (
              <li key={r.symbol}>
                <Link
                  href={`/put/${r.symbol}`}
                  prefetch
                  className="card card-interactive block p-4 active:opacity-80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[15px]">{r.symbol}</span>
                        {r.qualityFailures && (
                          <span className="text-[11px]" style={{ color: 'var(--warn-text)' }}>
                            ⚠
                          </span>
                        )}
                      </div>
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
                    <Stat label="Discount" value={num(r.discountScore)} />
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
                      title={c.hint}
                      className={`px-3 py-2.5 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                      style={{ color: sort.key === c.key ? 'var(--text)' : 'var(--text-muted)' }}
                    >
                      {c.label}
                      <span className="ml-1 text-[10px]">
                        {sort.key === c.key ? (sort.dir === 'desc' ? '▼' : '▲') : ''}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-medium text-left" style={{ color: 'var(--text-muted)' }}>
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
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
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/put/${r.symbol}`}
                        prefetch
                        className="font-medium hover:underline underline-offset-2"
                      >
                        {r.symbol}
                      </Link>
                      {r.qualityFailures && (
                        <span className="ml-2 text-[11px]" style={{ color: 'var(--warn-text)' }} title={r.qualityFailures}>
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right nums">{num(r.qualityScore)}</td>
                    <td className="px-3 py-2.5 text-right nums">{num(r.discountScore)}</td>
                    <td className="px-3 py-2.5 text-right nums" style={{ color: 'var(--text-muted)' }}>
                      {num(r.ivRank)}
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
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Annualised and collateral come from a single representative 30-delta put, shown so the row
        carries a concrete number. Open a symbol to rank its whole chain against your own settings.
        IV Rank stays blank until enough daily history has accumulated for that symbol. A{' '}
        <span style={{ color: 'var(--text-muted)' }}>*</span> marks a setup score resting on partial
        evidence — usually an ETF, which has no balance sheet to score.
      </p>
    </>
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
