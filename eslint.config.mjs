import { dirname } from 'path'
import { fileURLToPath } from 'url'

import { FlatCompat } from '@eslint/eslintrc'

// eslint-config-next 15 ships an eslintrc-style config rather than a flat array,
// so it is bridged through FlatCompat. This is the pattern Next 15 documents;
// the extensionless flat exports only arrived in 16.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
]

export default eslintConfig
