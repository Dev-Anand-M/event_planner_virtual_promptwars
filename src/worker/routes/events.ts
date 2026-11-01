// Events: create, read, edit, delete, and apply plan edits. Everything is
// scoped by owner_sub, mutations are same-origin (auth middleware), and every
// field is validated and clamped here — the client supplies nothing the
// planner trusts blindly. The plan itself is built by shared/planner.ts.

import { Hono } from 'hono'

import { applyPlanEdit, applyToggle, buildPlan, cleanAmount, cleanText, parseISODate, rebuildPlan } from '../../shared/planner'
import type { EventKind, Plan, PlanEvent, PlanProposal, PlanToggle } from '../../shared/types'
import { privateJson } from '../auth'
import { id, now } from '../db'
import type { AppContext } from '../env'

export const events = new Hono<AppContext>()

const KINDS: EventKind[] = ['wedding', 'birthday', 'community']
const MAX_GUESTS = 10_000
const MAX_TOTAL = 10_000_000
const MAX_TITLE = 120
const MAX_CITY = 80
const MAX_DETAILS = 1_200
const DAY = 86_400_000
/** An event can be up to three years out (and never in the past). */
const MAX_LEAD_MS = 3 * 365 * DAY

type Row = Record<string, unknown>
type EventRow = Row & { plan: string }

