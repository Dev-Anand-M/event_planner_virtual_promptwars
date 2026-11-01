import type { FreebuffUser } from '@freebuff/auth'

export interface Env {
  ASSETS: Fetcher
  // Attached by Freebuff Sites once provisioned (sites_add_storage). Optional so
  // the app can explain what is missing instead of crashing.
  DB?: D1Database
  // The Freebuff API key. Locally from `.env`; on Sites from Sites → Secrets.
  // It is read here and nowhere else, and never leaves the Worker.
  OPENAI_API_KEY?: string
  // Optional override of the API origin; defaults to the Freebuff API.
  OPENAI_BASE_URL?: string
  // Injected on deploy once Sign in with Freebuff is enabled (sites_enable_auth).
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
}

export type Variables = {
  user: FreebuffUser
  db: D1Database
}

export type AppContext = { Bindings: Env; Variables: Variables }
