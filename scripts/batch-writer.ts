/**
 * Incremental batch writer for long-running jobs.
 *
 * The nightly jobs take 10-20 minutes each. Accumulating every row in memory and
 * writing once at the end means a failure at symbol 590 of 600 discards the whole
 * night's work -- and the only symptom is an empty screen the next morning, long
 * after the logs have scrolled away. Flushing as results arrive turns a total loss
 * into a partial one.
 *
 * Writes are serialised through a promise chain, so concurrent workers never issue
 * overlapping inserts even though they add rows from parallel tasks.
 */
export class BatchWriter<T> {
  private buffer: T[] = []
  private chain: Promise<void> = Promise.resolve()
  private written = 0
  private failedBatches = 0

  constructor(
    private readonly batchSize: number,
    private readonly write: (rows: T[]) => Promise<void>,
    /** Called after each successful flush, for progress reporting. */
    private readonly onFlush?: (total: number) => void | Promise<void>,
  ) {}

  /** Queue a row. Triggers a flush once the batch size is reached. */
  add(row: T): void {
    this.buffer.push(row)
    if (this.buffer.length >= this.batchSize) void this.flush()
  }

  /**
   * Write whatever is buffered. Safe to call concurrently and at the end.
   *
   * A failed batch is counted and swallowed rather than thrown: one bad insert
   * should not abort a job that still has hundreds of good rows to write, and the
   * caller reports the count when it finishes.
   */
  flush(): Promise<void> {
    if (this.buffer.length === 0) return this.chain

    const batch = this.buffer
    this.buffer = []

    this.chain = this.chain
      .then(() => this.write(batch))
      .then(async () => {
        this.written += batch.length
        await this.onFlush?.(this.written)
      })
      .catch((err) => {
        this.failedBatches++
        console.error(`[batch] write of ${batch.length} rows failed:`, err instanceof Error ? err.message : err)
      })

    return this.chain
  }

  /** Flush the remainder and wait for every queued write to settle. */
  async drain(): Promise<{ written: number; failedBatches: number }> {
    await this.flush()
    await this.chain
    return { written: this.written, failedBatches: this.failedBatches }
  }
}
