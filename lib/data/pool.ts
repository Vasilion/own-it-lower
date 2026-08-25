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

/** Thrown when a caller declined to queue behind a rate limit. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`rate limited, retry in about ${retryAfterSeconds}s`)
    this.name = 'RateLimitedError'
  }
}

/**
 * Adaptive request pacer shared by every caller of one provider.
 *
 * Bounded concurrency alone does not prevent a burst -- several workers finishing
 * together fire several immediate requests. Worse, a fixed rate cannot react when
 * a host tightens up.
 *
 * Measured against CBOE on 2026-08-25: 60 requests/minute over distinct (uncached)
 * symbols ran clean, while 100/min with 8 concurrent 1.5MB downloads drew sustained
 * 429s about 55 symbols in. So the pacer starts at a proven-safe rate, backs off
 * hard when throttled -- pausing every caller, not just the unlucky one -- and
 * drifts back toward baseline as requests succeed.
 */
export class RateLimiter {
  private intervalMs: number
  private readonly baseIntervalMs: number
  private nextSlot = 0
  private cooldownUntil = 0

  constructor(perMinute: number) {
    this.baseIntervalMs = 60_000 / perMinute
    this.intervalMs = this.baseIntervalMs
  }

  /**
   * Resolves when the caller may issue its request.
   *
   * `maxWaitMs` bounds how long the caller is willing to queue. Batch jobs should
   * omit it and wait their turn; anything serving a page request should set it,
   * because a user staring at a blank tab for two minutes is worse than an honest
   * "try again" — and that is exactly what an unbounded 429 cooldown produces.
   */
  async acquire(maxWaitMs?: number): Promise<void> {
    for (;;) {
      const now = Date.now()
      // A cooldown from a 429 outranks the normal schedule; re-check after waiting
      // because another worker may have extended it meanwhile.
      if (now < this.cooldownUntil) {
        const wait = this.cooldownUntil - now
        if (maxWaitMs !== undefined && wait > maxWaitMs) {
          throw new RateLimitedError(Math.ceil(wait / 1000))
        }
        await sleep(wait)
        continue
      }
      const slot = Math.max(now, this.nextSlot)
      const wait = slot - now
      if (maxWaitMs !== undefined && wait > maxWaitMs) {
        throw new RateLimitedError(Math.ceil(wait / 1000))
      }
      this.nextSlot = slot + this.intervalMs
      if (wait > 0) await sleep(wait)
      return
    }
  }

  /** Report a 429. Halves the pace and pauses all callers. */
  throttled(retryAfterSeconds?: number): void {
    this.intervalMs = Math.min(this.intervalMs * 2, this.baseIntervalMs * 8)
    const pauseMs = Math.min(Math.max(retryAfterSeconds ?? 20, 5), 120) * 1000
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + pauseMs)
  }

  /** Report a success. Eases the pace back toward the configured rate. */
  succeeded(): void {
    if (this.intervalMs > this.baseIntervalMs) {
      this.intervalMs = Math.max(this.baseIntervalMs, this.intervalMs * 0.97)
    }
  }

  get currentPerMinute(): number {
    return Math.round(60_000 / this.intervalMs)
  }
}
