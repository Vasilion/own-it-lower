import type { MetadataRoute } from 'next'

/**
 * Web app manifest — what makes this installable on a desktop or a phone.
 *
 * Also the foundation for a native wrapper later: Capacitor wraps a web app, so
 * the icons, name and display mode declared here carry straight over to an
 * iOS/Android build without being redone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Own It Lower — cash-secured put screener',
    short_name: 'Own It Lower',
    description:
      'Find cash-secured puts on quality companies that have pulled back. Ranked against settings you choose, with the arithmetic shown.',
    start_url: '/screener',
    // The screener is the product, so an installed launch lands there rather than
    // on the marketing page an installed user has already read.
    id: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#050507',
    theme_color: '#050507',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Maskable icons are drawn inside the safe zone so Android's shape mask
      // cannot crop the mark.
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: "Today's screen", url: '/screener' },
      { name: 'Look up a ticker', url: '/' },
    ],
  }
}
