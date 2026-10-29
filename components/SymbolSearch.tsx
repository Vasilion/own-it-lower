'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { UNIVERSE } from '@/data/universe'
import { KEYS, useLocal } from '@/lib/client/local'

const VALID = /^[A-Z][A-Z0-9.-]{0,9}$/
const MAX_RESULTS = 8

const NAME_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u.name]))

interface Option {
  symbol: string
  name: string | null
  group?: string
}

/**
 * Ticker search by symbol OR company name.
 *
 * Lives in the header so a lookup never means going back to the home page. Matches
 * the scan universe first (symbol prefix, then name), but any valid ticker typed
 * in full still works on Enter: the universe is what gets scanned nightly, not a
 * limit on what can be analysed.
 *
 * With an empty box it offers the watchlist and recent tickers, both kept in this
 * browser only.
 */
export default function SymbolSearch({
  autoFocus = false,
  compact = false,
}: {
  autoFocus?: boolean
  compact?: boolean
}) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [recent] = useLocal<string[]>(KEYS.recent, [])
  const [watch] = useLocal<string[]>(KEYS.watchlist, [])

  const options: Option[] = useMemo(() => {
    const q = value.trim().toUpperCase()
    if (!q) {
      const seen = new Set<string>()
      const out: Option[] = []
      for (const s of watch) {
        if (seen.has(s)) continue
        seen.add(s)
        out.push({ symbol: s, name: NAME_BY_SYMBOL.get(s) ?? null, group: 'Watchlist' })
      }
      for (const s of recent) {
        if (seen.has(s)) continue
        seen.add(s)
        out.push({ symbol: s, name: NAME_BY_SYMBOL.get(s) ?? null, group: 'Recent' })
      }
      return out.slice(0, 10)
    }

    const lower = value.trim().toLowerCase()
    const exact = UNIVERSE.filter((u) => u.symbol === q)
    const prefix = UNIVERSE.filter((u) => u.symbol !== q && u.symbol.startsWith(q))
    const byName = UNIVERSE.filter(
      (u) => !u.symbol.startsWith(q) && u.name.toLowerCase().includes(lower),
    ).sort((a, b) => {
      // Names that start with the query beat names that merely contain it.
      const as = a.name.toLowerCase().startsWith(lower) ? 0 : 1
      const bs = b.name.toLowerCase().startsWith(lower) ? 0 : 1
      return as - bs
    })
    const hits: Option[] = [...exact, ...prefix, ...byName]
      .slice(0, MAX_RESULTS)
      .map((u) => ({ symbol: u.symbol, name: u.name }))

    // A valid ticker outside the universe is still offered, so nothing typed is a dead end.
    if (VALID.test(q) && exact.length === 0) hits.push({ symbol: q, name: null })
    return hits
  }, [value, recent, watch])

  useEffect(() => setActive(0), [value])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    // "/" focuses search from anywhere, the convention most data sites share.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && compact) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [compact])

  function go(symbol: string) {
    setOpen(false)
    setValue('')
    inputRef.current?.blur()
    startTransition(() => router.push(`/put/${symbol}`))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const picked = open ? options[active] : undefined
    if (picked) return go(picked.symbol)
    const symbol = value.trim().toUpperCase()
    if (VALID.test(symbol)) go(symbol)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showList = open && options.length > 0

  return (
    <div ref={boxRef} className="relative w-full">
      <form onSubmit={submit} className="flex gap-2" role="search">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={compact ? 'Search ticker or company' : 'Ticker or company, e.g. NVDA or Apple'}
          aria-label="Search by ticker or company name"
          aria-expanded={showList}
          aria-controls="symbol-search-list"
          aria-autocomplete="list"
          role="combobox"
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          className={`flex-1 min-w-0 rounded-lg border bg-transparent ${
            compact ? 'px-3 py-1.5 text-base sm:text-[13px]' : 'px-3 py-2.5 text-base sm:text-sm'
          }`}
          style={{ borderColor: 'var(--border-strong)' }}
        />
        {!compact && (
          <button
            type="submit"
            disabled={pending || value.trim().length === 0}
            className="rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            style={{ background: 'var(--accent)', color: '#050507' }}
          >
            {pending ? 'Loading…' : 'Screen'}
          </button>
        )}
      </form>

      {showList && (
        <ul
          id="symbol-search-list"
          role="listbox"
          className="absolute left-0 right-0 mt-1 z-50 rounded-lg border py-1 max-h-[60vh] overflow-y-auto shadow-xl"
          style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-strong)' }}
        >
          {options.map((o, i) => (
            <li key={`${o.group ?? ''}${o.symbol}`}>
              {o.group && (i === 0 || options[i - 1].group !== o.group) && (
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                  {o.group}
                </div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(o.symbol)}
                className="w-full text-left px-3 py-2 flex items-baseline gap-3 text-[13px]"
                style={{ background: i === active ? 'var(--accent-soft)' : 'transparent' }}
              >
                <span className="nums font-semibold w-14 shrink-0">{o.symbol}</span>
                <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                  {o.name ?? 'Look up this ticker'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && compact && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Loading…
        </span>
      )}
    </div>
  )
}
