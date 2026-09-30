import type { ReactElement } from 'react'

import type { PriceHistory } from '@/lib/data/prices'
import { computeTechnicals, TREND_LABEL, type Technicals } from '@/lib/engine/technicals'
import { computeVolumeProfile, type VolumeProfile } from '@/lib/engine/volume-profile'

export const CHART_SIZE: { width: number; height: number } = { width: 1200, height: 675 }

const INK: string = '#050507'
const PANEL: string = '#0c0c10'
const GRID: string = '#1b1b21'
const SIGNAL: string = '#00ffc6'
const BONE: string = '#f5f5f0'
const BONE_DIM: string = '#8a8a86'
const DOWN: string = '#ff4d6d'
const SMA50: string = '#f2b84b'
const LEVEL: string = '#7aa2ff'

const PAD: number = 36
const PLOT_LEFT: number = PAD
const PLOT_RIGHT: number = 1096
const AXIS_LEFT: number = 1106
const PRICE_TOP: number = 132
const PRICE_BOTTOM: number = 486
const RSI_TOP: number = 510
const RSI_BOTTOM: number = 598
const PROFILE_WIDTH: number = 150

export type ChartBar = { open: number; high: number; low: number; close: number; time: number }

export type ChartLevel = { label: string; price: number }

export type ChartModel = {
  symbol: string
  bars: ChartBar[]
  sma50: Array<number | null>
  sma200: Array<number | null>
  rsi: Array<number | null>
  technicals: Technicals
  profile: VolumeProfile | null
  levels: ChartLevel[]
  low52: number | null
  high52: number | null
  asOf: number
}

export type ChartRange = '3m' | '6m' | '1y'

const RANGE_SESSIONS: Record<ChartRange, number> = { '3m': 63, '6m': 126, '1y': 252 }

