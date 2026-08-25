/*
 * Service worker — hand-written rather than generated.
 *
 * A build plugin would add a dependency and a lot of machinery for what is, at
 * this stage, two caching rules. It is also the piece most likely to serve stale
 * data to a user making money decisions, so it is worth being able to read the
 * whole thing.
 *
 * THE RULE THAT MATTERS: never serve stale market data. The app shell is cached
 * so an installed app opens instantly and survives a dropped connection, but any
 * request that carries prices goes to the network first. A cached option chain
 * shown as current is worse than no app at all.
 */

const VERSION = 'v1'
const SHELL_CACHE = `oil-shell-${VERSION}`

/** Static assets safe to serve from cache — none of them carry prices. */
const SHELL_ASSETS = ['/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individual failures must not abort the install, so each is caught.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Anything that could contain a quote, a score or a chain is network-only.
  // Stale prices are the one failure mode this app must never have.
  const carriesMarketData =
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/put/') ||
    url.pathname.startsWith('/screener')

  if (carriesMarketData) return

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)

      return cached || network
    }),
  )
})
