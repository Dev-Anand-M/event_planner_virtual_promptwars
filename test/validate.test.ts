// Input validation on the events route: the layer between the client (and,
// by extension, anything the model echoes back into forms) and the database.

import { describe, expect, test } from 'bun:test'

import { eventFrom, validateEventInput } from '../src/worker/routes/events'
import { cleanText } from '../src/shared/planner'

const good = { kind: 'wedding', title: 'Our wedding', date: '2026-12-19', city: 'Pune', guests: 85, budgetTotal: 18000, details: 'Vegan catering, one vendor already booked' }

describe('validateEventInput', () => {
  test('accepts a well-formed event', () => {
    const check = validateEventInput(good)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.value.kind).toBe('wedding')
  })

  test('requires kind, title, date, guests and budget on create', () => {
    for (const field of ['kind', 'title', 'date', 'guests', 'budgetTotal'] as const) {
      const input = { ...good }
      delete input[field]
      const check = validateEventInput(input)
      expect(check.ok).toBe(false)
    }
  })

  test('rejects bad kinds, past dates and out-of-range numbers', () => {
    expect(validateEventInput({ ...good, kind: 'corporate' }).ok).toBe(false)
    expect(validateEventInput({ ...good, date: '1999-01-01' }).ok).toBe(false)
    expect(validateEventInput({ ...good, date: '1999-01-01' })).toMatchObject({ ok: false })
    expect(validateEventInput({ ...good, guests: 0 }).ok).toBe(false)
    expect(validateEventInput({ ...good, guests: 200_000 }).ok).toBe(false)
    expect(validateEventInput({ ...good, budgetTotal: 5 }).ok).toBe(false)
    expect(validateEventInput({ ...good, date: 'next friday' }).ok).toBe(false)
  })

  test('partial edits allow empty optional fields but keep the rules', () => {
    expect(validateEventInput({ city: '<b>Boston</b>' }, true)).toEqual({ ok: true, value: { city: 'b Boston /b' } }) // markup tags are stripped from stored text
    expect(validateEventInput({ guests: -3 }, true).ok).toBe(false)
  })
})

describe('eventFrom (row mapping)', () => {
  test('recovers from corrupted plan JSON instead of throwing', () => {
    const event = eventFrom({ id: 'e1', kind: 'birthday', title: 'T', event_date: '2026-12-19', city: '', guests: 20, budget_total: 1_000, details: '', plan: '{not json', created_at: 1, updated_at: 1 })
    expect(event.plan.budget.total).toBe(1_000)
    expect(event.plan.timeline).toEqual([])
    expect(event.id).toBe('e1')
  })

  test('reads a stored plan back', () => {
    const plan = { budget: { lines: [{ category: 'Venue', amount: 500 }], total: 1_000 }, timeline: [], vendors: [], ideas: [], source: 'engine', updatedAt: 2 }
    const event = eventFrom({ id: 'e2', kind: 'birthday', title: 'T', event_date: '2026-12-19', city: '', guests: 20, budget_total: 1_000, details: '', plan: JSON.stringify(plan), created_at: 1, updated_at: 2 })
    expect(event.plan).toEqual(plan)
  })
})

describe('text hygiene everywhere', () => {
  test('cleanText strips control characters the way storage does', () => {
    expect(cleanText('a\u0007b')).toBe('a b')
    expect(cleanText('it\u2019s')).toBe('it’s') // typographic punctuation stays
  })
})
