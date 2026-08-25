import { NextResponse } from 'next/server'

import { analyzeSymbol } from '@/lib/server/analyze'

/**
 * Raw analysis payload for one symbol.
 *
 * Deliberately returns the ingredients rather than a finished ranking: chain,
 * technicals, context and rate. Ranking is a pure function the caller runs itself
 * (`rankPuts`), which is what lets the web client re-rank instantly on every
 * settings change, and what will let a mobile client reuse the same engine
 * without a server round trip per slider drag.
 *
 * Cached for 15 minutes because the underlying quotes are 15-minute delayed --
 * refetching sooner would spend requests on data that cannot have changed.
 */
export const revalidate = 900

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params

  try {
    const data = await analyzeSymbol(symbol)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Bad tickers are the common case and are the caller's problem, not an outage.
    const status = /Invalid symbol|no expirations|403|404/.test(message) ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
