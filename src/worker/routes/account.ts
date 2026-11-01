import { Hono } from 'hono'

import { DAILY_MESSAGE_LIMIT, MODELS } from '../../shared/config'
import type { Me, ModelInfo } from '../../shared/types'
import { aiConfigured, availableModels } from '../ai'
import { authMode, privateJson } from '../auth'
import { now, repliesToday, utcDay } from '../db'
import type { AppContext } from '../env'
import { seedStatements } from '../seed'

export const account = new Hono<AppContext>()

account.get('/me', async (c) => {
  const user = c.get('user')
  const db = c.get('db')
  const mode = authMode(c.env, c.req.raw)
  const known = await db.prepare(`SELECT 1 FROM users WHERE owner_sub = ?`).bind(user.sub).first()
  if (!known) {
    const statements = [db.prepare(`INSERT INTO users (owner_sub, created_at) VALUES (?, ?)`).bind(user.sub, now())]
    // Only the loopback development user gets a sample conversation.
    if (mode === 'development') statements.push(...seedStatements(db, user.sub))
    await db.batch(statements)
  }
  const body: Me = {
    user: { sub: user.sub, name: user.name, email: user.email, picture: user.picture },
    capabilities: {
      ai: aiConfigured(c.env),
      database: true,
      auth: mode === 'freebuff' ? 'freebuff' : 'development',
    },
    usage: { used: await repliesToday(db, user.sub), limit: DAILY_MESSAGE_LIMIT, resetsAt: utcDay().end },
  }
  return privateJson(c, body)
})

account.get('/models', async (c) => {
  const offered = aiConfigured(c.env) ? await availableModels(c.env) : null
  const items: ModelInfo[] = MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    available: offered ? offered.has(model.id) : true,
  }))
  c.header('Cache-Control', 'private, max-age=60')
  return c.json({ items })
})

account.delete('/account/conversations', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  await db.batch([
    db.prepare(`DELETE FROM messages WHERE owner_sub = ?`).bind(owner),
    db.prepare(`DELETE FROM conversations WHERE owner_sub = ?`).bind(owner),
    // Events hold their plans inline, not foreign-keyed, so they go in the
    // same sweep.
    db.prepare(`DELETE FROM events WHERE owner_sub = ?`).bind(owner),
  ])
  return privateJson(c, { ok: true })
})
