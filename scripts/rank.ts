/**
 * Rank the put chain for one symbol against a strategy preset.
 *
 *   pnpm rank AAPL
 *   pnpm rank KO --stance=want --capital=50000
 *   pnpm rank NKE --compare        # same chain, all three stances side by side
 *
 * `--compare` is the validation that matters: if the three stances return
 * meaningfully different orderings, the core product thesis holds. If they return
 * the same rows in the same order, the weighting model is not doing any real work
 * and needs rethinking before a single line of UI gets written.
 */

import './load-env'

import { getOptionsProvider } from '../lib/data'
import { fetchPriceHistory } from '../lib/data/prices'
import { getRiskFreeRate } from '../lib/data/rates'
import { explainContract, summariseContract } from '../lib/engine/explain'
import { rankPuts, tallyExclusions } from '../lib/engine/fit'
import { computeTechnicals, scoreDiscount, TREND_LABEL } from '../lib/engine/technicals'
import { makePreset, type AssignmentStance, type UnderlyingContext } from '../lib/engine/types'
import type { OptionQuote } from '../lib/data/types'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit?.split('=')[1]
}

async function gather(symbol: string, minDte: number, maxDte: number) {
  const provider = getOptionsProvider()

  const [expirations, history, rate] = await Promise.all([
    provider.listExpirations(symbol),
    fetchPriceHistory(symbol),
    getRiskFreeRate(),
  ])

  const now = Date.now()
  const wanted = expirations
    .map((iso) => ({ iso, dte: Math.round((Date.parse(`${iso}T00:00:00Z`) - now) / 86_400_000) }))
    .filter((e) => e.dte >= minDte && e.dte <= maxDte)

  if (wanted.length === 0) throw new Error(`no expiries between ${minDte} and ${maxDte} days out`)

  // Every getChain call here is served from the provider's cached payload, so this
  // loop costs no additional network requests.
  const puts: OptionQuote[] = []
  const dteByExpiry = new Map<string, number>()
  let spot = 0

  for (const e of wanted) {
    const chain = await provider.getChain(symbol, e.iso)
    puts.push(...chain.puts)
    dteByExpiry.set(e.iso, e.dte)
    spot = chain.spot || spot
  }

  const technicals = computeTechnicals(history.closes, spot || history.spot)

  const context: UnderlyingContext = {
    spot: spot || history.spot,
    sma200: technicals.sma200 ?? undefined,
    sma200Slope: technicals.sma200Slope ?? undefined,
    sma50: technicals.sma50 ?? undefined,
    low52: technicals.low52 ?? undefined,
    high52: technicals.high52 ?? undefined,
    discountScore: scoreDiscount(technicals) ?? undefined,
  }

  return { puts, dteByExpiry, context, technicals, rate, provider: provider.name }
}

function printTable(
  rows: ReturnType<typeof rankPuts>,
  limit: number,
) {
  console.log(
    '  fit  strike   expiry       dte  delta   premium   annual   buffer     basis     OI  spread',
  )
  for (const r of rows.slice(0, limit)) {
    const m = r.metrics
    console.log(
      '  ' +
        String(Math.round(r.fitScore)).padStart(3) +
        `  $${m.strike.toFixed(2)}`.padStart(9) +
        `  ${m.expiry}` +
        String(m.dte).padStart(5) +
        m.delta.toFixed(2).padStart(7) +
        `  $${m.premium.toFixed(2)}`.padStart(9) +
        pct(m.annualizedReturn).padStart(9) +
        pct(m.downsideBuffer).padStart(9) +
        `  $${m.effectiveCostBasis.toFixed(2)}`.padStart(10) +
        String(m.openInterest).padStart(7) +
        pct(m.spreadPct).padStart(8),
    )
  }
}

