import type { Metadata, Viewport } from 'next'
import { Anton, Inter, JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'

import InstallPrompt from '@/components/InstallPrompt'

import './globals.css'

// Same stack as Leaving The Matrix: Anton for display, Inter for UI, JetBrains
// Mono for figures. Loaded through next/font so there is no flash or layout shift.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-anton', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-jb', display: 'swap' })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ownitlower.leavingthematrix.io'

export const metadata: Metadata = {
  // Makes every relative OG/Twitter image URL absolute, which social crawlers
  // require — a relative path is silently ignored and the card renders blank.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Own It Lower — cash-secured put screener',
    template: '%s · Own It Lower',
  },
  description:
    'Find cash-secured puts on quality companies that have pulled back. Ranked against settings you choose, with the arithmetic shown.',
  // iOS ignores the manifest for these; they have to be declared explicitly.
  appleWebApp: {
    capable: true,
    title: 'Own It Lower',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    type: 'website',
    siteName: 'Own It Lower',
    title: 'Own It Lower — cash-secured put screener',
    description:
      'Quality companies that have pulled back, with the strikes ranked against settings you choose and the arithmetic shown.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Own It Lower — cash-secured put screener',
    description:
      'Quality companies that have pulled back, with the strikes ranked against settings you choose and the arithmetic shown.',
  },
}

export const viewport: Viewport = {
  themeColor: '#050507',
  // Extends the app behind the notch when installed on iOS.
  viewportFit: 'cover',
  // Pinch-zoom stays available: disabling it on a page full of dense figures
  // would be a genuine accessibility problem.
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${anton.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <header className="border-b hairline sticky top-0 z-20" style={{ background: 'var(--bg)' }}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-5 sm:gap-7 min-w-0">
              <Link
                href="/"
                className="font-display text-lg sm:text-xl tracking-wide uppercase whitespace-nowrap"
              >
                Own It <span style={{ color: 'var(--accent)' }}>Lower</span>
              </Link>
              <Link
                href="/screener"
                className="text-[13px] whitespace-nowrap hover:underline underline-offset-4"
                style={{ color: 'var(--text-muted)' }}
              >
                Screener
              </Link>
            </div>
            <span className="eyebrow hidden md:block">15-min delayed · educational</span>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <InstallPrompt />

        {/*
          The disclaimer lives in the layout rather than on a page the user has to
          find. This tool ranks contracts against parameters the user chose and
          shows its arithmetic; it does not advise. Keeping that on every screen is
          the cheapest possible compliance measure.
        */}
        <footer className="border-t hairline mt-16">
          <div
            className="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-xs leading-relaxed"
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
