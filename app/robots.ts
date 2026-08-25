import type { MetadataRoute } from 'next'

// Falls back to the live host rather than an aspirational one: a sitemap that
// advertises a domain nobody owns sends every crawler to a dead address.
// NEXT_PUBLIC_SITE_URL overrides it if the app ever moves.
const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://ownitlower.leavingthematrix.io'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // The analysis endpoint returns a large JSON payload per symbol and exists
      // for the app itself, not for crawlers. Indexing it would burn crawl budget
      // that belongs to the pages people actually search for.
      disallow: '/api/',
    },
    sitemap: `${BASE}/sitemap.xml`,
  }
}
