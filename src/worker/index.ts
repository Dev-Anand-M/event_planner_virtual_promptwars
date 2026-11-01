import { Hono } from 'hono'

import { aiConfigured } from './ai'
import { authMode, getAuth, requireUser } from './auth'
import { requireDb } from './db'
import type { AppContext, Env } from './env'
import { account } from './routes/account'
import { chat } from './routes/chat'
import { conversations } from './routes/conversations'
import { events } from './routes/events'
import { getFallbackDb } from './sqlite-shim'

const app = new Hono<AppContext>()

app.get('/api/auth/status', (c) => {
  c.header('Cache-Control', 'private, no-store')
  return c.json({ mode: authMode(c.env, c.req.raw), database: Boolean(c.env.DB), ai: aiConfigured(c.env) })
})
app.get('/api/health', (c) => c.json({ ok: true }))

const api = new Hono<AppContext>()
api.use('*', requireUser, requireDb)
api.route('/', account)
api.route('/events', events)
api.route('/conversations', conversations)
api.route('/chat', chat)
app.route('/api', api)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong.' }, 500)
})
app.notFound((c) => (c.req.path.startsWith('/api/') || !c.env?.ASSETS ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)))

export { app }

export default {
  fetch(request: Request, env?: Env, ctx?: ExecutionContext): Promise<Response> {
    const safeEnv: Env = {
      ...((typeof process !== 'undefined' ? process.env : {}) as unknown as Record<string, unknown>),
      ...(env ?? {}),
    } as unknown as Env

    if (!safeEnv.DB) {
      safeEnv.DB = getFallbackDb()
    }

    const safeCtx: ExecutionContext = ctx ?? ({
      waitUntil: (p: Promise<unknown>) => { void p.catch?.(console.error) },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext)

    // Sign in with Freebuff owns /auth/freebuff/* and keeps sessions fresh.
    // Without a client ID the app falls back to the loopback development user.
    const auth = getAuth(safeEnv, request)
    const handler = (req: Request) => Promise.resolve(app.fetch(req, safeEnv, safeCtx))
    return auth ? auth.wrap(handler)(request) : handler(request)
  },
}
