import { Hono } from 'hono'

import { isModelId } from '../ai'
import { privateJson } from '../auth'
import { mapConversation, mapMessage, now } from '../db'
import type { AppContext } from '../env'

export const conversations = new Hono<AppContext>()

conversations.get('/', async (c) => {
  const rows = await c.get('db').prepare(`SELECT * FROM conversations WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 200`).bind(c.get('user').sub).all()
  return privateJson(c, { items: (rows.results as Record<string, unknown>[]).map(mapConversation) })
})

// A reply row is created empty when generation starts (routes/chat.ts) and
// filled in at the end. One still empty this long after has been orphaned by
// a lost connection; it is removed when the conversation is next read.
const ORPHAN_AFTER = 10 * 60_000

conversations.get('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  const [, conversation, messages] = await db.batch([
    db
      .prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id = ? AND role = 'assistant' AND content = '' AND created_at < ?`)
      .bind(owner, conversationId, now() - ORPHAN_AFTER),
    db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId),
    db.prepare(`SELECT * FROM messages WHERE owner_sub = ? AND conversation_id = ? AND NOT (role = 'assistant' AND content = '') ORDER BY created_at ASC`).bind(owner, conversationId),
  ])
  if (!conversation.results[0]) return c.json({ error: 'Not found.' }, 404)
  return privateJson(c, {
    conversation: mapConversation(conversation.results[0] as Record<string, unknown>),
    messages: (messages.results as Record<string, unknown>[]).map(mapMessage),
  })
})

conversations.patch('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  const input = await c.req.json<{ title?: unknown; model?: unknown }>().catch(() => ({}) as { title?: unknown; model?: unknown })
  const existing = await db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId).first<Record<string, unknown>>()
  if (!existing) return c.json({ error: 'Not found.' }, 404)
  let title = existing.title as string
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') return c.json({ error: 'Invalid title.' }, 400)
    title = input.title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!title) return c.json({ error: 'Give the chat a title.' }, 400)
  }
  let model = existing.model as string
  if (input.model !== undefined) {
    if (!isModelId(input.model)) return c.json({ error: 'Unknown model.' }, 400)
    model = input.model
  }
  await db.prepare(`UPDATE conversations SET title = ?, model = ? WHERE owner_sub = ? AND id = ?`).bind(title, model, owner, conversationId).run()
  const row = await db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId).first<Record<string, unknown>>()
  return privateJson(c, { conversation: mapConversation(row!) })
})

conversations.delete('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  await db.batch([
    db.prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id = ?`).bind(owner, conversationId),
    db.prepare(`DELETE FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId),
  ])
  return privateJson(c, { ok: true, at: now() })
})
