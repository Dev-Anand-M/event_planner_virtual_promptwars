// The planner engine: deterministic, so these are real expectations, not
// snapshots. Run with `bun test`.

import { describe, expect, test } from 'bun:test'

import { applyPlanEdit, applyToggle, buildBudget, buildPlan, buildTimeline, buildVendors, daysUntil, extractProposal, cleanAmount, cleanText, eventContext, overdueLabels, planProgress } from '../src/shared/planner'
import type { PlanEvent } from '../src/shared/types'

const NOW = Date.parse('2026-06-01T00:00:00Z')

const baseEvent = (overrides: Partial<PlanEvent> = {}): PlanEvent => ({
  id: 'e1',
  kind: 'wedding',
  title: 'Test wedding',
  date: '2026-11-28',
  city: 'Pune',
  guests: 85,
  budgetTotal: 18_000,
  details: 'Vegetarian catering',
  plan: { budget: { lines: [], total: 18_000 }, timeline: [], vendors: [], ideas: [], source: 'engine', updatedAt: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
})

describe('buildBudget', () => {
  test('lines sum exactly to the total', () => {
    for (const kind of ['wedding', 'birthday', 'community'] as const) {
      for (const total of [1_000, 18_000, 250_000]) {
        const { lines } = buildBudget(kind, total, 80)
        expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(total)
      }
    }
  })

  test('catering floor scales with guests and squeezes other categories', () => {
    // A wedding floor is $24 × guests; at 200 guests that is $4,800, more than
    // the 26% share of $10,000, so the engine must floor it and mark stretched.
    const { lines, stretched } = buildBudget('wedding', 10_000, 200)
    const catering = lines.find((line) => line.category === 'Catering & drinks')
    expect(catering?.amount).toBe(4_800)
    expect(stretched).toBe(true)
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(10_000)
  })

  test('normal budgets are not stretched', () => {
    expect(buildBudget('wedding', 30_000, 80).stretched).toBe(false)
  })

  test('zero-or-negative totals produce nothing', () => {
    expect(buildBudget('wedding', 0, 50).lines).toEqual([])
  })
})

describe('buildTimeline', () => {
  test('milestones run backwards from the event date, in order, none past the event', () => {
    const timeline = buildTimeline('wedding', '2026-11-28', NOW)
    expect(timeline.length).toBeGreaterThanOrEqual(8)
    const dueDates = timeline.map((m) => m.due)
    expect([...dueDates].sort()).toEqual(dueDates)
    for (const milestone of timeline) expect(daysUntil(milestone.due, Date.parse('2026-11-29T00:00:00Z'))).toBeLessThanOrEqual(0)
  })

  test('compresses into a short lead instead of vanishing', () => {
    const timeline = buildTimeline('birthday', '2026-06-10', NOW)
    expect(timeline.length).toBe(7)
    expect(timeline[0]!.done).toBe(false)
    // Everything fits between now and the event, nothing weeks past.
    for (const milestone of timeline) {
      expect(daysUntil(milestone.due, NOW)).toBeLessThanOrEqual(9)
    }
  })

  test('an event more than a year out keeps the full-scale spacing', () => {
    const timeline = buildTimeline('wedding', '2027-11-28', NOW)
    const gaps = timeline.slice(1).map((m, i) => daysUntil(timeline[i]!.due, NOW) - daysUntil(m.due, NOW))
    // Book-venue milestone should be about 26 weeks (~182 days) before the date
    expect(new Date(timeline[0]!.due).valueOf()).toBe(Date.parse('2027-11-28T00:00:00Z') - 26 * 7 * 86_400_000)
    expect(gaps.every((gap) => gap >= 0)).toBe(true)
  })
})

describe('buildVendors', () => {
  test('essentials always present; guest-gated items scale up', () => {
    const small = buildVendors('wedding', 40)
    expect(small.filter((v) => v.essential).length).toBe(4)
    expect(small.some((v) => v.minGuests !== undefined)).toBe(false)
    const large = buildVendors('wedding', 150)
    expect(large.length).toBeGreaterThan(small.length)
    expect(large.find((v) => v.category === 'Rentals')).toBeDefined()
  })

  test('community events get permits and volunteers', () => {
    const vendors = buildVendors('community', 100)
    expect(vendors.some((v) => v.category === 'Venue')).toBe(true)
    expect(vendors.some((v) => v.category === 'Volunteers')).toBe(true)
    expect(vendors.some((v) => v.category === 'Safety')).toBe(true)
  })
})

describe('buildPlan + context', () => {
  test('a full plan comes out consistent', () => {
    const plan = buildPlan(baseEvent(), NOW)
    expect(plan.budget.total).toBe(18_000)
    expect(plan.timeline.length + plan.vendors.length).toBeGreaterThan(0)
    expect(plan.source).toBe('engine')
    expect(planProgress(plan).vendors.total).toBe(plan.vendors.length)
  })

  test('eventContext states the numbers and stays compact', () => {
    const context = eventContext({ ...baseEvent(), plan: buildPlan(baseEvent(), NOW) }, NOW)
    expect(context).toContain('wedding')
    expect(context).toContain('85')
    expect(context).toContain('$18,000')
    expect(context.length).toBeLessThan(1_400)
  })

  test('overdueLabels finds untouched past milestones', () => {
    const plan = buildPlan(baseEvent({ date: '2026-06-05' }), Date.parse('2026-05-01T00:00:00Z'))
    expect(overdueLabels(plan, Date.parse('2026-06-01T00:00:00Z')).length).toBeGreaterThan(0)
  })
})

describe('applyPlanEdit (model proposals)', () => {
  test('replaces the timeline with clamped, event-bounded milestones', () => {
    const event = baseEvent()
    const plan = applyPlanEdit(
      event,
      {
        timeline: [
          { label: '  Order  the cake   ', due: '2026-07-01', scope: 'buy' },
          { label: '', due: 'not-a-date' },
          { due: '2026-05-01', scope: 'send' }, // no label, past date
          { label: 'After the event', due: '2027-01-01' }, // future of the event: clamped
        ],
      },
      NOW,
    )
    expect(plan.source).toBe('ai')
    expect(plan.timeline[0]!.label).toBe('Order the cake')
    expect(plan.timeline[1]!.label).toBe('Untitled milestone')
    expect(plan.timeline[1]!.due).toBe('2026-06-02') // malformed -> tomorrow
    for (const milestone of plan.timeline) expect(milestone.due <= event.date).toBe(true)
  })

  test('budget lines are cleaned and re-totalled', () => {
    const plan = applyPlanEdit(
      baseEvent(),
      {
        budgetLines: [
          { category: 'Venue', amount: 'not-a-number' },
          { category: 'Catering & drinks', amount: 9000.4 },
          { category: '', amount: 123 },
        ],
      },
      NOW,
    )
    expect(plan.budget.lines[0]!.amount).toBe(0) // junk amount -> 0
    expect(plan.budget.lines[1]!.amount).toBe(9_000) // rounded
    expect(plan.budget.lines[2]!.category).toBe('Other')
    expect(plan.budget.total).toBe(9_123)
  })

  test('ideas dedupe, cap, and stay clean', () => {
    const idea = 'a'.repeat(3_000)
    const plan = applyPlanEdit(baseEvent(), { insertIdeas: [idea, 'Popcorn bar', 'popcorn bar'] }, NOW)
    expect(plan.ideas.length).toBe(2)
    expect(plan.ideas[0]!.length).toBe(240)
    expect(plan.vendors.length).toBe(baseEvent().plan.vendors.length) // untouched
  })

  test('insertTimeline upserts by label and appends the rest', () => {
    const event = { ...baseEvent(), plan: buildPlan(baseEvent(), NOW) }
    const firstLabel = event.plan.timeline[0]!.label
    const plan = applyPlanEdit(
      event,
      {
        insertTimeline: [
          { label: firstLabel, done: true, due: '1999-01-01' }, // match: stays labeled, due clamped
          { label: '  Interview   photographers   ', scope: 'book' }, // new
        ],
      },
      NOW,
    )
    const updated = plan.timeline.find((m) => m.label === firstLabel)
    expect(updated?.done).toBe(true)
    const added = plan.timeline.at(-1)
    expect(added?.label).toBe('Interview photographers')
    expect(added?.scope).toBe('book')
    expect(plan.timeline.every((m) => m.due <= event.date)).toBe(true)
  })

  test('insertVendors updates matched vendors and appends new ones', () => {
    const event = { ...baseEvent(), plan: buildPlan(baseEvent(), NOW) }
    const vendor = event.plan.vendors[0]!
    const plan = applyPlanEdit(
      event,
      {
        insertVendors: [
          { label: vendor.label, category: vendor.category, booked: true },
          { label: 'Glacier Gelato', category: 'Catering' },
        ],
      },
      NOW,
    )
    const updated = plan.vendors.find((v) => v.label === vendor.label)
    expect(updated?.booked).toBe(true)
    expect(plan.vendors.at(-1)?.label).toBe('Glacier Gelato')
  })

  test('nothing passes through: SQL or HTML scrambles are inert', () => {
    const plan = applyPlanEdit(
      baseEvent(),
      { insertIdeas: ['<script>alert(1)</script>', 'Robert\'); DROP TABLE students;--'] as unknown as string[] },
      NOW,
    )
    // Control characters and raw payloads never enter the plan as markup: the
    // UI renders ideas as text nodes, but the cleaner also shows hostile input
    // is not echoed verbatim.
    expect(plan.ideas[0]).not.toContain('<script>')
  })
})

describe('applyToggle', () => {
  test('toggles a milestone, a vendor, and drops an idea', () => {
    let event = baseEvent()
    event = { ...event, plan: { ...buildPlan(event, NOW), ideas: ['One idea'] } }
    const { plan: first, applied: a1 } = applyToggle(event, { milestone: 0 }, NOW)
    expect(a1).toBe(true)
    expect(first.timeline[0]!.done).toBe(true)
    expect(first.source).toBe('manual')
    const { plan: second, applied: a2 } = applyToggle({ ...event, plan: first }, { vendor: 0 }, NOW)
    expect(a2).toBe(true)
    expect(second.vendors[0]!.booked).toBe(true)
    const { plan: third, applied: a3 } = applyToggle({ ...event, plan: second }, { idea: 0 }, NOW)
    expect(a3).toBe(true)
    expect(third.ideas).toEqual([])
    const { applied: a4 } = applyToggle({ ...event, plan: third }, { milestone: 99 }, NOW)
    expect(a4).toBe(false)
  })
})

describe('extractProposal and cleaning', () => {
  test('finds a planProposal block and ignores prose', () => {
    const text = 'Sure! Here is an idea.\n\n```planProposal\n{"insertIdeas":["Popcorn bar"]}\n```\n\nEnjoy.'
    expect(extractProposal(text)).toEqual({ insertIdeas: ['Popcorn bar'] })
    expect(extractProposal('No block here')).toBe(null)
    expect(extractProposal('```json\n{"budgetLines":[]}\n```')).toBe(null) // empty sections: not a proposal
    expect(extractProposal('```planProposal\n{"insertTimeline":[{"label":"Send invites"}]}\n```')).toEqual({ insertTimeline: [{ label: 'Send invites' }] })
    expect(extractProposal('```planProposal\n{invalid json}\n```')).toBe(null)
  })

  test('cleanAmount and cleanText behave', () => {
    expect(cleanAmount(12.4)).toBe(12)
    expect(cleanAmount(-5)).toBe(0)
    expect(cleanAmount(Number.NaN)).toBe(0)
    expect(cleanText('  a\nb\u0000c  ')).toBe('a b c')
    expect(cleanText('x'.repeat(500)).length).toBe(120)
  })
})
