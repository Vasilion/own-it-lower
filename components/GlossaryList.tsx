import { GLOSSARY, type GlossaryKey } from '@/lib/glossary'

/**
 * Collapsible list of definitions, for places a per-label "?" cannot go.
 *
 * Mobile result cards are whole-card links or buttons, and a button nested inside
 * one is invalid HTML that breaks hydration, so the cards get this beneath them
 * instead of inline popovers.
 */
export default function GlossaryList({
  items,
  title = 'What do these numbers mean?',
  className = '',
}: {
  items: Array<{ k: GlossaryKey; label: string }>
  title?: string
  className?: string
}) {
  return (
    <details className={`card group ${className}`}>
      <summary
        className="cursor-pointer list-none px-4 py-3 text-[13px] flex items-center justify-between"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
        <span className="group-open:rotate-45 transition-transform" style={{ color: 'var(--accent)' }}>
          +
        </span>
      </summary>
      <dl className="px-4 pb-4 grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.k}>
            <dt className="text-[12px] font-medium">{i.label}</dt>
            <dd className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {GLOSSARY[i.k]}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
