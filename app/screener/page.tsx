import type { Metadata } from 'next'
import Link from 'next/link'

import ScreenerTable from '@/components/ScreenerTable'
import { getLatestScreen } from '@/lib/server/screener'

export const metadata: Metadata = {
  title: 'Screener',
  description:
    'Quality large-caps ranked by how much they look like a business worth owning that has pulled back to support with elevated option premium.',
}

/*
 * Rendered per request, not prerendered.
 *
 * ISR was wrong here. The page was baked at BUILD time and served with
 * `stale-while-revalidate=31532400` -- a year -- so CloudFront kept returning the
 * build artifact and the screener showed the previous day's scan long after the
 * nightly job had written a new one. A data product displaying yesterday's date
 * under today's heading is a trust problem, not a performance trade-off.
 *
 * The cost is one indexed Neon read per request, which is far cheaper than the
 * live option-chain fetch /put/[symbol] already does on every hit.
 */
export const dynamic = 'force-dynamic'

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export default async function ScreenerPage() {
  let rows: Awaited<ReturnType<typeof getLatestScreen>>['rows'] = []
  let date: string | null = null
  let error: string | null = null

  try {
    const screen = await getLatestScreen()
    rows = screen.rows
    date = screen.date
  } catch (err) {
    // A database problem should not blank the page with a stack trace.
    error = err instanceof Error ? err.message : 'Could not load the screen'
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display uppercase tracking-wide text-3xl sm:text-4xl">Screener</h1>
        <p className="text-[13px] mt-1 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
          The S&amp;P 500 plus liquid names outside the index and the major ETFs, each scored on
          whether it is worth owning and has pulled back to support with option premium worth
          collecting. Sorted by that combination, not by yield.
        </p>
        {date && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
            Scan of {formatDate(date)} · {rows.length} symbols
          </p>
        )}
      </div>

      {error ? (
        <div className="card p-6 text-[13px]">
          <p className="font-medium mb-1">The screen could not be loaded.</p>
          <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-[13px]">
          <p className="font-medium mb-1">No scan has been stored yet.</p>
          <p style={{ color: 'var(--text-muted)' }}>
            Run <code className="nums">pnpm scan</code> to populate it, or{' '}
            <Link href="/" className="underline underline-offset-2">
              screen a single symbol
            </Link>{' '}
            in the meantime.
          </p>
        </div>
      ) : (
        <ScreenerTable rows={rows} />
      )}

      {/*
        Stating the sort rule outright matters more here than on the symbol page.
        A screener that ranked by yield would put the most distressed names on top,
        which is precisely the mistake this one is built to avoid.
      */}
      <div className="mt-10 pt-6 border-t hairline max-w-2xl">
        <h2 className="text-sm font-semibold mb-2">Why the highest yield is not at the top</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Option premium is compensation for risk, so the fattest premium usually belongs to the
          stock the market is most worried about. Sorting by annualised return would reliably put
          the most damaged businesses first. This ranks on the combination instead — a solid
          balance sheet, a pullback rather than a breakdown, and premium that is rich relative to
          that stock&apos;s own history. You can still sort by yield; the column is there.
        </p>
      </div>
    </div>
  )
}
