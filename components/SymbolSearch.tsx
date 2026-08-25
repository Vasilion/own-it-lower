'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export default function SymbolSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [value, setValue] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const symbol = value.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return
    startTransition(() => router.push(`/put/${symbol}`))
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="Ticker, e.g. NVDA"
        aria-label="Ticker symbol"
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-base sm:text-sm bg-transparent"
        style={{ borderColor: 'var(--border-strong)' }}
      />
      <button
        type="submit"
        disabled={pending || value.trim().length === 0}
        className="rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
        style={{ background: 'var(--accent)', color: '#050507' }}
      >
        {pending ? 'Loading…' : 'Screen'}
      </button>
    </form>
  )
}
