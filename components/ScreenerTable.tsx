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

/** Short trend chips. The full sentence lives on the symbol page. */
const TREND_CHIP: Record<TrendState, string> = {
  uptrend_pullback: 'pullback',
  uptrend_deep: 'deep pullback',
  uptrend_extended: 'extended',
  downtrend_bounce: 'bounce',
  downtrend: 'downtrend',
  unknown: '—',
}

type SortKey = 'setupScore' | 'qualityScore' | 'discountScore' | 'ivRank' | 'bestAnnualized' | 'bestCollateral' | 'symbol'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; hint?: string }> = [
  { key: 'setupScore', label: 'Setup', hint: 'Quality, discount and IV rank combined — how much this is worth a look today' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'qualityScore', label: 'Quality', align: 'right', hint: 'Size, cash flow, balance sheet, growth, profitability' },
  { key: 'discountScore', label: 'Discount', align: 'right', hint: 'How much this looks like quality on sale rather than a breakdown' },
  { key: 'ivRank', label: 'IV Rank', align: 'right', hint: 'Where implied volatility sits against this stock’s own history' },
  { key: 'bestAnnualized', label: 'Annualised', align: 'right', hint: 'From a representative 30-delta put — an illustration, not a recommendation' },
  { key: 'bestCollateral', label: 'Collateral', align: 'right', hint: 'Cash that representative contract would tie up' },
]

export default function ScreenerTable({ rows }: { rows: ScreenerRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'setupScore', dir: 'desc' })
  const [maxCollateral, setMaxCollateral] = useState(0)
  const [pullbacksOnly, setPullbacksOnly] = useState(false)
  const [hideDisqualified, setHideDisqualified] = useState(true)
  const [sector, setSector] = useState('all')

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

  return (
    <>
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
        <label className="flex items-center gap-2">
          <span style={{ color: 'var(--text-muted)' }}>Collateral under</span>
          <input
            type="number"
            value={maxCollateral || ''}
            placeholder="any"
            step={1000}
            min={0}
            onChange={(e) => setMaxCollateral(Math.max(0, Number(e.target.value) || 0))}
            className="w-28 rounded-lg border px-2 py-1 nums bg-transparent"
            style={{ borderColor: 'var(--border)' }}
          />
        </label>

        <label className="flex items-center gap-2">
          <span style={{ color: 'var(--text-muted)' }}>Sector</span>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-lg border px-2 py-1 bg-transparent max-w-[190px]"
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

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pullbacksOnly} onChange={(e) => setPullbacksOnly(e.target.checked)} />
          Pullbacks only
        </label>

        <label className="flex items-center gap-2" title="Names failing the market cap, debt or cash flow floor">
          <input
            type="checkbox"
            checked={hideDisqualified}
            onChange={(e) => setHideDisqualified(e.target.checked)}
          />
          Hide below quality floor
        </label>

        <span className="ml-auto nums" style={{ color: 'var(--text-faint)' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No symbols match these filters. Raising the collateral limit or turning off “pullbacks
          only” is usually what opens it up.
        </div>
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
                  <td className="px-3 py-2.5">
                    <span
                      className="nums font-semibold text-[15px]"
                      style={{ color: tierColor(r.setupScore) }}
                      title={r.qualityFailures ? `Below the quality floor: ${r.qualityFailures}` : undefined}
                    >
                      {num(r.setupScore)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/put/${r.symbol}`} className="font-medium hover:underline underline-offset-2">
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
      )}

      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        Annualised and collateral come from a single representative 30-delta put, shown so the row
        carries a concrete number. Open a symbol to rank its whole chain against your own settings.
        IV Rank stays blank until enough daily history has accumulated for that symbol.
      </p>
    </>
  )
}
