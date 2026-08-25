/**
 * Shared Yahoo cookie/crumb session.
 *
 * Yahoo's authenticated endpoints require a cookie plus a matching crumb:
 *   1. GET fc.yahoo.com  -> answers 404 but sets the session cookies
 *   2. GET /v1/test/getcrumb with those cookies -> returns a short crumb
 *   3. Pass ?crumb=<crumb> and the cookies on every subsequent call
 *
 * Extracted into its own module so the options provider and the fundamentals
 * fetcher share ONE handshake rather than each running their own. Concurrent
 * refreshes are collapsed, so a burst of 401s triggers a single re-handshake.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const SESSION_TTL_MS = 30 * 60 * 1000

interface YahooSession {
  cookie: string
  crumb: string
  fetchedAt: number
}

let session: YahooSession | null = null
let inFlight: Promise<YahooSession> | null = null

async function collectCookies(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
  })
  // fc.yahoo.com deliberately answers 404 while still setting the cookies we
  // need, so status is irrelevant here — only Set-Cookie matters.
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

async function establishSession(): Promise<YahooSession> {
  const cookie =
    (await collectCookies('https://fc.yahoo.com/')) ||
    (await collectCookies('https://finance.yahoo.com/'))
  if (!cookie) throw new Error('yahoo: could not obtain session cookie')

  const res = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie, Accept: '*/*' },
  })
  const crumb = (await res.text()).trim()
  if (!res.ok || !crumb || crumb.includes('<')) {
    throw new Error(`yahoo: could not obtain crumb (http ${res.status})`)
  }
  return { cookie, crumb, fetchedAt: Date.now() }
}

export async function getYahooSession(force = false): Promise<YahooSession> {
  if (!force && session && Date.now() - session.fetchedAt < SESSION_TTL_MS) return session
  if (!inFlight) {
    inFlight = establishSession()
      .then((s) => {
        session = s
        return s
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

/** GET a Yahoo JSON endpoint with a valid crumb, refreshing once on a 401. */
export async function yahooGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getYahooSession(attempt > 0)
    // The crumb regularly contains URL-unsafe characters (a real one seen in
    // development: `/fWCL.DwiF8`), so it must be encoded, not concatenated.
    const qs = new URLSearchParams({ ...params, crumb: s.crumb })
    const res = await fetch(`https://query2.finance.yahoo.com${path}?${qs}`, {
      headers: { 'User-Agent': UA, Cookie: s.cookie, Accept: 'application/json' },
    })
    if (res.status === 401 && attempt === 0) continue // stale crumb -> refresh once
    if (!res.ok) throw new Error(`yahoo ${path} http ${res.status}`)
    return (await res.json()) as T
  }
  throw new Error(`yahoo ${path}: crumb refresh did not resolve 401`)
}

/** Yahoo wraps numbers as `{ raw, fmt }` in some modules and returns bare numbers in others. */
export function raw(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value && typeof value === 'object' && 'raw' in value) {
    const r = (value as { raw?: unknown }).raw
    return typeof r === 'number' && Number.isFinite(r) ? r : null
  }
  return null
}
