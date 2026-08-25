import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Screen from '@/components/Screen'
import SymbolSearch from '@/components/SymbolSearch'
import { TREND_LABEL, type TrendState } from '@/lib/engine/technicals'
import { analyzeSymbol } from '@/lib/server/analyze'

// Chains are 15-minute delayed, so a shorter revalidate would burn requests for
// data that cannot have changed. This matches the freshness ceiling exactly.
export const revalidate = 900

interface Props {
  params: Promise<{ symbol: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params
  const s = symbol.toUpperCase()
  return {
    title: `${s} cash-secured puts`,
    description: `Cash-secured put analysis for ${s} — strikes ranked against your own settings, with annualised return, downside buffer and effective cost basis shown for each.`,
  }
}

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
const usd = (v: number) => `$${v.toFixed(2)}`

/**
 * The single most important signal on the page.
 *
 * A quality name resting on a RISING 200-day average is the setup this product
 * exists to find. The same name on a FALLING 200-day is a value trap, and selling
 * puts into it is how people end up owning something that keeps going down. Those
 * two look nearly identical on a distance-from-average measure, so the distinction
 * gets stated in words at the top rather than buried inside a composite score.
 */
function trendTone(trend: TrendState): { bg: string; border: string; text: string } {
  if (trend === 'downtrend' || trend === 'downtrend_bounce') {
    return { bg: 'var(--warn-bg)', border: 'var(--warn-border)', text: 'var(--warn-text)' }
  }
  return { bg: 'var(--bg-sunken)', border: 'var(--border)', text: 'var(--text-muted)' }
}

export default async function SymbolPage({ params }: Props) {
  const { symbol } = await params

  let data
  try {
    data = await analyzeSymbol(symbol)
  } catch {
    notFound()
  }

  const t = data.technicals
  const tone = trendTone(t.trend)

  const stats: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Last', value: usd(data.spot) },
    { label: '200-day', value: t.sma200 ? usd(t.sma200) : '—' },
    {
      label: 'vs 200-day',
      value: t.distanceFrom200 !== null ? pct(t.distanceFrom200) : '—',
      hint: 'Positive means the stock is trading above its 200-day average',
    },
    { label: '50-day', value: t.sma50 ? usd(t.sma50) : '—' },
    { label: 'RSI (14)', value: t.rsi14 !== null ? t.rsi14.toFixed(0) : '—' },
    {
      label: '52-week range',
      value: t.low52 !== null && t.high52 !== null ? `${usd(t.low52)} – ${usd(t.high52)}` : '—',
    },
  ]

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-6 py-8">
      <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{data.symbol}</h1>
            <span className="nums text-xl" style={{ color: 'var(--text-muted)' }}>
              {usd(data.spot)}
            </span>
          </div>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-faint)' }}>
            {data.puts.length} put contracts · delayed quotes via {data.provider} · fetched{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            })}{' '}
            ET
          </p>
        </div>
        <div className="w-full sm:w-72">
          <SymbolSearch />
        </div>
      </div>

      <div
        className="rounded-xl border px-4 py-3 mb-6 text-[13px]"
        style={{ background: tone.bg, borderColor: tone.border, color: tone.text }}
      >
        <span className="font-medium" style={{ color: 'var(--text)' }}>
          {data.symbol} is {TREND_LABEL[t.trend]}
          {t.atSupport ? ', sitting right at it' : ''}.
        </span>{' '}
        {t.trend === 'downtrend' &&
          'A falling long-term average is a different situation from a pullback — the stock may keep declining after assignment.'}
        {t.trend === 'uptrend_pullback' &&
          'A pullback to a rising long-term average is the setup this screen is built around.'}
        {t.trend === 'uptrend_extended' &&
          'Well above its long-term average, so strikes near the money offer less of a discount.'}
        {t.trend === 'uptrend_deep' &&
          'Below a rising long-term average — a deeper pullback, with the longer-term trend still intact.'}
        {t.trend === 'downtrend_bounce' &&
          'Trading above a falling long-term average, which is a bounce rather than an uptrend.'}
      </div>

      <dl className="card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3" title={s.hint}>
            <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {s.label}
            </dt>
            <dd className="nums text-[15px] mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>

      <Screen data={data} />

      <p className="mt-8 text-xs" style={{ color: 'var(--text-faint)' }}>
        <Link href="/" className="underline underline-offset-2">
          Screen another symbol
        </Link>
      </p>
    </div>
  )
}
