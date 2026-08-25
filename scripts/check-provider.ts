/**
 * Provider health check.
 *
 *   pnpm check:provider            # uses the configured provider
 *   pnpm check:provider yahoo      # force a specific one
 *
 * Born from a real failure: Yahoo's free options endpoint kept returning HTTP 200
 * with well-formed chains long after the useful fields had been hollowed out --
 * every bid zero, every open interest zero, IV filled with a repeating 0.500005
 * placeholder. Nothing threw. The only symptom was a database quietly filling with
 * confident-looking garbage.
 *
 * So this asserts on the SHAPE OF THE VALUES, not just on a successful response.
 *
 * The checks are deliberately orthogonal, because the one you expect to fire often
 * isn't the one that catches it. Run against Yahoo on 2026-08-25, the IV-variance
 * check PASSED -- the values did differ across strikes -- and the failure was caught
 * instead by the plausible-band check: a 0-6.3% IV range on AAPL, which realistically
 * trades near 25-30%. Live-bid and open-interest checks failed on every symbol too.
 * Any single check would have been fooled; the set was not.
 *
 * Run this before trusting any new vendor, and after any vendor swap.
 */

import './load-env'

import { getOptionsProvider } from '../lib/data'
import { CboeProvider } from '../lib/data/providers/cboe'
import { TradierProvider } from '../lib/data/providers/tradier'
import { YahooProvider } from '../lib/data/providers/yahoo'
import type { OptionsProvider } from '../lib/data/types'

const TEST_SYMBOLS = ['AAPL', 'MSFT', 'KO']
const MIN_DTE = 14
const MAX_DTE = 60
/** Strikes this close to spot must have a real market on any liquid name. */
const NEAR_MONEY_BAND = 0.1

interface Check {
  name: string
  pass: boolean
  detail: string
}

function resolveProvider(): OptionsProvider {
  const forced = process.argv.slice(2).find((a) => !a.startsWith('--'))?.toLowerCase()
  if (forced === 'cboe') return new CboeProvider()
  if (forced === 'yahoo') return new YahooProvider()
  if (forced === 'tradier') {
    const token = process.env.TRADIER_ACCESS_TOKEN
    if (!token) throw new Error('TRADIER_ACCESS_TOKEN is not set')
    return new TradierProvider(token, process.env.TRADIER_MODE === 'production' ? 'production' : 'sandbox')
  }
  return getOptionsProvider()
}

async function checkSymbol(provider: OptionsProvider, symbol: string): Promise<Check[]> {
  const checks: Check[] = []
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name: `${symbol} ${name}`, pass, detail })

  const expirations = await provider.listExpirations(symbol)
  add('expirations listed', expirations.length >= 5, `${expirations.length} found`)

  const today = Date.now()
  const dated = expirations
    .map((iso) => ({ iso, dte: Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / 86_400_000) }))
    .filter((e) => e.dte >= MIN_DTE && e.dte <= MAX_DTE)
    .sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))

  const target = dated[0]
  add('has 14-60 DTE expiry', Boolean(target), target ? `${target.iso} (${target.dte}d)` : 'none in range')
  if (!target) return checks

  const chain = await provider.getChain(symbol, target.iso)
  add('spot price sane', chain.spot > 1 && chain.spot < 100_000, `$${chain.spot.toFixed(2)}`)
  add('puts returned', chain.puts.length >= 10, `${chain.puts.length} puts`)

  const near = chain.puts.filter((p) => Math.abs(p.strike - chain.spot) / chain.spot <= NEAR_MONEY_BAND)
  add('near-money strikes', near.length >= 3, `${near.length} within ${NEAR_MONEY_BAND * 100}% of spot`)
  if (near.length === 0) return checks

  const withBid = near.filter((p) => p.bid > 0)
  add('near-money has live bids', withBid.length >= Math.ceil(near.length * 0.5), `${withBid.length}/${near.length}`)

  const withOi = near.filter((p) => p.openInterest > 0)
  add('near-money has open interest', withOi.length >= Math.ceil(near.length * 0.5), `${withOi.length}/${near.length}`)

  const ivs = near.map((p) => p.impliedVolatility).filter((v): v is number => typeof v === 'number' && v > 0)
  add('IV present', ivs.length >= Math.ceil(near.length * 0.5), `${ivs.length}/${near.length} strikes`)

  if (ivs.length >= 2) {
    const lo = Math.min(...ivs)
    const hi = Math.max(...ivs)
    add(
      'IV in plausible band',
      lo > 0.03 && hi < 3,
      `${(lo * 100).toFixed(1)}% - ${(hi * 100).toFixed(1)}%`,
    )
    // The decisive one. A real chain has a smile; identical IV across strikes is a
    // placeholder, no matter how reasonable the value looks on its own.
    const spread = hi - lo
    add('IV varies across strikes', spread > 0.001, `range ${(spread * 100).toFixed(3)} pts`)
  }

  return checks
}

async function main() {
  const provider = resolveProvider()
  console.log(`\nProvider: ${provider.name}  (claims IV support: ${provider.suppliesIv})\n`)

  const all: Check[] = []
  for (const symbol of TEST_SYMBOLS) {
    try {
      all.push(...(await checkSymbol(provider, symbol)))
    } catch (err) {
      all.push({ name: `${symbol} fetch`, pass: false, detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const width = Math.max(...all.map((c) => c.name.length))
  for (const c of all) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(width)}  ${c.detail}`)
  }

  const failed = all.filter((c) => !c.pass)
  console.log(`\n${all.length - failed.length}/${all.length} checks passed\n`)

  if (failed.length > 0) {
    console.error(`${provider.name} is NOT fit for collecting IV history. Failing checks:`)
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
  console.log(`${provider.name} looks good. Safe to run pnpm snapshot:iv.\n`)
}

main().catch((err) => {
  console.error('[check-provider] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
