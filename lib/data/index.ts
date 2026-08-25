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
 * OPTIONS_PROVIDER selects explicitly; otherwise a Tradier token implies Tradier.
 * Yahoo is never chosen automatically — it does not return usable implied
 * volatility (see providers/yahoo.ts), and silently defaulting to it would
 * produce a database full of confident-looking zeros.
 */
export function getOptionsProvider(): OptionsProvider {
  const explicit = env('OPTIONS_PROVIDER')?.toLowerCase()
  const tradierToken = env('TRADIER_ACCESS_TOKEN')
  const tradierMode = env('TRADIER_MODE') === 'production' ? 'production' : 'sandbox'

  switch (explicit) {
    case 'tradier':
      if (!tradierToken) throw new Error('OPTIONS_PROVIDER=tradier but TRADIER_ACCESS_TOKEN is not set')
      return new TradierProvider(tradierToken, tradierMode)
    case 'yahoo':
      return new YahooProvider()
    case undefined:
      break
    default:
      throw new Error(`Unknown OPTIONS_PROVIDER "${explicit}" (expected "tradier" or "yahoo")`)
  }

  if (tradierToken) return new TradierProvider(tradierToken, tradierMode)

  throw new Error(
    'No options data provider configured.\n' +
      'Create a free Tradier sandbox account at https://developer.tradier.com/user/sign_up,\n' +
      'then put the access token in .env.local as TRADIER_ACCESS_TOKEN.',
  )
}
