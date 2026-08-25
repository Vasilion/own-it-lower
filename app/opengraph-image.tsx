import { ImageResponse } from 'next/og'

import { ogFonts, OgCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og'

export const alt = 'Own It Lower — cash-secured put screener'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Cash-secured puts"
        headline="Own great companies"
        accent="lower."
        sub="Quality businesses that have pulled back to support, with the strikes ranked against settings you choose and the arithmetic shown."
      />
    ),
    { ...size, fonts: await ogFonts() },
  )
}