function rollingSma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = []
  let sum: number = 0
  for (let i: number = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

function rollingRsi(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map((): number | null => null)
  if (values.length < period + 1) return out
  let gain: number = 0
  let loss: number = 0
  for (let i: number = 1; i <= period; i++) {
    const d: number = values[i] - values[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const toRsi = (g: number, l: number): number => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l))
  out[period] = toRsi(gain, loss)
  for (let i: number = period + 1; i < values.length; i++) {
    const d: number = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = toRsi(gain, loss)
  }
  return out
}

export function buildChartModel(history: PriceHistory, range: ChartRange, levels: ChartLevel[]): ChartModel {
  const all: ChartBar[] = history.bars.map((b): ChartBar => ({ open: b.open, high: b.high, low: b.low, close: b.close, time: b.time }))
  const closes: number[] = all.map((b: ChartBar): number => b.close)
  const sessions: number = RANGE_SESSIONS[range]
  const start: number = Math.max(0, all.length - sessions)
  const sma50: Array<number | null> = rollingSma(closes, 50)
  const sma200: Array<number | null> = rollingSma(closes, 200)
  const rsi: Array<number | null> = rollingRsi(closes, 14)
  const year: ChartBar[] = all.slice(-252)

  return {
    symbol: history.symbol.toUpperCase(),
    bars: all.slice(start),
    sma50: sma50.slice(start),
    sma200: sma200.slice(start),
    rsi: rsi.slice(start),
    technicals: computeTechnicals(history.closes, history.spot),
    profile: computeVolumeProfile(history.bars, 252),
    levels: levels.filter((l: ChartLevel): boolean => Number.isFinite(l.price) && l.price > 0),
    low52: year.length > 0 ? Math.min(...year.map((b: ChartBar): number => b.low)) : null,
    high52: year.length > 0 ? Math.max(...year.map((b: ChartBar): number => b.high)) : null,
    asOf: all.length > 0 ? all[all.length - 1].time : 0,
  }
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function tick(n: number, step: number): string {
  const digits: number = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

function niceStep(span: number, target: number): number {
  const raw: number = span / target
  const mag: number = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm: number = raw / mag
  const nice: number = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return nice * mag
}

function linePath(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let d: string = ''
  let pen: boolean = false
  values.forEach((v: number | null, i: number): void => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

function Label({ x, y, text, color, size = 15, weight = 400, align = 'left' }: { x: number; y: number; text: string; color: string; size?: number; weight?: 400 | 600; align?: 'left' | 'right' }): ReactElement {
  const edge: { left: number } | { right: number } = align === 'left' ? { left: x } : { right: CHART_SIZE.width - x }
  return (
    <div style={{ position: 'absolute', top: y - size * 0.62, ...edge, fontSize: size, fontWeight: weight, color, display: 'flex' }}>
      {text}
    </div>
  )
}

function Mark({ size }: { size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M6 9 L12 9 L12 14 L18 14 L18 19 L24 19" fill="none" stroke={SIGNAL} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <line x1="6" y1="25" x2="26" y2="25" stroke={SIGNAL} strokeWidth={2.6} strokeLinecap="round" opacity={0.5} />
    </svg>
  )
}

export function Chart({ model }: { model: ChartModel }): ReactElement {
  const bars: ChartBar[] = model.bars
  const n: number = bars.length
  const t: Technicals = model.technicals
  const plotWidth: number = PLOT_RIGHT - PLOT_LEFT
  const slot: number = plotWidth / Math.max(n, 1)
  const body: number = Math.max(1.5, Math.min(9, slot * 0.64))

  const candidates: number[] = [
    ...bars.map((b: ChartBar): number => b.low),
    ...bars.map((b: ChartBar): number => b.high),
    ...model.sma50.filter((v: number | null): v is number => v !== null),
    ...model.sma200.filter((v: number | null): v is number => v !== null),
    ...model.levels.map((l: ChartLevel): number => l.price),
  ]
  const rawLow: number = Math.min(...candidates)
  const rawHigh: number = Math.max(...candidates)
  const padding: number = (rawHigh - rawLow) * 0.06
  const lo: number = rawLow - padding
  const hi: number = rawHigh + padding

  const x = (i: number): number => PLOT_LEFT + slot * (i + 0.5)
  const y = (p: number): number => PRICE_BOTTOM - ((p - lo) / (hi - lo)) * (PRICE_BOTTOM - PRICE_TOP)
  const ry = (v: number): number => RSI_BOTTOM - (v / 100) * (RSI_BOTTOM - RSI_TOP)

  const step: number = niceStep(hi - lo, 5)
  const ticks: number[] = []
  for (let p: number = Math.ceil(lo / step) * step; p <= hi; p += step) ticks.push(p)

  const last: ChartBar | undefined = bars[n - 1]
  const prev: ChartBar | undefined = bars[n - 2]
  const change: number = last && prev ? (last.close - prev.close) / prev.close : 0
  const lastRsi: number | null = model.rsi[n - 1] ?? null

  const profile: VolumeProfile | null = model.profile
  const visibleBuckets: Array<{ price: number; share: number }> = profile ? profile.buckets.filter((b): boolean => b.price >= lo && b.price <= hi) : []
  const maxShare: number = Math.max(0.0001, ...visibleBuckets.map((b): number => b.share))
  const bucketHeight: number = profile ? Math.max(2, Math.abs(y(profile.buckets[0].price) - y(profile.buckets[0].price + (profile.high - profile.low) / profile.buckets.length)) - 1) : 0

  const asOf: string = new Date(model.asOf * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const monthTicks: Array<{ i: number; label: string }> = []
  bars.forEach((b: ChartBar, i: number): void => {
    const d: Date = new Date(b.time * 1000)
    const p: Date | null = i > 0 ? new Date(bars[i - 1].time * 1000) : null
    if (p && d.getUTCMonth() !== p.getUTCMonth()) monthTicks.push({ i, label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) })
  })

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: INK, fontFamily: 'Inter', borderBottom: `8px solid ${SIGNAL}` }}>
      <div style={{ position: 'absolute', top: 30, left: PAD, display: 'flex', alignItems: 'center', gap: 14 }}>
        <Mark size={40} />
        <div style={{ fontFamily: 'Anton', fontSize: 52, color: BONE, letterSpacing: 1, display: 'flex' }}>{model.symbol}</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 10 }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: BONE, display: 'flex' }}>{last ? money(last.close) : '—'}</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: change >= 0 ? SIGNAL : DOWN, display: 'flex' }}>{`${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}% on the day`}</div>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 34, right: PAD, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: 2, color: BONE, display: 'flex' }}>OWN IT LOWER</div>
        <div style={{ fontSize: 17, color: t.trend.startsWith('uptrend') ? SIGNAL : t.trend === 'unknown' ? BONE_DIM : DOWN, fontWeight: 600, display: 'flex', marginTop: 4 }}>
          {`Price is ${TREND_LABEL[t.trend]}`}
        </div>
        <div style={{ fontSize: 15, color: BONE_DIM, display: 'flex', marginTop: 2 }}>
          {`RSI ${lastRsi !== null ? lastRsi.toFixed(0) : '—'} · 52w ${model.low52 !== null ? money(model.low52) : '—'} – ${model.high52 !== null ? money(model.high52) : '—'}`}
        </div>
      </div>

      <div style={{ position: 'absolute', top: PRICE_TOP - 26, left: PLOT_LEFT, display: 'flex', gap: 18, fontSize: 14, color: BONE_DIM }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 18, height: 3, background: SMA50, display: 'flex' }} />
          <div style={{ display: 'flex' }}>{`50-day ${t.sma50 !== null ? money(t.sma50) : '—'}`}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 18, height: 3, background: BONE, display: 'flex' }} />
          <div style={{ display: 'flex' }}>{`200-day ${t.sma200 !== null ? money(t.sma200) : '—'}`}</div>
        </div>
        {profile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 18, height: 8, background: SIGNAL, opacity: 0.45, display: 'flex' }} />
            <div style={{ display: 'flex' }}>{`Volume profile (1y) · heaviest ${money(profile.poc)}`}</div>
          </div>
        ) : null}
      </div>

      <svg width={CHART_SIZE.width} height={CHART_SIZE.height} viewBox={`0 0 ${CHART_SIZE.width} ${CHART_SIZE.height}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        <rect x={PLOT_LEFT} y={PRICE_TOP} width={plotWidth} height={PRICE_BOTTOM - PRICE_TOP} fill={PANEL} />
        <rect x={PLOT_LEFT} y={RSI_TOP} width={plotWidth} height={RSI_BOTTOM - RSI_TOP} fill={PANEL} />
        {ticks.map((p: number): ReactElement => (
          <line key={`g${p}`} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth={1} />
        ))}
        {monthTicks.map((m: { i: number; label: string }): ReactElement => (
          <line key={`m${m.i}`} x1={x(m.i)} x2={x(m.i)} y1={PRICE_TOP} y2={RSI_BOTTOM} stroke={GRID} strokeWidth={1} />
        ))}
        {visibleBuckets.map((b: { price: number; share: number }): ReactElement => {
          const w: number = (b.share / maxShare) * PROFILE_WIDTH
          const isPoc: boolean = profile !== null && Math.abs(b.price - profile.poc) < 1e-9
          return <rect key={`v${b.price}`} x={PLOT_RIGHT - w} y={y(b.price) - bucketHeight / 2} width={w} height={bucketHeight} fill={SIGNAL} opacity={isPoc ? 0.55 : 0.2} />
        })}
        {bars.map((b: ChartBar, i: number): ReactElement => {
          const up: boolean = b.close >= b.open
          const color: string = up ? SIGNAL : DOWN
          const top: number = y(Math.max(b.open, b.close))
          const height: number = Math.max(1, Math.abs(y(b.open) - y(b.close)))
          return (
            <g key={`c${i}`}>
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1.2} />
              <rect x={x(i) - body / 2} y={top} width={body} height={height} fill={up ? INK : color} stroke={color} strokeWidth={1.2} />
            </g>
          )
        })}
        <path d={linePath(model.sma200, x, y)} fill="none" stroke={BONE} strokeWidth={2.4} />
        <path d={linePath(model.sma50, x, y)} fill="none" stroke={SMA50} strokeWidth={2} />
        {model.levels.map((l: ChartLevel): ReactElement => (
          <line key={`l${l.label}`} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y(l.price)} y2={y(l.price)} stroke={LEVEL} strokeWidth={1.6} strokeDasharray="7 5" />
        ))}
        {last ? <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y(last.close)} y2={y(last.close)} stroke={change >= 0 ? SIGNAL : DOWN} strokeWidth={1} strokeDasharray="2 4" opacity={0.8} /> : null}
        <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={ry(70)} y2={ry(70)} stroke={BONE_DIM} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={ry(30)} y2={ry(30)} stroke={BONE_DIM} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        <path d={linePath(model.rsi, x, ry)} fill="none" stroke={SIGNAL} strokeWidth={2} />
      </svg>

      {ticks.map((p: number): ReactElement => (
        <Label key={`t${p}`} x={AXIS_LEFT} y={y(p)} text={tick(p, step)} color={BONE_DIM} size={14} />
      ))}
      {model.levels.map((l: ChartLevel): ReactElement => (
        <div key={`ll${l.label}`} style={{ position: 'absolute', top: y(l.price) - 11, left: PLOT_LEFT + 8, background: INK, border: `1px solid ${LEVEL}`, color: LEVEL, fontSize: 14, fontWeight: 600, padding: '1px 6px', borderRadius: 3, display: 'flex' }}>{`${l.label} ${money(l.price)}`}</div>
      ))}
      {last ? (
        <div style={{ position: 'absolute', top: y(last.close) - 11, left: AXIS_LEFT - 4, background: change >= 0 ? SIGNAL : DOWN, color: INK, fontSize: 14, fontWeight: 600, padding: '2px 6px', borderRadius: 3, display: 'flex' }}>{money(last.close)}</div>
      ) : null}
      {monthTicks.map((m: { i: number; label: string }): ReactElement => (
        <Label key={`ml${m.i}`} x={x(m.i) + 4} y={RSI_BOTTOM + 14} text={m.label} color={BONE_DIM} size={13} />
      ))}
      <Label x={PLOT_LEFT + 8} y={RSI_TOP + 12} text={`RSI (14) ${lastRsi !== null ? lastRsi.toFixed(0) : ''}`} color={BONE_DIM} size={13} weight={600} />
      <Label x={AXIS_LEFT} y={ry(70)} text="70" color={BONE_DIM} size={13} />
      <Label x={AXIS_LEFT} y={ry(30)} text="30" color={BONE_DIM} size={13} />

      <div style={{ position: 'absolute', bottom: 18, left: PAD, right: PAD, display: 'flex', justifyContent: 'space-between', fontSize: 14, color: BONE_DIM }}>
        <div style={{ display: 'flex' }}>{`Daily · as of ${asOf} · educational only, not advice`}</div>
        <div style={{ display: 'flex', color: BONE }}>ownitlower.leavingthematrix.io</div>
      </div>
    </div>
  )
}
