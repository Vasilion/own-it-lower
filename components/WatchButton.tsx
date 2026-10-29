'use client'

import { useEffect } from 'react'

import { pushRecent, useWatchlist } from '@/lib/client/local'

/**
 * Watchlist star for a ticker page. Also records the visit in "recent", which is
 * what the empty search box offers back. Both live in this browser only.
 */
export default function WatchButton({ symbol }: { symbol: string }) {
  const { has, toggle } = useWatchlist()
  const on = has(symbol)

  useEffect(() => pushRecent(symbol), [symbol])

  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      aria-pressed={on}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] whitespace-nowrap"
      style={{
        borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
        background: on ? 'var(--accent-soft)' : 'transparent',
        color: on ? 'var(--text)' : 'var(--text-muted)',
      }}
      title="Saved in this browser only"
    >
      <span aria-hidden style={{ color: on ? 'var(--accent)' : 'var(--text-faint)' }}>
        {on ? '★' : '☆'}
      </span>
      {on ? 'On watchlist' : 'Watch'}
    </button>
  )
}
