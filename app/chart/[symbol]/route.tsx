import { ImageResponse } from 'next/og'

import { buildChartModel, Chart, CHART_SIZE, type ChartLevel, type ChartModel, type ChartRange } from '@/lib/chart'
import { fetchPriceHistory, type PriceHistory } from '@/lib/data/prices'
import { ogFonts } from '@/lib/og'

export const revalidate = 900

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const RANGES: ChartRange[] = ['3m', '6m', '1y']

function readLevel(params: URLSearchParams, key: string, label: string): ChartLevel[] {
  const raw: string | null = params.get(key)
  const price: number = raw === null ? NaN : Number(raw)
  return Number.isFinite(price) && price > 0 ? [{ label, price }] : []
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

export function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const query: URLSearchParams = new URL(req.url).searchParams
  const rangeParam: string | null = query.get('range')
  const range: ChartRange = RANGES.includes(rangeParam as ChartRange) ? (rangeParam as ChartRange) : '6m'
  const levels: ChartLevel[] = [...readLevel(query, 'strike', 'Strike'), ...readLevel(query, 'be', 'Break-even')]

  return params
    .then((p: { symbol: string }): string => p.symbol.toUpperCase().replace(/\.PNG$/, ''))
    .then((symbol: string): Promise<[PriceHistory, Awaited<ReturnType<typeof ogFonts>>]> => Promise.all([fetchPriceHistory(symbol, '2y'), ogFonts()]))
    .then(([history, fonts]: [PriceHistory, Awaited<ReturnType<typeof ogFonts>>]): Response => {
      const model: ChartModel = buildChartModel(history, range, levels)
      return new ImageResponse(<Chart model={model} />, {
        ...CHART_SIZE,
        fonts,
        headers: { ...CORS, 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' },
      })
    })
    .catch((err: unknown): Response => {
      const message: string = err instanceof Error ? err.message : 'Unknown error'
      const status: number = /no history|empty history|http 40[34]/.test(message) ? 404 : 502
      return Response.json({ error: message }, { status, headers: CORS })
    })
}
