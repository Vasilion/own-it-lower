import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Shared pieces for the Open Graph cards.
 *
 * Fonts are read from disk rather than fetched at render time so a card never
 * depends on a network call to Google. `next.config.ts` force-includes
 * assets/fonts in the output trace — Next cannot statically see a
 * `process.cwd()` read, so without that the files are missing in the deployed
 * bundle and every card silently falls back to a default face.
 *
 * BOTH families have to be supplied. Satori has no system fonts to fall back on,
 * so shipping only Anton renders body copy in a condensed display face too —
 * cohesive at a glance, but wrong and much harder to read at thumbnail size.
 */

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

const INK = '#050507'
const SIGNAL = '#00ffc6'
const BONE = '#f5f5f0'
const BONE_DIM = '#8a8a86'

type FontSpec = { name: string; data: Buffer; weight: 400 | 600; style: 'normal' }

let cached: FontSpec[] | null = null

const read = (file: string) => readFile(path.join(process.cwd(), 'assets/fonts', file))

export async function ogFonts(): Promise<FontSpec[]> {
  if (!cached) {
    const [anton, inter400, inter600] = await Promise.all([
      read('Anton-Regular.ttf'),
      read('Inter-400.ttf'),
      read('Inter-600.ttf'),
    ])
    cached = [
      { name: 'Anton', data: anton, weight: 400, style: 'normal' },
      { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
      { name: 'Inter', data: inter600, weight: 600, style: 'normal' },
    ]
  }
  return cached
}

/** The mark, drawn inline — ImageResponse cannot load an external image cheaply. */
function Mark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path
        d="M6 9 L12 9 L12 14 L18 14 L18 19 L24 19"
        fill="none"
        stroke={SIGNAL}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="6"
        y1="25"
        x2="26"
        y2="25"
        stroke={SIGNAL}
        strokeWidth={2.6}
        strokeLinecap="round"
        opacity={0.5}
      />
    </svg>
  )
}

/**
 * Card shell.
 *
 * ImageResponse supports a subset of CSS — flexbox only, no grid — and any
 * element with more than one child needs an explicit display:flex.
 */
export function OgCard({
  eyebrow,
  headline,
  accent,
  sub,
}: {
  eyebrow: string
  headline: string
  /** Rendered in the signal colour on its own line beneath the headline. */
  accent?: string
  sub: string
}) {
  // A four-letter ticker and a six-word tagline should not be set at the same
  // size; the headline scales to fill the canvas either way.
  const longest = Math.max(headline.length, accent?.length ?? 0)
  const headlineSize = longest <= 6 ? 190 : longest <= 12 ? 128 : longest <= 20 ? 92 : 78

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: INK,
        padding: 64,
        fontFamily: 'Inter',
        // A hairline of brand colour so the card reads as ours even as a thumbnail.
        borderBottom: `10px solid ${SIGNAL}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Mark size={56} />
        <div
          style={{
            fontFamily: 'Anton',
            fontSize: 30,
            letterSpacing: 2,
            color: BONE,
            textTransform: 'uppercase',
          }}
        >
          Own It Lower
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: 5,
            textTransform: 'uppercase',
            color: SIGNAL,
            marginBottom: 16,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontFamily: 'Anton',
            fontSize: headlineSize,
            lineHeight: 0.98,
            color: BONE,
            textTransform: 'uppercase',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>{headline}</span>
          {accent ? <span style={{ color: SIGNAL }}>{accent}</span> : null}
        </div>
      </div>

      <div style={{ fontSize: 25, color: BONE_DIM, maxWidth: 940, lineHeight: 1.4 }}>{sub}</div>
    </div>
  )
}
