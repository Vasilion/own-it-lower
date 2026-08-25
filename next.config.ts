import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The OG routes read the Anton TTF from disk at render time. Next's output
  // tracing cannot statically detect a process.cwd() read, so without this the
  // font is absent from the deployed bundle and every card silently falls back
  // to a default face.
  outputFileTracingIncludes: {
    '/opengraph-image': ['./assets/fonts/**'],
    '/put/[symbol]/opengraph-image': ['./assets/fonts/**'],
  },
}

export default nextConfig
