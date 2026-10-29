'use client'

import Link from 'next/link'

import { UNIVERSE } from '@/data/universe'
import { KEYS, useLocal } from '@/lib/client/local'

const NAMES = new Map(UNIVERSE.map((u) => [u.symbol, u.name]))

/** Watchlist and recently viewed, from this browser. Renders nothing until there is something. */
export default function YourTickers() {
  const [watch] = useLocal<string[]>(KEYS.watchlist, [])
  const [recent] = useLocal<string[]>(KEYS.recent, [])
  const recentOnly = recent.filter((s) => !watch.includes(s))

  if (watch.length === 0 && recentOnly.length === 0) return null

  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2">
      {watch.length > 0 && <Group title="Your watchlist" symbols={watch} />}
      {recentOnly.length > 0 && <Group title="Recently viewed" symbols={recentOnly.slice(0, 6)} />}
    </div>
  )
}

function Group({ title, symbols }: { title: string; symbols: string[] }) {
  return (
    <div>
      <p className="eyebrow mb-3">{title}</p>
      <ul className="card">
        {symbols.map((s) => (
          <li key={s} className="border-b hairline last:border-0">
            <Link href={`/put/${s}`} className="flex items-baseline gap-3 px-4 py-2.5 hover:opacity-80">
              <span className="font-medium w-14 shrink-0">{s}</span>
              <span className="text-[12px] truncate" style={{ color: 'var(--text-faint)' }}>
                {NAMES.get(s) ?? ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