async function main() {
  const symbol = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'AAPL').toUpperCase()
  const compare = process.argv.includes('--compare')
  const capital = Number(arg('capital') ?? 25_000)
  const stance = (arg('stance') ?? 'neutral') as AssignmentStance

  const probe = makePreset({ capital })
  const { puts, dteByExpiry, context, technicals, rate, provider } = await gather(
    symbol,
    probe.minDte,
    probe.maxDte,
  )

  console.log(`\n${symbol} — $${context.spot.toFixed(2)}   [${provider}]`)
  console.log(
    `  200-day $${technicals.sma200?.toFixed(2) ?? 'n/a'} · ` +
      `${technicals.distanceFrom200 !== null ? pct(technicals.distanceFrom200) : 'n/a'} away · ` +
      `RSI ${technicals.rsi14?.toFixed(0) ?? 'n/a'} · %B ${technicals.percentB?.toFixed(2) ?? 'n/a'}`,
  )
  console.log(`  Trend: ${TREND_LABEL[technicals.trend]} (discount score ${scoreDiscount(technicals) ?? 'n/a'})`)
  console.log(`  Risk-free rate ${pct(rate.rate, 2)} (${rate.source}) · ${puts.length} put contracts in window\n`)

  const stances: AssignmentStance[] = compare ? ['want', 'neutral', 'avoid'] : [stance]

  for (const s of stances) {
    const preset = makePreset({ capital, assignmentStance: s })
    const all = rankPuts({
      symbol,
      puts,
      dteByExpiry,
      context,
      preset,
      riskFreeRate: rate.rate,
      includeExcluded: true,
    })
    const ranked = all.filter((r) => r.exclusions.length === 0)

    console.log(
      `── stance: ${s.toUpperCase()}  (delta ${preset.minDelta}-${preset.maxDelta}, ` +
        `capital $${capital.toLocaleString()})  →  ${ranked.length} qualify`,
    )

    if (ranked.length === 0) {
      console.log('  nothing passed the hard gates. Binding constraints:')
      for (const t of tallyExclusions(all).slice(0, 6)) {
        console.log(`    ${String(t.count).padStart(4)}  ${t.reason}`)
      }

      // The first-failure tally can bury the real blocker: on an expensive stock,
      // most contracts fail the delta gate first, so "position size" looks like a
      // minor issue when it is actually what makes the symbol unusable at this
      // account size. Surface the number the user would need.
      const capitalOnly = all.filter(
        (r) => r.exclusions.length > 0 && r.exclusions.every((e) => e.includes('collateral')),
      )
      if (capitalOnly.length > 0) {
        const cheapest = Math.min(...capitalOnly.map((r) => r.metrics.collateral))
        const needed = cheapest / preset.maxPositionPct
        console.log(
          `\n  ${capitalOnly.length} contracts fit every setting except position size.\n` +
            `  The cheapest needs $${Math.round(cheapest).toLocaleString()} of collateral, which at a ` +
            `${pct(preset.maxPositionPct, 0)} cap requires about $${Math.round(needed).toLocaleString()} of capital.`,
        )
      }
      if (process.argv.includes('--debug')) {
        console.log('\n  Contracts closest to qualifying:')
        const near = all
          .filter((r) => !r.exclusions.some((e) => e.startsWith('delta')))
          .sort((a, b) => a.exclusions.length - b.exclusions.length)
          .slice(0, 12)
        for (const r of near) {
          const m = r.metrics
          console.log(
            `    $${m.strike.toFixed(2)} ${m.expiry} ${String(m.dte).padStart(2)}d ` +
              `d=${m.delta.toFixed(2)} bid=$${m.bid.toFixed(2)} ask=$${m.ask.toFixed(2)} ` +
              `oi=${String(m.openInterest).padStart(5)} spr=${pct(m.spreadPct)} → ${r.exclusions.join('; ')}`,
          )
        }
      }
      console.log()
      continue
    }

    printTable(ranked, compare ? 3 : 8)

    const excluded = tallyExclusions(all)
    if (excluded.length > 0) {
      console.log(
        `  (excluded: ${excluded.map((t) => `${t.count} ${t.reason}`).join(', ')})`,
      )
    }

    if (!compare) {
      const top = ranked[0]
      console.log(`\n  Top contract — ${summariseContract(top.metrics)}`)
      console.log(`\n  ${explainContract(top.metrics, context, preset)}\n`)
      console.log('  Score breakdown:')
      for (const c of top.components) {
        const bar = c.score === null ? 'abstain' : `${String(Math.round(c.score)).padStart(3)}/100`
        console.log(`    ${c.label.padEnd(13)} ${bar}  w=${c.weight.toFixed(2)}  ${c.detail}`)
      }
      if (top.abstainedWeight > 0) {
        console.log(`    (${pct(top.abstainedWeight, 0)} of weight abstained)`)
      }
    }
    console.log()
  }
}

main().catch((err) => {
  console.error('[rank] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
