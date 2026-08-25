import type { MetadataRoute } from 'next'

import { UNIVERSE } from '@/data/universe'

/**
 * One indexable page per symbol.
 *
 * The go-to-market for this product is SEO-led: several hundred pages each
 * answering a real long-tail query ("AAPL cash secured put"), where the free page
 * carries genuine value and the paywall sits on the personalised ranking. That
 * only works if the per-symbol pages are actually discoverable, so the sitemap is
 * generated from the universe rather than hand-maintained.
 */
export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://ownitlower.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/screener`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    ...UNIVERSE.map((m) => ({
      url: `${BASE}/put/${m.symbol}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ]
}
