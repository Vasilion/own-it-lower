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
export function getOptionsProvider(): OptionsProvider {
  const explicit = env('OPTIONS_PROVIDER')?.toLowerCase()
  const tradierToken = env('TRADIER_ACCESS_TOKEN')
  const tradierMode = env('TRADIER_MODE') === 'production' ? 'production' : 'sandbox'

  switch (explicit) {
    case 'cboe':
      return new CboeProvider()
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
  return new CboeProvider()
}
