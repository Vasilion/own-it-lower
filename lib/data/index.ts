import { CboeProvider } from './providers/cboe'
import { TradierProvider } from './providers/tradier'
import { YahooProvider } from './providers/yahoo'
import type { OptionsProvider } from './types'

export * from './types'
export * from './pool'

/** Read an env var, treating whitespace-only values as unset. */
function env(name: string): string | undefined {
  const v = process.env[name]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

/**
 * Resolve the configured options provider.
 *
 * Default is CBOE: it needs no account, no API key and no brokerage onboarding,
 * returns a full verified chain in one request, and delayed data is the posture
 * this product deliberately ships anyway.
 *
 * Tradier is used when a token is present -- it is the paid fallback if CBOE's
 * public endpoint changes.
 *
 * Yahoo is never selected automatically. Its free options endpoint no longer
 * returns usable implied volatility, and defaulting to it would produce a
 * database full of confident-looking zeros.
 */
/**
 * Memoised so every caller shares ONE provider instance.
 *
 * This used to construct a new provider per call, which quietly defeated both of
 * the mechanisms that make the data layer work: the chain cache started empty on
 * every request, and the rate limiter had no memory of requests already in flight,
 * so nothing was actually paced. Concurrent page loads sailed straight past CBOE's
 * limit and drew 429s, whose backoff then made pages hang for up to two minutes.
 *
 * Keyed by configuration so switching provider via env still takes effect.
 */
let cachedProvider: { key: string; provider: OptionsProvider } | null = null

export function getOptionsProvider(): OptionsProvider {
  const key = [
    env('OPTIONS_PROVIDER') ?? '',
    env('TRADIER_ACCESS_TOKEN') ? 'tok' : '',
    env('TRADIER_MODE') ?? '',
  ].join('|')

  if (cachedProvider?.key === key) return cachedProvider.provider

  const provider = buildProvider()
  cachedProvider = { key, provider }
  return provider
}

function buildProvider(): OptionsProvider {
  const explicit = env('OPTIONS_PROVIDER')?.toLowerCase()
  const tradierToken = env('TRADIER_ACCESS_TOKEN')
  const tradierMode = env('TRADIER_MODE') === 'production' ? 'production' : 'sandbox'

  switch (explicit) {
    case 'cboe':
      return new CboeProvider(cboeOptions())
    case 'tradier':
      if (!tradierToken) throw new Error('OPTIONS_PROVIDER=tradier but TRADIER_ACCESS_TOKEN is not set')
      return new TradierProvider(tradierToken, tradierMode)
    case 'yahoo':
      return new YahooProvider()
    case undefined:
      break
    default:
      throw new Error(`Unknown OPTIONS_PROVIDER "${explicit}" (expected "cboe", "tradier" or "yahoo")`)
  }

  if (tradierToken) return new TradierProvider(tradierToken, tradierMode)
  return new CboeProvider(cboeOptions())
}

/**
 * Batch jobs queue patiently; request-serving code does not.
 *
 * Scripts set BATCH_MODE=1. Everything else is assumed to be serving a page, where
 * an honest "try again in a moment" beats a browser tab hanging for the length of
 * a 429 cooldown.
 */
function cboeOptions(): { waitBudgetMs?: number } {
  return env('BATCH_MODE') === '1' ? {} : { waitBudgetMs: 8_000 }
}
