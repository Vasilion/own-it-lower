'use client'

/**
 * Per-device memory: screen settings, screener filters, watchlist, recent tickers.
 *
 * All of it lives in this browser's localStorage and never leaves it. That keeps
 * the compliance posture intact (nothing about the user is collected or sent) while
 * fixing the worst part of the old flow, where every ticker opened on default
 * settings and every return to the screener lost its filters.
 *
 * Every read and write is wrapped: private windows, blocked storage and quota
 * errors all degrade to "nothing remembered", never to a broken page.
 */

import { useCallback, useEffect, useState } from 'react'

const EVENT = 'oil-local-change'

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }))
  } catch {
    // Storage unavailable: the value simply is not remembered.
  }
}

/**
 * useState that is backed by localStorage.
 *
 * Starts from the fallback so the server render and the first client render agree,
 * then loads the stored value after mount. `loaded` lets a caller avoid writing the
 * fallback over a stored value before it has been read.
 */
export function useLocal<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setValue(readLocal(key, fallback))
    setLoaded(true)
    const sync = (e: Event) => {
      if ((e as CustomEvent).detail === key) setValue(readLocal(key, fallback))
    }
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
    // fallback is a literal at every call site; re-reading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback(
    (v: T) => {
      setValue(v)
      writeLocal(key, v)
    },
    [key],
  )

  return [value, set, loaded]
}

export const KEYS = {
  settings: 'oil:settings:v1',
  screener: 'oil:screener-filters:v1',
  watchlist: 'oil:watchlist:v1',
  recent: 'oil:recent:v1',
} as const

const RECENT_MAX = 8

export function pushRecent(symbol: string): void {
  const list = readLocal<string[]>(KEYS.recent, [])
  writeLocal(KEYS.recent, [symbol, ...list.filter((s) => s !== symbol)].slice(0, RECENT_MAX))
}

export function useWatchlist(): {
  list: string[]
  has: (s: string) => boolean
  toggle: (s: string) => void
} {
  const [list, setList] = useLocal<string[]>(KEYS.watchlist, [])
  return {
    list,
    has: (s) => list.includes(s),
    toggle: (s) => setList(list.includes(s) ? list.filter((x) => x !== s) : [s, ...list]),
  }
}
