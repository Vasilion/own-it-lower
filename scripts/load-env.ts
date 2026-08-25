/**
 * Side-effect module that loads .env files for CLI scripts.
 *
 * Import this BEFORE anything that touches `db`. ES modules evaluate every import
 * before the importing module's own body runs, so calling dotenv inline in a script
 * would execute *after* db/index.ts had already read (and failed to find)
 * DATABASE_URL. Isolating the load into its own module makes the ordering explicit
 * and reliable.
 *
 * dotenv does not overwrite variables that are already set, so .env.local beats
 * .env, and a real environment variable (as in CI) beats both.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })
config({ path: '.env' })
