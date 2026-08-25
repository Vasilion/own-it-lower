import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'

import * as schema from './schema'

/**
 * Resolve DATABASE_URL, treating an empty string as unset.
 *
 * A stray `DATABASE_URL=` line in a .env file is otherwise indistinguishable from
 * a real value to `??`, and it will happily shadow the correct value set further
 * down the chain. Filtering blanks avoids an afternoon of confusion.
 */
function resolveDatabaseUrl(): string {
  const url = [process.env.DATABASE_URL, process.env.POSTGRES_URL].find(
    (v) => typeof v === 'string' && v.trim().length > 0,
  )
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon connection string.',
    )
  }
  return url.trim()
}

let cached: NeonHttpDatabase<typeof schema> | null = null

/**
 * Lazily construct the client.
 *
 * Deliberately not a module-level `export const db`: that would read the
 * environment at import time, so any script that merely imports something in this
 * file would throw without a database configured. Keeping it lazy is what lets
 * `pnpm snapshot:iv --dry` validate the whole fetch-and-parse path with no
 * database at all.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!cached) cached = drizzle(neon(resolveDatabaseUrl()), { schema })
  return cached
}

export { schema }
