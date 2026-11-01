import type { MiddlewareHandler } from 'hono'

import type { Conversation, Message } from '../shared/types'
import type { AppContext } from './env'

const BASE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    owner_sub TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    event_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner_sub, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    interrupted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages(owner_sub, conversation_id, created_at)`,
  // The daily usage count: replies generated per owner per day.
  `CREATE INDEX IF NOT EXISTS messages_owner_role_created ON messages(owner_sub, role, created_at)`,
  // Events: one host's planned gathering, with its plan stored as JSON.
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    guests INTEGER NOT NULL,
    budget_total REAL NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_owner ON events(owner_sub, updated_at DESC)`,
  // Chats bound to an event, newest first per event.
  `CREATE INDEX IF NOT EXISTS conversations_event ON conversations(owner_sub, event_id, updated_at DESC)`,
]

// Older databases (from the pre-events schema) lack the event_id column; this
// is added at the end, once, and "duplicate" errors are ignored.
const LATER_SCHEMA = [`ALTER TABLE conversations ADD COLUMN event_id TEXT`]
const isDuplicate = (error: unknown): boolean => String((error as Error)?.message ?? '').match(/duplicate column|already exists|存在重复/i) !== null

let ready: Promise<void> | undefined

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= (async () => {
    await db.batch(BASE_SCHEMA.map((sql) => db.prepare(sql)))
    await Promise.all(
      LATER_SCHEMA.map((sql) =>
        db.prepare(sql).run().catch((error: unknown) => {
          if (!isDuplicate(error)) throw error
        }),
      ),
    )
  })().then(
    () => undefined,
    (error) => {
      ready = undefined
      throw error
    },
  )
  return ready
}

export const requireDb: MiddlewareHandler<AppContext> = async (c, next) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'database_missing', message: 'No database is attached yet. Add D1 storage named DB and redeploy.' }, 503)
  }
  await ensureSchema(db)
  c.set('db', db)
  await next()
}

export const id = () => crypto.randomUUID()
export const now = () => Date.now()

type Row = Record<string, unknown>

export function mapConversation(r: Row): Conversation {
  return {
    id: r.id as string,
    title: r.title as string,
    model: r.model as string,
    eventId: (r.event_id as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

export function mapMessage(r: Row): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as Message['role'],
    content: r.content as string,
    model: (r.model as string | null) ?? null,
    interrupted: Boolean(r.interrupted),
    createdAt: Number(r.created_at),
  }
}

/** Midnight UTC that started the current day, and the next one. */
export function utcDay(at = now()): { start: number; end: number } {
  const start = new Date(at)
  start.setUTCHours(0, 0, 0, 0)
  return { start: start.getTime(), end: start.getTime() + 86_400_000 }
}

/**
 * Replies generated today, including ones still streaming and ones the user
 * stopped: each one spent API credits. Regenerating counts; a request the API
 * refused does not.
 */
export async function repliesToday(db: D1Database, owner: string): Promise<number> {
  const { start } = utcDay()
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE owner_sub = ? AND role = 'assistant' AND created_at >= ?`)
    .bind(owner, start)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

/** A conversation title from its first message: the first line, cut at a word. */
export function titleFrom(content: string): string {
  const line = content.trim().split(/\r?\n/)[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (line.length <= 48) return line || 'New chat'
  const cut = line.slice(0, 48)
  const space = cut.lastIndexOf(' ')
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}
