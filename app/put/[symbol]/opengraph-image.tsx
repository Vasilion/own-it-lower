import { ImageResponse } from 'next/og'

import { ogFonts, OgCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og'

export const alt = 'Cash-secured put analysis'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

/*
 * A per-symbol card, which matters because the go-to-market is SEO-led: a shared
 * link to /put/AVGO should say AVGO, not show a generic logo.
 *
 * Deliberately carries NO live data. Pulling a quote or a score here would put a
 * third-party fetch on the path of every crawler and every social preview, and a
 * rate limit would turn into a broken image rather than a stale number.
 */
export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params

  return new ImageResponse(
    (
      <OgCard
        eyebrow="Cash-secured puts"
        headline={symbol.toUpperCase()}
        sub="Strikes ranked on entry price, downside buffer, liquidity and where the volume actually traded — with the arithmetic behind every one."
      />
    ),
    { ...size, fonts: await ogFonts() },
  )
}
