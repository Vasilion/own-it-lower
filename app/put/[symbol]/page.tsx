import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Screen from '@/components/Screen'
import Term from '@/components/Term'
import WatchButton from '@/components/WatchButton'
import { UNIVERSE } from '@/data/universe'
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
  const description = `Cash-secured put analysis for ${s} — strikes ranked against your own settings, with annualised return, downside buffer and effective cost basis shown for each.`

  return {
    title: `${s} cash-secured puts`,
    description,
    // The opengraph-image route in this folder supplies the card itself; these
    // only need to carry the matching text.
    openGraph: { title: `${s} cash-secured puts`, description, type: 'article' },
    twitter: { card: 'summary_large_image', title: `${s} cash-secured puts`, description },
  }
}

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
const usd = (v: number) => `$${v.toFixed(2)}`

function bigMoney(v: number | null): string {
  if (v === null) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${Math.round(v).toLocaleString()}`
}

const ratio = (v: number | null) => (v === null ? '—' : v.toFixed(1))

/**
 * First sentence of Yahoo's business description (two if the first is very short).
 *
 * Split only after a word of three or more lowercase letters so "Apple Inc. designs"
 * and "Co. Ltd." do not end the sentence early.
 */
function shortSummary(text: string | null): { short: string; rest: string } | null {
  if (!text) return null
  const sentences = text.split(/(?<=[a-z]{3}\.)\s+(?=[A-Z])/)
  let short = sentences[0]
  let i = 1
  while (i < sentences.length && short.length < 80) short += ` ${sentences[i++]}`
  return { short, rest: sentences.slice(i).join(' ') }
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function qualityColor(score: number): string {
  if (score >= 65) return 'var(--tier-high)'
  if (score >= 45) return 'var(--tier-mid)'
  return 'var(--tier-low)'
}

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

  /**
   * "Does not exist" and "could not be reached" are different answers.
   *
   * Treating every failure as a 404 tells the user their ticker is invalid when
   * the real cause may be a rate limit or a vendor blip — and it is the kind of
   * wrong answer they cannot diagnose. Only genuinely permanent signals (an
   * invalid symbol, or the provider reporting no such chain) become notFound();
   * everything else renders as a temporary problem they can retry.
   */
  let data: Awaited<ReturnType<typeof analyzeSymbol>>
  try {
    data = await analyzeSymbol(symbol)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Invalid symbol|http 40[34]|no expirations/.test(message)) notFound()
    return <TemporarilyUnavailable symbol={symbol.toUpperCase()} detail={message} />
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

  const f = data.fundamentals
  const name = f?.name ?? UNIVERSE.find((u) => u.symbol === data.symbol)?.name ?? null
  const about = shortSummary(f?.summary ?? null)
  const isEtf = f?.quoteType === 'ETF'

  const valuation: Array<{ label: React.ReactNode; value: string; key: string }> = [
    { key: 'cap', label: <Term k="marketCap">{isEtf ? 'Fund size' : 'Market cap'}</Term>, value: bigMoney(f?.marketCap ?? null) },
    { key: 'pe', label: <Term k="pe">P/E</Term>, value: ratio(f?.trailingPe ?? null) },
    ...(isEtf
      ? []
      : [{ key: 'fpe', label: <Term k="forwardPe">Forward P/E</Term>, value: ratio(f?.forwardPe ?? null) }]),
    {
      key: 'dy',
      label: <Term k="dividendYield">Dividend yield</Term>,
      value: f?.dividendYield ? pct(f.dividendYield, 2) : '—',
    },
    {
      key: 'earn',
      label: 'Next earnings',
      value: f?.nextEarnings ? formatShortDate(f.nextEarnings) : '—',
    },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 sm:py-7">
      <Link
        href="/screener"
        className="inline-block text-[13px] mb-4 hover:underline underline-offset-4"
        style={{ color: 'var(--text-faint)' }}
      >
        &larr; Back to screener
      </Link>

      {/* ---- What this company is, before anything about its options. ---- */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="font-display uppercase tracking-wide text-3xl sm:text-4xl">{data.symbol}</h1>
            <span className="nums text-xl" style={{ color: 'var(--text-muted)' }}>
              {usd(data.spot)}
            </span>
            {data.quality?.score != null && (
              <a
                href="#business"
                className="tap-compact nums text-[13px] rounded-md border px-2 py-0.5"
                style={{ borderColor: 'var(--border)', color: qualityColor(data.quality.score) }}
                title="Business quality score. Tap for the breakdown."
              >
                Quality {Math.round(data.quality.score)}
              </a>
            )}
          </div>
          {name && <p className="text-[15px] mt-1 font-medium">{name}</p>}
          {(f?.sector || f?.industry || isEtf) && (
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {isEtf ? 'Exchange-traded fund' : [f?.sector, f?.industry].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <WatchButton symbol={data.symbol} />
      </div>

      {about && (
        <details className="mb-4 max-w-3xl group">
          <summary
            className="text-[13px] leading-relaxed cursor-pointer list-none"
            style={{ color: 'var(--text-muted)' }}
          >
            {about.short}
            {about.rest && (
              <span className="ml-1 group-open:hidden" style={{ color: 'var(--accent)' }}>
                More
              </span>
            )}
          </summary>
          {about.rest && (
            <p className="text-[13px] leading-relaxed mt-2" style={{ color: 'var(--text-muted)' }}>
              {about.rest}
            </p>
          )}
        </details>
      )}

      <dl className="card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mb-4">
        {valuation.map((v) => (
          <div key={v.key} className="px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {v.label}
            </dt>
            <dd className="nums text-[15px] mt-0.5">{v.value}</dd>
          </div>
        ))}
      </dl>

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

      <Screen data={data} />

      <h2 className="text-sm font-semibold mt-10 mb-3">Price and trend</h2>
      <dl className="card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3" title={s.hint}>
            <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {s.label}
            </dt>
            <dd className="nums text-[15px] mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>

      {data.quality && (
        <div id="business" className="card p-5 md:p-6 mt-6 scroll-mt-28">
          <div className="flex items-baseline gap-3 mb-1 flex-wrap">
            <h2 className="text-sm font-semibold">The business</h2>
            {data.quality.score !== null && (
              <span
                className="nums text-sm font-semibold"
                title="How this company scores on size, cash flow, balance sheet, growth and profitability"
                style={{ color: qualityColor(data.quality.score) }}
              >
                {Math.round(data.quality.score)}
                <span className="font-normal" style={{ color: 'var(--text-faint)' }}>
                  /100
                </span>
              </span>
            )}
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
            Selling a put is a commitment to buy, so this asks whether you would want the business at
            all — separately from whether the price looks good.
          </p>

          {data.quality.failures.length > 0 && (
            <div
              className="rounded-lg border px-3 py-2 mb-4 text-[13px]"
              style={{
                background: 'var(--warn-bg)',
                borderColor: 'var(--warn-border)',
                color: 'var(--warn-text)',
              }}
            >
              <span className="font-medium">Falls short of the quality floor:</span>{' '}
              {data.quality.failures.join('; ')}.
            </div>
          )}

          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.quality.components.map((c) => (
              <div key={c.key} className="flex items-baseline gap-2 text-xs">
                <span className="w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {c.label}
                </span>
                <span className="nums w-7 shrink-0 text-right">
                  {c.score === null ? '—' : Math.round(c.score)}
                </span>
                <span
                  className="h-1 rounded-full shrink-0 overflow-hidden"
                  style={{ width: 40, background: 'var(--border)' }}
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

          {data.quality.unknowns.length > 0 && (
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Could not check: {data.quality.unknowns.join(', ')}. Missing data is reported as
              unknown rather than counted as a failure.
            </p>
          )}
        </div>
      )}

      <p className="mt-8 text-xs" style={{ color: 'var(--text-faint)' }}>
        {data.puts.length} put contracts · delayed quotes via {data.provider} · fetched{' '}
        {new Date(data.fetchedAt).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        })}{' '}
        ET ·{' '}
        <Link href="/screener" className="underline underline-offset-2">
          Back to screener
        </Link>
      </p>
    </div>
  )
}

function TemporarilyUnavailable({ symbol, detail }: { symbol: string; detail: string }) {
  const rateLimited = /429/.test(detail)

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-14 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">
        {symbol} could not be loaded right now
      </h1>
      <p className="text-[15px] leading-relaxed mb-6" style={{ color: 'var(--text-muted)' }}>
        {rateLimited
          ? 'The market data provider is rate-limiting requests at the moment. This usually clears within a minute or two.'
          : 'The market data provider did not return a usable response. This is a temporary problem on our side, not a problem with the ticker.'}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href={`/put/${symbol}`}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#050507' }}
        >
          Try again
        </Link>
        <Link href="/screener" className="text-sm underline underline-offset-2">
          Back to the screener
        </Link>
      </div>
      <p className="mt-8 text-xs nums" style={{ color: 'var(--text-faint)' }}>
        {detail}
      </p>
    </div>
  )
}
