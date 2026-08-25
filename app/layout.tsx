import type { Metadata } from 'next'
import Link from 'next/link'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Own It Lower — cash-secured put screener',
    template: '%s · Own It Lower',
  },
  description:
    'Find cash-secured puts on quality companies that have pulled back. Ranked against settings you choose, with the arithmetic shown.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh flex flex-col">
        <header className="border-b hairline">
          <div className="mx-auto max-w-6xl px-5 md:px-6 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="font-semibold tracking-tight text-[15px]">
              Own It&nbsp;
              <span style={{ color: 'var(--accent)' }}>Lower</span>
            </Link>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Educational tool · 15-minute delayed data
            </span>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        {/*
          The disclaimer is deliberately part of the layout rather than a page the
          user has to find. This tool ranks contracts against parameters the user
          chose and shows its arithmetic; it does not advise. Keeping that visible
          on every screen is the cheapest possible compliance measure.
        */}
        <footer className="border-t hairline mt-16">
          <div
            className="mx-auto max-w-6xl px-5 md:px-6 py-6 text-xs leading-relaxed"
            style={{ color: 'var(--text-faint)' }}
          >
            <p className="mb-2">
              Own It Lower is an educational screening tool. It ranks option contracts against
              filter settings you choose and shows the underlying arithmetic. It does not provide
              investment advice, recommendations, or an offer to buy or sell any security, and
              nothing here is personalised to your circumstances.
            </p>
            <p>
              Options involve substantial risk and are not suitable for every investor. Selling a
              cash-secured put obliges you to buy the shares at the strike price. Market data is
              delayed by at least 15 minutes and may contain errors — verify every figure with your
              broker before acting on it.
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