export function eventFrom(row: Row): PlanEvent {
  const fallbackPlan = (total: number): Plan => ({ budget: { lines: [], total: Math.max(0, Math.round(total) || 0), stretched: false }, timeline: [], vendors: [], ideas: [], source: 'engine', updatedAt: 0 })
  let plan: Plan
  try {
    const parsed = JSON.parse((row.plan as string) ?? 'null') as Plan | null
    plan =
      parsed && typeof parsed === 'object' && Array.isArray(parsed?.budget?.lines) && Array.isArray(parsed?.timeline) && Array.isArray(parsed?.vendors)
        ? parsed
        : fallbackPlan(Number(row.budget_total))
  } catch {
    plan = fallbackPlan(Number(row.budget_total))
  }
  return {
    id: row.id as string,
    kind: row.kind as EventKind,
    title: row.title as string,
    date: row.event_date as string,
    city: (row.city as string) ?? '',
    guests: Number(row.guests),
    budgetTotal: Number(row.budget_total),
    details: (row.details as string) ?? '',
    plan,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export interface EventInput {
  kind: EventKind
  title: string
  date: string
  city: string
  guests: number
  budgetTotal: number
  details: string
}

/**
 * Validates create/edit input; returns the clean value or an error sentence.
 * Shared by POST and PATCH so the rules exist in exactly one place.
 */
export function validateEventInput(input: Record<string, unknown>, partial = false): { ok: true; value: Partial<EventInput> } | { ok: false; error: string } {
  const value: Partial<EventInput> = {}

  if (input.kind !== undefined || !partial) {
    if (!KINDS.includes(input.kind as EventKind)) return { ok: false, error: 'Choose a wedding, a birthday, or a community event.' }
    value.kind = input.kind as EventKind
  }
  if (input.title !== undefined || !partial) {
    const title = cleanText(input.title, MAX_TITLE)
    if (!title) return { ok: false, error: 'Give the event a name.' }
    value.title = title
  }
  if (input.date !== undefined || !partial) {
    const date = typeof input.date === 'string' ? input.date.slice(0, 10) : ''
    const ms = parseISODate(date)
    if (ms === null) return { ok: false, error: 'Pick a valid date (yyyy-mm-dd).' }
    if (ms < Math.floor(Date.now() / DAY) * DAY) return { ok: false, error: 'Pick a date that has not passed yet.' }
    if (ms > Date.now() + MAX_LEAD_MS) return { ok: false, error: 'Pick a date within the next three years.' }
    value.date = date
  }
  if (input.city !== undefined) value.city = cleanText(input.city, MAX_CITY)
  if (input.guests !== undefined || !partial) {
    const guests = Math.floor(cleanAmount(input.guests))
    if (guests < 1 || guests > MAX_GUESTS) return { ok: false, error: `Guests must be between 1 and ${MAX_GUESTS.toLocaleString()}.` }
    value.guests = guests
  }
  if (input.budgetTotal !== undefined || !partial) {
    const budget = cleanAmount(input.budgetTotal, MAX_TOTAL)
    if (budget < 100) return { ok: false, error: 'Set a budget of at least $100.' }
    value.budgetTotal = budget
  }
  if (input.details !== undefined) value.details = cleanText(input.details, MAX_DETAILS)
  return { ok: true, value }
}

/** A complete event input, when validation is known to have passed. */
function asFilled(value: Partial<EventInput>): EventInput {
  return { kind: value.kind ?? 'birthday', title: value.title ?? 'Untitled event', date: value.date ?? '', city: value.city ?? '', guests: value.guests ?? 1, budgetTotal: value.budgetTotal ?? 0, details: value.details ?? '' }
}

events.get('/', async (c) => {
  const rows = await c.get('db')
    .prepare(`SELECT * FROM events WHERE owner_sub = ? ORDER BY event_date ASC LIMIT 100`)
    .bind(c.get('user').sub)
    .all()
  return privateJson(c, { items: (rows.results as EventRow[]).map(eventFrom) })
})

events.post('/', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const check = validateEventInput(input)
  if (!check.ok) return c.json({ error: 'bad_input', message: check.error }, 400)
  const filled = asFilled(check.value)
  // The plan is never taken from the client: the engine builds it.
  const plan = buildPlan(filled)
  const eventId = id()
  const t = now()
  await db
    .prepare(
      `INSERT INTO events (id, owner_sub, kind, title, event_date, city, guests, budget_total, details, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(eventId, owner, filled.kind, filled.title, filled.date, filled.city, filled.guests, filled.budgetTotal, filled.details, JSON.stringify(plan), t, t)
    .run()
  const row = await db.prepare(`SELECT * FROM events WHERE owner_sub = ? AND id = ?`).bind(owner, eventId).first<EventRow>()
  return privateJson(c, { event: row ? eventFrom(row) : null }, 201)
})

events.get('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const eventId = c.req.param('id')
  const row = await db.prepare(`SELECT * FROM events WHERE owner_sub = ? AND id = ?`).bind(owner, eventId).first<EventRow>()
  if (!row) return c.json({ error: 'Not found.' }, 404)
  // The conversation bound to this event's plan chat, if one exists.
  const thread = await db
    .prepare(`SELECT id FROM conversations WHERE owner_sub = ? AND event_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(owner, eventId)
    .first<{ id: string }>()
  return privateJson(c, { event: eventFrom(row), threadId: thread?.id ?? null })
})

events.patch('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const eventId = c.req.param('id')
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const row = await db.prepare(`SELECT * FROM events WHERE owner_sub = ? AND id = ?`).bind(owner, eventId).first<EventRow>()
  if (!row) return c.json({ error: 'Not found.' }, 404)
  const existing = eventFrom(row)

  // Simple plan edits: toggle a milestone or vendor, drop a saved idea.
  if (body.toggle !== undefined) {
    if (typeof body.toggle !== 'object' || body.toggle === null) return c.json({ error: 'bad_input', message: 'Send a toggle like { milestone: 0 }.' }, 400)
    const { plan, applied } = applyToggle(existing, body.toggle as PlanToggle, now())
    if (!applied) return c.json({ error: 'bad_toggle', message: 'Nothing there to change.' }, 400)
    await db.prepare(`UPDATE events SET plan = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`).bind(JSON.stringify(plan), now(), owner, eventId).run()
    return privateJson(c, { event: { ...existing, plan } })
  }

  // Field edits: revalidate, rebuild the plan when its inputs changed.
  const check = validateEventInput(body, true)
  if (!check.ok) return c.json({ error: 'bad_input', message: check.error }, 400)
  const next: PlanEvent = { ...existing, ...check.value }
  const structureChanged =
    (check.value.kind !== undefined && check.value.kind !== existing.kind) ||
    (check.value.date !== undefined && check.value.date !== existing.date) ||
    (check.value.guests !== undefined && check.value.guests !== existing.guests) ||
    (check.value.budgetTotal !== undefined && check.value.budgetTotal !== existing.budgetTotal)
  const plan = body.rebuild === true || structureChanged ? rebuildPlan(next) : existing.plan
  plan.updatedAt = now()
  next.plan = plan
  await db
    .prepare(`UPDATE events SET kind = ?, title = ?, event_date = ?, city = ?, guests = ?, budget_total = ?, details = ?, plan = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`)
    .bind(next.kind, next.title, next.date, next.city, next.guests, next.budgetTotal, next.details, JSON.stringify(plan), now(), owner, eventId)
    .run()
  return privateJson(c, { event: next })
})

/**
 * Applies a plan proposal (from an assistant reply or the plan page). The
 * planner validates and clamps everything; raw model output never lands in
 * the plan unchecked.
 */
events.post('/:id/plan', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const eventId = c.req.param('id')
  const body = await c.req.json<{ proposal?: PlanProposal }>().catch(() => null)
  const proposal = body?.proposal
  if (!proposal || typeof proposal !== 'object') return c.json({ error: 'bad_input', message: 'Send a plan proposal.' }, 400)
  const row = await db.prepare(`SELECT * FROM events WHERE owner_sub = ? AND id = ?`).bind(owner, eventId).first<EventRow>()
  if (!row) return c.json({ error: 'Not found.' }, 404)
  const event = eventFrom(row)
  const hasAny = Array.isArray(proposal.insertBudgetLines) || Array.isArray(proposal.budgetLines) || Array.isArray(proposal.timeline) || Array.isArray(proposal.vendors) || Array.isArray(proposal.insertIdeas)
  if (!hasAny) return c.json({ error: 'bad_input', message: 'The proposal has nothing to apply.' }, 400)
  const plan = applyPlanEdit(event, proposal, now())
  await db.prepare(`UPDATE events SET plan = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`).bind(JSON.stringify(plan), now(), owner, eventId).run()
  return privateJson(c, { event: { ...event, plan } })
})

events.delete('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const eventId = c.req.param('id')
  await db.batch([
    // The event's chats go too: a conversation without its event loses its context anyway.
    db.prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id IN (SELECT id FROM conversations WHERE owner_sub = ? AND event_id = ?)`).bind(owner, owner, eventId),
    db.prepare(`DELETE FROM conversations WHERE owner_sub = ? AND event_id = ?`).bind(owner, eventId),
    db.prepare(`DELETE FROM events WHERE owner_sub = ? AND id = ?`).bind(owner, eventId),
  ])
  return privateJson(c, { ok: true, at: now() })
})
