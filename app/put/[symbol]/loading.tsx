/**
 * Instant skeleton while the chain is fetched.
 *
 * A cold symbol needs a 1.5MB chain download plus price history and fundamentals.
 * Without this the browser sits on a blank tab for the whole wait, which reads as
 * "broken" long before it reads as "loading". Next renders this the moment the
 * route is entered, so navigation feels immediate even when the data is not.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 md:px-6 py-8 animate-pulse">
      <div className="flex items-baseline gap-3 mb-2">
        <Block className="h-9 w-28" />
        <Block className="h-6 w-20" />
      </div>
      <Block className="h-4 w-72 mb-6" />

      <Block className="h-12 w-full rounded-xl mb-6" />

      <div className="card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <Block className="h-3 w-16 mb-2" />
            <Block className="h-4 w-20" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr] items-start">
        <div className="card p-5 md:p-6">
          <Block className="h-4 w-32 mb-4" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Block key={i} className="h-12 w-full mb-2 rounded-lg" />
          ))}
          <Block className="h-9 w-full mt-4 rounded-lg" />
        </div>

        <div className="card p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} className="h-8 w-full mb-2" />
          ))}
        </div>
      </div>

      <p className="mt-6 text-xs" style={{ color: 'var(--text-faint)' }}>
        Fetching the option chain…
      </p>
    </div>
  )
}

function Block({ className = '' }: { className?: string }) {
  return <div className={`rounded ${className}`} style={{ background: 'var(--border)' }} />
}
