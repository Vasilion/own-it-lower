'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GLOSSARY, type GlossaryKey } from '@/lib/glossary'

/**
 * A label with a plain-English definition on hover (mouse) or tap (touch).
 *
 * A native title attribute never shows on touch, and most of this tool's readers
 * are on phones. The popover is portalled to <body> with fixed positioning because
 * the tables sit inside scroll containers that would clip it.
 *
 * Clicks are stopped from propagating so tapping the "?" inside a sortable header
 * or a tappable card explains the term instead of re-sorting or expanding.
 */
export default function Term({ k, children }: { k: GlossaryKey; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  function place() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const width = 260
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8)
    // Flip above when there is no room below.
    const below = r.bottom + 8
    const top = below + 140 > window.innerHeight ? Math.max(8, r.top - 8 - 140) : below
    setPos({ top, left })
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('click', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('click', close)
    }
  }, [open])

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-1"
      // Pointer events, not mouse events: a tap fires a synthetic mouseenter before
      // the click, which would open the popover and then immediately toggle it shut.
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        place()
        setOpen(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setOpen(false)
      }}
    >
      {children}
      <button
        type="button"
        aria-label="What does this mean?"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          place()
          // A mouse has already opened it on hover, so a click keeps it open; a tap toggles.
          const mouse = (e.nativeEvent as PointerEvent).pointerType === 'mouse'
          setOpen((v) => (mouse ? true : !v))
        }}
        // A 24px hit area around a 14px dot: easy to tap, light to look at.
        className="tap-compact inline-flex items-center justify-center shrink-0 -m-[5px]"
        style={{ width: 24, height: 24 }}
      >
        <span
          className="inline-flex items-center justify-center rounded-full border leading-none"
          style={{
            width: 14,
            height: 14,
            fontSize: 9,
            borderColor: 'var(--border-strong)',
            color: 'var(--text-faint)',
          }}
        >
          ?
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            className="fixed z-[100] rounded-lg border px-3 py-2 text-[12px] leading-relaxed normal-case tracking-normal font-normal text-left shadow-xl"
            style={{
              top: pos.top,
              left: pos.left,
              width: 260,
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-muted)',
            }}
          >
            {GLOSSARY[k]}
          </span>,
          document.body,
        )}
    </span>
  )
}
