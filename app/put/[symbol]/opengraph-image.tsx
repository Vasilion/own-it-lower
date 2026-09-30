import { ImageResponse } from 'next/og'

import { buildChartModel, Chart } from '@/lib/chart'
import { fetchPriceHistory, type PriceHistory } from '@/lib/data/prices'
import { ogFonts, OgCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og'

export const alt = 'Cash-secured put analysis'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const revalidate = 3600

type Fonts = Awaited<ReturnType<typeof ogFonts>>

function fallback(symbol: string, fonts: Fonts): ImageResponse {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Cash-secured puts"
        headline={symbol}
        sub="Strikes ranked on entry price, downside buffer, liquidity and where the volume actually traded — with the arithmetic behind every one."
      />
    ),
    { ...size, fonts },
  )
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      setTimeout((): void => reject(new Error('timeout')), ms)
    }),
  ])
}

export default function Image({ params }: { params: Promise<{ symbol: string }> }): Promise<ImageResponse> {
  return Promise.all([params, ogFonts()]).then(([p, fonts]: [{ symbol: string }, Fonts]): Promise<ImageResponse> => {
    const symbol: string = p.symbol.toUpperCase()
    return withTimeout(fetchPriceHistory(symbol, '2y'), 6000)
      .then((history: PriceHistory): ImageResponse => {
        if (history.bars.length < 60) return fallback(symbol, fonts)
        return new ImageResponse(<Chart model={buildChartModel(history, '6m', [])} height={size.height} />, { ...size, fonts })
      })
      .catch((): ImageResponse => fallback(symbol, fonts))
  })
}
