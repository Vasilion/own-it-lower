/**
 * Brand asset generator for Own It Lower.
 *
 *   pnpm add -D sharp && node scripts/generate-brand-assets.mjs && pnpm remove sharp
 *
 * sharp is installed AD HOC rather than kept as a dependency on purpose: it ships
 * native binaries, which are a common cause of Amplify build failures, and the
 * outputs are committed so the build never needs it. Same reasoning as the LTM
 * generator, which is also run by hand rather than wired into a build.
 *
 * The mark is pure geometry — no text — so it renders identically on any machine.
 * Wordmarks are handled by the OG routes instead, which use the real Anton font
 * through next/og rather than relying on whatever fonts happen to be installed.
 *
 * Produces:
 *   app/icon.png              32x32   browser tab (Next file convention)
 *   app/apple-icon.png        180x180 iOS home screen (Next file convention)
 *   public/favicon.ico        multi-size legacy favicon
 *   public/icons/icon-{192,512}.png       PWA, standard
 *   public/icons/maskable-{192,512}.png   PWA, Android shape mask
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const INK = '#050507'
const SIGNAL = '#00ffc6'

/**
 * The mark: price stepping down onto a floor it can be bought at.
 *
 * `inset` shrinks the artwork for maskable icons, where Android crops to a circle
 * or squircle and anything outside the middle 80% can be cut off.
 */
function mark({ inset = 1, rounded = 0 } = {}) {
  const scale = inset
  const t = (32 - 32 * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${rounded}" fill="${INK}"/>
  <g transform="translate(${t},${t}) scale(${scale})">
    <path d="M6 9 L12 9 L12 14 L18 14 L18 19 L24 19"
          fill="none" stroke="${SIGNAL}" stroke-width="2.6"
          stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="6" y1="25" x2="26" y2="25" stroke="${SIGNAL}" stroke-width="2.6"
          stroke-linecap="round" opacity="0.5"/>
  </g>
</svg>`
}

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()

/**
 * Minimal ICO container around PNG frames.
 *
 * sharp cannot write .ico, and pulling a package in for six bytes of header
 * arithmetic is not worth another dependency. The format is a 6-byte header plus
 * a 16-byte directory entry per image, then the PNG payloads.
 */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type 1 = icon
  header.writeUInt16LE(frames.length, 4)

  let offset = 6 + frames.length * 16
  const entries = []
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)])
}

async function main() {
  await mkdir(path.join(root, 'public/icons'), { recursive: true })

  const square = mark()
  // Slight rounding on the PWA icons so the tile does not read as a hard square
  // on platforms that do not apply their own mask.
  const tile = mark({ rounded: 6 })
  const masked = mark({ inset: 0.66 })

  const out = [
    ['app/icon.png', await png(square, 32)],
    ['app/apple-icon.png', await png(square, 180)],
    ['public/icons/icon-192.png', await png(tile, 192)],
    ['public/icons/icon-512.png', await png(tile, 512)],
    ['public/icons/maskable-192.png', await png(masked, 192)],
    ['public/icons/maskable-512.png', await png(masked, 512)],
  ]

  for (const [rel, buf] of out) {
    await writeFile(path.join(root, rel), buf)
    console.log(`  ${rel.padEnd(34)} ${buf.length} bytes`)
  }

  const ico = buildIco(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(square, size) }))),
  )
  await writeFile(path.join(root, 'public/favicon.ico'), ico)
  console.log(`  public/favicon.ico                 ${ico.length} bytes (16/32/48)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
