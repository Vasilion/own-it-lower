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

import { explainContract, summariseContract } from '../lib/engine/explain'
import { rankPuts, tallyExclusions } from '../lib/engine/fit'
import { TREND_LABEL } from '../lib/engine/technicals'
import { makePreset, type AssignmentStance } from '../lib/engine/types'
import { analyzeSymbol } from '../lib/server/analyze'
import { computeVolumeProfile } from '../lib/engine/volume-profile'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit?.split('=')[1]
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
  // 0 = no limit, matching the web default. Pass --capital to constrain.
  const capital = Number(arg('capital') ?? 0)
  const stance = (arg('stance') ?? 'neutral') as AssignmentStance

  // Uses exactly the same code path as the web app, so a discrepancy between
  // what the CLI prints and what the page renders can only come from settings.
  const data = await analyzeSymbol(symbol)
  const { technicals, provider } = data
  // The web client computes this too; doing it here keeps CLI and page identical.
  const lookback = Number(arg('lookback') ?? 252)
  const volumeProfile = computeVolumeProfile(data.bars, lookback)
  const context = { ...data.context, volumeProfile: volumeProfile ?? undefined }
  const puts = data.puts
  const dteByExpiry = new Map(Object.entries(data.dte))

  console.log(`\n${symbol} — $${context.spot.toFixed(2)}   [${provider}]`)
  console.log(
    `  200-day $${technicals.sma200?.toFixed(2) ?? 'n/a'} · ` +
      `${technicals.distanceFrom200 !== null ? pct(technicals.distanceFrom200) : 'n/a'} away · ` +
      `RSI ${technicals.rsi14?.toFixed(0) ?? 'n/a'} · %B ${technicals.percentB?.toFixed(2) ?? 'n/a'}`,
  )
  console.log(`  Trend: ${TREND_LABEL[technicals.trend]} (discount ${context.discountScore ?? 'n/a'})`)
  if (data.quality) {
    const q = data.quality
    console.log(
      `  Quality: ${q.score === null ? 'n/a' : Math.round(q.score)}` +
        (q.failures.length > 0 ? `  FAILS GATE: ${q.failures.join('; ')}` : '') +
        (data.fundamentals?.nextEarnings ? `  · next earnings ${data.fundamentals.nextEarnings}` : ''),
    )
  }
  console.log(`  Risk-free ${pct(data.riskFreeRate, 2)} (${data.rateSource}) · ${puts.length} puts\n`)

  const stances: AssignmentStance[] = compare ? ['want', 'neutral', 'avoid'] : [stance]

  for (const s of stances) {
    const preset = makePreset({ capital, assignmentStance: s })
    const all = rankPuts({
      symbol,
      puts,
      dteByExpiry,
      context,
      preset,
      riskFreeRate: data.riskFreeRate,
      includeExcluded: true,
    })
    const ranked = all.filter((r) => r.exclusions.length === 0)

    console.log(
      `── stance: ${s.toUpperCase()}  (delta ${preset.minDelta}-${preset.maxDelta}, ` +
        `capital ${capital > 0 ? `$${capital.toLocaleString()}` : 'unlimited'})  →  ${ranked.length} qualify`,
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
