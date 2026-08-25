import Link from 'next/link'

import SymbolSearch from '@/components/SymbolSearch'
import { getLatestScreen } from '@/lib/server/screener'

// The preview reads the nightly scan, which changes once a day.
export const revalidate = 3600

const num = (v: number | null) => (v === null ? '—' : String(Math.round(v)))
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)

const TREND_CHIP: Record<string, string> = {
  uptrend_pullback: 'pullback',
  uptrend_deep: 'deep pullback',
  uptrend_extended: 'extended',
  downtrend_bounce: 'bounce',
  downtrend: 'downtrend',
}

export default async function Home() {
  /*
   * The screener is the product. Leading with a search box framed this as a
   * lookup tool, when the actual value is "find me something worth selling
   * against today" -- so the primary action is the screen, and today's real
   * answers sit right underneath it rather than a description of them.
   *
   * Falls back to the plain hero if the scan has not run or the database is
   * unreachable; a broken preview should never take the landing page down.
   */
  let top: Awaited<ReturnType<typeof getLatestScreen>>['rows'] = []
  try {
    const { rows } = await getLatestScreen()
    top = rows.filter((r) => !r.qualityFailures && r.setupScore !== null).slice(0, 5)
  } catch {
    top = []
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 md:py-20">
      <p className="eyebrow mb-4">Cash-secured puts</p>
      <h1 className="font-display uppercase leading-[0.92] tracking-wide text-[clamp(2.75rem,11vw,4.5rem)]">
        Own great companies
        <br />
        <span style={{ color: 'var(--accent)' }}>lower.</span>
      </h1>

      <p
        className="mt-5 text-[16px] sm:text-[17px] leading-relaxed max-w-xl"
        style={{ color: 'var(--text-muted)' }}
      >
        Selling a cash-secured put pays you to name the price you would happily buy a stock at. This
        finds the companies worth naming a price on, ranks the strikes against settings you choose,
        and shows the arithmetic behind every one.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
        <Link
          href="/screener"
          className="inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3.5 text-[15px] font-semibold"
          style={{ background: 'var(--accent)', color: '#050507' }}
        >
          See today&apos;s best setups
          <span aria-hidden>&rarr;</span>
        </Link>
        <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
          600 names, scanned nightly
        </span>
      </div>

      {top.length > 0 && (
        <div className="mt-10">
          <p className="eyebrow mb-3">Top of today&apos;s screen</p>
          <ul className="card">
            {top.map((r) => (
              <li key={r.symbol} className="border-b hairline last:border-0">
                <Link
                  href={`/put/${r.symbol}`}
                  prefetch
                  className="flex items-center gap-3 sm:gap-4 px-4 py-3 hover:opacity-80 transition-opacity"
                >
                  <span
                    className="nums font-semibold text-lg w-9 shrink-0"
                    style={{ color: 'var(--accent)' }}
                  >
                    {num(r.setupScore)}
                  </span>
                  <span className="font-medium w-16 shrink-0">{r.symbol}</span>
                  <span
                    className="text-[12px] hidden sm:block flex-1"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {TREND_CHIP[r.trend ?? ''] ?? '—'}
                    {r.qualityScore !== null ? ` · quality ${num(r.qualityScore)}` : ''}
                  </span>
                  <span className="nums text-[13px] ml-auto sm:ml-0 shrink-0">
                    {pct(r.bestAnnualized)}
                  </span>
                  <span className="text-[11px] shrink-0" style={{ color: 'var(--text-faint)' }}>
                    annualised
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Ranked on business quality, pullback to support, and option premium &mdash; not on yield.
          </p>
        </div>
      )}

      {/* Secondary: for people who already know the ticker they want. */}
      <div className="mt-10 pt-8 border-t hairline">
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-muted)' }}>
          Already know the ticker?
        </p>
        <div className="max-w-md">
          <SymbolSearch />
        </div>
      </div>

      <div className="mt-14 sm:mt-16 grid gap-7 sm:gap-8 sm:grid-cols-3">
        <Feature title="It ranks, it doesn&apos;t filter">
          Most screeners take numeric ranges and hand back matching rows. Tell this one whether you
          would actually be happy owning the shares, and the same chain comes back in a different
          order.
        </Feature>
        <Feature title="Support, not just averages">
          A moving average says where price has been on average. The volume profile says where
          shares actually changed hands &mdash; and a thick shelf of trading beneath your break-even
          is what real support looks like.
        </Feature>
        <Feature title="A dip is not a decline">
          A stock resting on a rising 200-day average is on sale. The same stock on a falling one is
          a value trap. That difference is stated in words, not buried in a score.
        </Feature>
      </div>

      <div className="mt-14 sm:mt-16 pt-8 border-t hairline">
        <h2 className="text-sm font-semibold mb-2">What this is not</h2>
        <p className="text-[13px] leading-relaxed max-w-xl" style={{ color: 'var(--text-muted)' }}>
          It is not advice, and it does not know anything about you. There is no questionnaire about
          your income, your net worth or your goals &mdash; only settings for the screen itself.
          Every figure shown is arithmetic you can check against your own broker, which is rather
          the point.
        </p>
      </div>
    </div>
  )
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold mb-1.5">{title}</h3>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {children}
      </p>
    </div>
  )
}
