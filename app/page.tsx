import Link from 'next/link'

import SymbolSearch from '@/components/SymbolSearch'

const EXAMPLES = ['NVDA', 'AAPL', 'KO', 'JPM', 'XOM', 'PG']

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-6 py-16 md:py-24">
      <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
        Own great companies
        <br />
        <span style={{ color: 'var(--accent)' }}>lower.</span>
      </h1>

      <p className="mt-5 text-[17px] leading-relaxed max-w-xl" style={{ color: 'var(--text-muted)' }}>
        Selling a cash-secured put pays you to name the price you would happily buy a stock at. This
        screens the option chain, ranks the strikes against settings you choose, and shows the
        arithmetic behind every one.
      </p>

      <div className="mt-8 max-w-md">
        <SymbolSearch autoFocus />
        <p className="mt-3 text-[13px]">
          <Link href="/screener" className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>
            Or browse the whole S&amp;P 500, ranked
          </Link>
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[13px]">
          <span style={{ color: 'var(--text-faint)' }}>Try:</span>
          {EXAMPLES.map((s) => (
            <Link
              key={s}
              href={`/put/${s}`}
              className="rounded-md border px-2 py-0.5 hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--border)' }}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-16 grid gap-8 sm:grid-cols-3">
        <Feature title="It ranks, it doesn't filter">
          Most screeners take numeric ranges and hand back matching rows. Tell this one whether you
          would actually be happy owning the shares, and the same chain comes back in a different
          order.
        </Feature>
        <Feature title="The credit is the bid">
          Screeners that quote the mid-price overstate every return they print. This uses the bid —
          what a seller actually receives — so the number you see is the number you can get.
        </Feature>
        <Feature title="A dip is not a decline">
          A stock resting on a rising 200-day average is on sale. The same stock on a falling one is
          a value trap. That difference is stated in words, not buried in a score.
        </Feature>
      </div>

      <div className="mt-16 pt-8 border-t hairline">
        <h2 className="text-sm font-semibold mb-2">What this is not</h2>
        <p className="text-[13px] leading-relaxed max-w-xl" style={{ color: 'var(--text-muted)' }}>
          It is not advice, and it does not know anything about you. There is no questionnaire about
          your income, your net worth or your goals — only settings for the screen itself. Every
          figure shown is arithmetic you can check against your own broker, which is rather the
          point.
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
