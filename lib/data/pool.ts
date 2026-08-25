export interface PoolResult<T, R> {
  item: T
  value?: R
  error?: Error
}

/**
 * Run `worker` across `items` with bounded concurrency.
 *
 * Never rejects. A fan-out scan that dies on its first bad symbol is useless, so
 * failures are returned per item and the caller decides what a tolerable failure
 * rate is.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PoolResult<T, R>>> {
  const results: Array<PoolResult<T, R>> = new Array(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = { item: items[i], value: await worker(items[i], i) }
      } catch (err) {
        results[i] = { item: items[i], error: err instanceof Error ? err : new Error(String(err)) }
      }
    }
  })

  await Promise.all(runners)
  return results
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retry with exponential backoff. Retries only what `shouldRetry` approves. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 400,
    shouldRetry = () => true,
  }: { attempts?: number; baseDelayMs?: number; shouldRetry?: (err: unknown) => boolean } = {},
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i === attempts - 1 || !shouldRetry(err)) break
      // Jitter keeps a fan-out from re-synchronising into a thundering herd.
      await sleep(baseDelayMs * 2 ** i + Math.random() * 200)
    }
  }
  throw lastError
}

/**
 * Global request spacer: allows at most `perMinute` starts, evenly spaced.
 *
 * Bounded concurrency alone does not prevent a burst — five workers finishing at
 * once fire five immediate requests. Tradier's sandbox caps at 60 requests/minute
 * and answers 429 past that, so a fan-out over 500 symbols needs pacing, not just
 * a worker cap.
 */
export function createRateLimiter(perMinute: number) {
  const minIntervalMs = 60_000 / perMinute
  let nextSlot = 0

  return async function acquire(): Promise<void> {
    const now = Date.now()
    const slot = Math.max(now, nextSlot)
    nextSlot = slot + minIntervalMs
    const wait = slot - now
    if (wait > 0) await sleep(wait)
  }
}
