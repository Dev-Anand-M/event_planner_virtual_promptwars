// The planning engine. Everything here is deterministic and pure: give it an
// event and it gives the same plan every time, with no model call. The
// assistant then works *on* that plan, using its context; whenever the model
// proposes changes, they come back through these same functions, which clamp,
// validate, and refuse anything unsafe. That split — rules for structure,
// the model for specifics and ideas — is the app's core logic.
//
// Amounts are unitless numbers shown with a $ sign (see README assumptions).

import type { BudgetLine, EventKind, Milestone, MilestoneScope, Plan, PlanBudgetLineInput, PlanEvent, PlanMilestoneInput, PlanProposal, PlanToggle, PlanVendorInput, VendorItem } from './types'

// --- Budget -----------------------------------------------------------------

/** Share of the total each category gets, by event kind. Sums to 100. */
const BUDGET_WEIGHTS: Record<EventKind, { category: string; weight: number; note?: string }[]> = {
  wedding: [
    { category: 'Venue', weight: 32 },
    { category: 'Catering & drinks', weight: 26, note: 'Head-count driven' },
    { category: 'Attire', weight: 10 },
    { category: 'Photo & video', weight: 9 },
    { category: 'Decor & flowers', weight: 8 },
    { category: 'Music & entertainment', weight: 6 },
    { category: 'Cake', weight: 3 },
    { category: 'Stationery & favours', weight: 2 },
    { category: 'Buffer', weight: 4 },
  ],
  birthday: [
    { category: 'Food & drinks', weight: 27, note: 'Head-count driven' },
    { category: 'Venue or space', weight: 16 },
    { category: 'Decor & theme', weight: 13 },
    { category: 'Entertainment & games', weight: 13 },
    { category: 'Cake', weight: 10, note: 'Per-guest minimum' },
    { category: 'Photos & keepsakes', weight: 5 },
    { category: 'Goodie bags', weight: 4, note: 'One per guest' },
    { category: 'Buffer', weight: 12 },
  ],
  community: [
    { category: 'Venue & permits', weight: 18 },
    { category: 'Food & drinks', weight: 25, note: 'Head-count driven' },
    { category: 'Programme & speakers', weight: 15 },
    { category: 'Equipment & AV', weight: 12 },
    { category: 'Marketing & signage', weight: 10 },
    { category: 'Prizes & thank-yous', weight: 8, note: 'Gifts for volunteers' },
    { category: 'Insurance & safety', weight: 4 },
    { category: 'Buffer', weight: 8 },
  ],
}

/**
 * The smallest sensible spend for head-count-driven categories: per guest for
 * food and drink, plus flat minimums for things like a cake. When the naive
 * share falls below this, the engine floors it and squeezes the other
 * categories instead — a small budget for 200 guests cannot give catering the
 * same share as for 20.
 */
const MIN_SPEND: Record<EventKind, Record<string, { perGuest?: number; flat?: number }>> = {
  wedding: { 'Catering & drinks': { perGuest: 24 } },
  birthday: { 'Food & drinks': { perGuest: 12 }, Cake: { flat: 40 } },
  community: { 'Food & drinks': { perGuest: 8 } },
}

export const round = (n: number): number => Math.max(0, Math.round(n))

export interface BudgetResult {
  lines: BudgetLine[]
  /** True when per-guest floors squeezed the other categories below their normal share. */
  stretched: boolean
}

/** Builds the budget from the kind's shares, applying per-guest floors. */
export function buildBudget(kind: EventKind, total: number, guests: number): BudgetResult {
  const t = Math.max(0, round(total))
  const shares = BUDGET_WEIGHTS[kind]
  const floored: BudgetLine[] = []
  const others: { item: (typeof shares)[number]; amount: number }[] = []
  let floorSum = 0

  for (const item of shares) {
    const share = (t * item.weight) / 100
    const min = MIN_SPEND[kind][item.category]
    const needed = Math.max((min?.perGuest ?? 0) * guests, min?.flat ?? 0)
    if (needed > share) {
      floored.push({
        category: item.category,
        amount: round(Math.min(needed, t)),
        note: item.note ?? (min?.perGuest ? `At least $${min.perGuest} per guest` : `At least $${min?.flat}`),
      })
      floorSum += needed
    } else {
      others.push({ item, amount: share })
    }
  }

  // One floor kicking in already means the nominal shares no longer hold:
  // the budget is being stretched, and the UI says so.
  const stretched = floored.length > 0
  const rest = Math.max(0, t - floored.reduce((sum, line) => sum + line.amount, 0))
  const otherSum = others.reduce((sum, o) => sum + o.amount, 0) || 1
  let lines = [...floored, ...others.map((o) => ({ category: o.item.category, amount: (o.amount / otherSum) * rest, note: o.item.note }))]

  // Absurd budgets (a $100 wedding for 300 people still cannot deliver a
  // catering floor): scale everything back to fit. `stretched` stays true and
  // the UI shows the warning.
  const totalNow = lines.reduce((sum, line) => sum + line.amount, 0)
  if (totalNow > t && t > 0) lines = lines.map((line) => ({ ...line, amount: (line.amount / totalNow) * t }))

  lines = lines.map((line) => ({ ...line, amount: round(line.amount) })).filter((line) => line.amount > 0)

  // Make the lines sum to the total exactly (integer rounding drift goes to
  // the largest non-floor line, falling back to the largest), so the UI's
  // bars always add up and the floors keep their exact per-guest math.
  const drift = t - lines.reduce((sum, line) => sum + line.amount, 0)
  if (drift !== 0 && lines.length) {
    const flooredCats = new Set(floored.map((line) => line.category))
    const adjustable = lines.filter((line) => !flooredCats.has(line.category) || lines.length === flooredCats.size)
    const biggest = adjustable.reduce((a, b) => (b.amount > a.amount ? b : a))
    lines = lines.map((line) => (line === biggest ? { ...line, amount: Math.max(0, line.amount + drift) } : line))
  }
  return { lines, stretched }
}

// --- Timeline ---------------------------------------------------------------

/** When each milestone is due, in whole weeks before the event. Bigger = earlier. */
const TIMELINE_TEMPLATES: Record<EventKind, { label: string; scope: MilestoneScope; weeksBefore: number }[]> = {
  wedding: [
    { label: 'Set the guest list and budget, pick the date & venue', scope: 'book', weeksBefore: 26 },
    { label: 'Book caterer, photographer & officiant', scope: 'book', weeksBefore: 20 },
    { label: 'Book florist, music & transport', scope: 'book', weeksBefore: 14 },
    { label: 'Order attire and do first fitting', scope: 'buy', weeksBefore: 12 },
    { label: 'Book cake and decor rentals', scope: 'book', weeksBefore: 10 },
    { label: 'Send invitations, start RSVP tracking', scope: 'send', weeksBefore: 8 },
    { label: 'Final tastings, confirm all vendors', scope: 'confirm', weeksBefore: 4 },
    { label: 'Pass final head counts to caterers', scope: 'confirm', weeksBefore: 2 },
    { label: 'Pack bags, brief the wedding party, prepare cash for tips', scope: 'prep', weeksBefore: 1 },
  ],
  birthday: [
    { label: 'Fix the date, theme, guest list and budget', scope: 'book', weeksBefore: 8 },
    { label: 'Book venue or reserve the space', scope: 'book', weeksBefore: 6 },
    { label: 'Order the cake and book entertainment', scope: 'book', weeksBefore: 5 },
    { label: 'Send invitations', scope: 'send', weeksBefore: 4 },
    { label: 'Shop supplies, decor, and food', scope: 'buy', weeksBefore: 2 },
    { label: 'Confirm RSVPs and equipment', scope: 'confirm', weeksBefore: 1 },
    { label: 'Day-of setup', scope: 'prep', weeksBefore: 0 },
  ],
  community: [
    { label: 'Confirm cause, date and rough budget', scope: 'book', weeksBefore: 16 },
    { label: 'Reserve venue, start permit applications', scope: 'book', weeksBefore: 14 },
    { label: 'Recruit volunteer leads', scope: 'prep', weeksBefore: 11 },
    { label: 'Book speakers, performers, food', scope: 'book', weeksBefore: 9 },
    { label: 'Confirm insurance, first aid, AV', scope: 'confirm', weeksBefore: 7 },
    { label: 'Mail flyers, open registrations', scope: 'send', weeksBefore: 5 },
    { label: 'Send reminders, publish the programme', scope: 'confirm', weeksBefore: 2 },
    { label: 'Brief volunteers and run setup', scope: 'prep', weeksBefore: 1 },
  ],
}

const DAY = 86_400_000
const WEEK = 7 * DAY

/** ISO weekday-precision helper: whole dates only. */
export function toISODate(ms: number): string {
  const d = new Date(Math.floor(ms / DAY) * DAY)
  return d.toISOString().slice(0, 10)
}

export function parseISODate(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

export function daysUntil(dateISO: string, now = Date.now()): number {
  const ms = parseISODate(dateISO)
  if (ms === null) return -9999
  return Math.round((ms - Math.floor(now / DAY) * DAY) / DAY)
}

/**
 * Builds the timeline working backwards from the event date. When the event is
 * closer than the template's full window, milestones are scaled proportionally
 * into the time that actually exists and past items become overdue — a plan
 * for a party in two weeks is still a plan, just compressed.
 */
export function buildTimeline(kind: EventKind, dateISO: string, now = Date.now()): Milestone[] {
  const eventMs = parseISODate(dateISO)
  if (eventMs === null) return []
  const template = TIMELINE_TEMPLATES[kind]
  const maxWeeks = Math.max(...template.map((m) => m.weeksBefore))
  const leadDays = Math.max(0, (eventMs - now) / DAY)
  const scale = Math.min(1, leadDays / (maxWeeks * 7))

  const ordered = [...template].sort((a, b) => b.weeksBefore - a.weeksBefore)
  let previous = eventMs
  const milestones: Milestone[] = []
  for (const item of ordered) {
    if (item.weeksBefore === 0) continue // day-of milestones are pinned to the event itself below
    const due = Math.min(previous, eventMs - item.weeksBefore * WEEK * scale)
    previous = due
    milestones.push({ label: item.label, scope: item.scope, due: toISODate(due), done: false })
  }
  // Day-of setup, when the template has one, is always the event itself.
  const dayOf = template.find((m) => m.weeksBefore === 0)
  if (dayOf) milestones.push({ label: dayOf.label, scope: dayOf.scope, due: dateISO, done: false })
  return milestones.reverse()
}

// --- Vendors ----------------------------------------------------------------

interface VendorTemplate {
  category: string
  label: string
  essential: boolean
  note?: string
  /** Only include when the guest count passes this. */
  minGuests?: number
}

const VENDOR_TEMPLATES: Record<EventKind, VendorTemplate[]> = {
  wedding: [
    { category: 'Venue', label: 'Book the venue', essential: true, note: 'Do this first: everything keys off the date it sets' },
    { category: 'Catering', label: 'Caterer', essential: true, note: 'Ask for a per-guest quote by service style' },
    { category: 'Photography', label: 'Photographer', essential: true },
    { category: 'Officiant', label: 'Officiant', essential: true },
    { category: 'Music', label: 'DJ or live band', essential: false },
    { category: 'Flowers', label: 'Florist', essential: false },
    { category: 'Cake', label: 'Cake baker', essential: false },
    { category: 'Transport', label: 'Guest transport', essential: false },
    { category: 'Coordination', label: 'Day-of coordinator', essential: false, minGuests: 100 },
    { category: 'Rentals', label: 'Tables, chairs, linens', essential: false, minGuests: 80 },
  ],
  birthday: [
    { category: 'Venue', label: 'Book the venue or yard setup', essential: true },
    { category: 'Cake', label: 'Cake or dessert', essential: true },
    { category: 'Food', label: 'Caterer, food truck or potluck plan', essential: true },
    { category: 'Entertainment', label: 'Entertainer, games host or playlist kit', essential: false },
    { category: 'Decor', label: 'Decor for the theme', essential: false },
    { category: 'Photography', label: 'Photographer (worth it for a milestone age)', essential: false },
    { category: 'Rentals', label: 'Tables, chairs, or canopies', essential: false, minGuests: 30 },
  ],
  community: [
    { category: 'Venue', label: 'Venue confirmation and permits', essential: true },
    { category: 'Volunteers', label: 'Volunteer leads (setup, food, cleanup)', essential: true },
    { category: 'Insurance', label: 'Event insurance or venue policy check', essential: true },
    { category: 'Programme', label: 'Speakers, performers, activity hosts', essential: false },
    { category: 'Food', label: 'Food partner or ticketed vendors', essential: false },
    { category: 'AV', label: 'Sound, mics and screen', essential: false },
    { category: 'Safety', label: 'First-aid point', essential: false, minGuests: 60 },
    { category: 'Logistics', label: 'Parking or shuttle plan', essential: false, minGuests: 120 },
  ],
}

export function buildVendors(kind: EventKind, guests: number): VendorItem[] {
  return VENDOR_TEMPLATES[kind]
    .filter((vendor) => vendor.minGuests === undefined || guests >= vendor.minGuests)
    .map(({ minGuests: _gated, ...vendor }) => ({ ...vendor, booked: false }))
}

// --- Plan assembly ----------------------------------------------------------

export function buildPlan(event: Pick<PlanEvent, 'kind' | 'budgetTotal' | 'guests' | 'date'>, now = Date.now()): Plan {
  const budget = buildBudget(event.kind, event.budgetTotal, event.guests)
  return {
    budget: { lines: budget.lines, total: Math.max(0, round(event.budgetTotal)), stretched: budget.stretched },
    timeline: buildTimeline(event.kind, event.date, now),
    vendors: buildVendors(event.kind, event.guests),
    ideas: [],
    source: 'engine',
    updatedAt: now,
  }
}

/** Recalculates structure from the current event fields, starting over. */
export function rebuildPlan(event: PlanEvent, now = Date.now()): Plan {
  const plan = buildPlan(event, now)
  plan.ideas = event.plan?.ideas ?? [] // Ideas are the host's; structure is re-derived.
  return plan
}

// --- Context for the assistant ---------------------------------------------

const money = (n: number) => `$${round(n).toLocaleString('en-US')}`

export const KIND_LABELS: Record<EventKind, string> = {
  wedding: 'wedding',
  birthday: 'birthday party',
  community: 'community event',
}

/**
 * A compact, authoritative description of the event and plan, included in the
 * system prompt of every turn of the event's chat. Kept small because it is
 * sent with every request.
 */
export function eventContext(event: PlanEvent, now = Date.now()): string {
  const plan = event.plan
  const days = daysUntil(event.date, now)
  const when = days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === 1 ? '' : 's'} past`
  const lines: (string | false)[] = [
    'EVENT CONTEXT (authoritative; ground every number here and do not contradict it silently):',
    `Event: ${KIND_LABELS[event.kind]} · "${event.title}"`,
    `Date: ${event.date} (${when}) · City: ${event.city || 'unspecified'}`,
    `Guests: ${event.guests} · Total budget: ${money(plan.budget.total)}`,
    plan.budget.lines.length ? `Budget shares: ${plan.budget.lines.map((line) => `${line.category} ${money(line.amount)}`).join('; ')}` : '',
    plan.budget.stretched ? 'NOTE: the budget is stretched — per-guest floors needed more than the total allows. Treat costs as tight and look for value options.' : '',
    `Timeline: ${plan.timeline.filter((m) => m.done).length}/${plan.timeline.length} done.`,
    overdueLabels(plan, now).length ? `OVERDUE: ${overdueLabels(plan, now).slice(0, 4).join('; ')}` : '',
    `Next up: ${nextDue(plan) ?? 'nothing pending'}`,
    `Vendors booked: ${plan.vendors.filter((v) => v.booked).map((v) => v.category).join(', ') || 'none yet'}`,
    `Vendors still to book: ${plan.vendors.filter((v) => !v.booked).map((v) => v.label).join(', ') || 'none'}`,
    plan.ideas.length ? `Ideas kept: ${plan.ideas.slice(-8).join(' | ')}` : '',
    event.details ? `Host notes: ${event.details}` : '',
    `When your answer changes the plan, use the planProposal block. Do not restate this context back.`,
  ]
  return lines.filter(Boolean).join('\n')
}

// --- Safe edits -------------------------------------------------------------

const SCOPES: MilestoneScope[] = ['book', 'send', 'buy', 'confirm', 'prep']
const MAX_LINES = 20
const MAX_IDEAS = 12
const MAX_IDEA_CHARS = 240
const MAX_TEXT = 120

/** Sane text: control chars out, angle brackets out (defence in depth on
  * model-written text — the UI renders it as plain nodes, but history and
  * prompts treat this text as inert), whitespace collapsed, length capped. */
export function cleanText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[<>\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Finite, sensible amount: anything else becomes 0. */
export function cleanAmount(value: unknown, max = 10_000_000): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(0, round(n))) : 0
}

export const validScope = (value: unknown): value is MilestoneScope => SCOPES.includes(value as MilestoneScope)

/**
 * A due date an edit did not give (or a malformed one) lands tomorrow, and
 * never goes past the event itself.
 */
function clampDue(value: unknown, eventMs: number | null, now: number): string {
  const parsed = typeof value === 'string' ? parseISODate(value) : null
  let ms = parsed ?? Math.min(now + DAY, eventMs ?? now + DAY)
  if (eventMs !== null) ms = Math.min(ms, eventMs)
  return toISODate(ms)
}

function toMilestone(raw: PlanMilestoneInput, eventMs: number | null, now: number): Milestone {
  return {
    label: (cleanText(raw.label) || 'Untitled milestone').slice(0, 80),
    scope: validScope(raw.scope) ? raw.scope : 'prep',
    due: clampDue(raw.due, eventMs, now),
    done: raw.done === true,
  }
}

function toVendor(raw: PlanVendorInput): VendorItem {
  return {
    category: cleanText(raw.category) || 'Other',
    label: (cleanText(raw.label) || 'Untitled vendor').slice(0, 80),
    essential: raw.essential === true,
    booked: raw.booked === true,
    note: cleanText(raw.note, 200) || undefined,
  }
}

function toBudgetLine(raw: PlanBudgetLineInput): BudgetLine {
  return {
    category: cleanText(raw.category) || 'Other',
    amount: cleanAmount(raw.amount),
    note: cleanText(raw.note, 200) || undefined,
  }
}

/**
 * Applies a proposal from the model — or a manual edit — to a plan, returning
 * a new plan. Values are cleaned and clamped; unknown fields are dropped. A
 * full budgetLines replacement re-totals; listing replaces the whole section.
 */
export function applyPlanEdit(event: PlanEvent, proposal: PlanProposal, now = Date.now()): Plan {
  const plan: Plan = JSON.parse(JSON.stringify(event.plan)) as Plan
  const eventMs = parseISODate(event.date)

  if (Array.isArray(proposal.budgetLines)) {
    const lines = proposal.budgetLines.slice(0, MAX_LINES).map(toBudgetLine)
    if (lines.length) {
      plan.budget.lines = lines
      plan.budget.total = lines.reduce((sum, line) => sum + line.amount, 0)
      plan.budget.stretched = false // the host chose these lines: they define the budget now
    }
  }
  if (Array.isArray(proposal.insertBudgetLines)) {
    const lines = proposal.insertBudgetLines.slice(0, MAX_LINES).map(toBudgetLine)
    for (const line of lines) {
      const existing = plan.budget.lines.find((l) => l.category.toLowerCase() === line.category.toLowerCase())
      if (existing) existing.amount = line.amount
      else plan.budget.lines.push({ category: line.category, amount: line.amount, note: line.note })
    }
    if (!Array.isArray(proposal.budgetLines)) plan.budget.total = Math.max(plan.budget.total, plan.budget.lines.reduce((s, l) => s + l.amount, 0))
  }
  if (Array.isArray(proposal.timeline)) {
    const milestones = proposal.timeline.slice(0, MAX_LINES).map((raw) => toMilestone(raw, eventMs, now))
    if (milestones.length) plan.timeline = milestones
  }
  if (Array.isArray(proposal.insertTimeline)) {
    for (const raw of proposal.insertTimeline.slice(0, MAX_LINES)) {
      const label = (cleanText(raw.label) || '').toLowerCase()
      const existing = label && plan.timeline.find((m) => m.label.toLowerCase() === label)
      if (existing) {
        if (validScope(raw.scope)) existing.scope = raw.scope
        const rawDue = typeof raw.due === 'string' ? raw.due : undefined
        if (rawDue) existing.due = clampDue(rawDue, eventMs, now)
        if (raw.done === true) existing.done = true
      } else {
        plan.timeline.push(toMilestone(raw, eventMs, now))
      }
    }
    plan.timeline = plan.timeline.slice(0, MAX_LINES)
  }
  if (Array.isArray(proposal.vendors)) {
    const vendors = proposal.vendors.slice(0, MAX_LINES).map(toVendor)
    if (vendors.length) plan.vendors = vendors
  }
  if (Array.isArray(proposal.insertVendors)) {
    for (const raw of proposal.insertVendors.slice(0, MAX_LINES)) {
      const label = (cleanText(raw.label) || '').toLowerCase()
      const category = (cleanText(raw.category) || '').toLowerCase()
      const existing = label && plan.vendors.find((v) => (category ? v.category.toLowerCase() === category && v.label.toLowerCase() === label : v.label.toLowerCase() === label))
      if (existing) {
        if (raw.booked === true) existing.booked = true
        if (raw.essential === true) existing.essential = true
        const note = cleanText(raw.note, 200)
        if (note) existing.note = note
      } else {
        plan.vendors.push(toVendor(raw))
      }
    }
    plan.vendors = plan.vendors.slice(0, MAX_LINES)
  }
  if (Array.isArray(proposal.insertIdeas)) {
    for (const raw of proposal.insertIdeas) {
      const idea = cleanText(raw, MAX_IDEA_CHARS)
      if (idea && !plan.ideas.some((existing) => existing.toLowerCase() === idea.toLowerCase())) plan.ideas.push(idea)
    }
    plan.ideas = plan.ideas.slice(-MAX_IDEAS)
  }

  plan.source = 'ai'
  plan.updatedAt = now
  return plan
}

/** Toggle a milestone's done flag, a vendor's booked flag, or drop a saved idea. */
export function applyToggle(event: PlanEvent, toggle: PlanToggle, now = Date.now()): { plan: Plan; applied: boolean } {
  const plan: Plan = JSON.parse(JSON.stringify(event.plan)) as Plan
  if (typeof toggle.milestone === 'number' && Number.isInteger(toggle.milestone)) {
    const target = plan.timeline[toggle.milestone]
    if (target) {
      target.done = !target.done
      plan.source = 'manual'
      plan.updatedAt = now
      return { plan, applied: true }
    }
  }
  if (typeof toggle.vendor === 'number' && Number.isInteger(toggle.vendor)) {
    const target = plan.vendors[toggle.vendor]
    if (target) {
      target.booked = !target.booked
      plan.source = 'manual'
      plan.updatedAt = now
      return { plan, applied: true }
    }
  }
  if (typeof toggle.idea === 'number' && Number.isInteger(toggle.idea)) {
    if (toggle.idea >= 0 && toggle.idea < plan.ideas.length) {
      plan.ideas.splice(toggle.idea, 1)
      plan.source = 'manual'
      plan.updatedAt = now
      return { plan, applied: true }
    }
  }
  return { plan, applied: false }
}

// --- Reading the plan -------------------------------------------------------

/** Milestones whose due date has passed and which are not done. */
export function overdueLabels(plan: Plan, now = Date.now()): string[] {
  return plan.timeline.filter((m) => !m.done && (parseISODate(m.due) ?? Number.POSITIVE_INFINITY) <= now).map((m) => `${m.label} (due ${m.due})`)
}

/** The next not-done milestone, by due date. */
export function nextDue(plan: Plan): string | null {
  const next = plan.timeline.filter((m) => !m.done).sort((a, b) => (parseISODate(a.due) ?? 0) - (parseISODate(b.due) ?? 0))[0]
  return next ? `${next.label} (due ${next.due})` : null
}

export function planProgress(plan: Plan): { milestones: { done: number; total: number }; vendors: { booked: number; total: number } } {
  return {
    milestones: { done: plan.timeline.filter((m) => m.done).length, total: plan.timeline.length },
    vendors: { booked: plan.vendors.filter((v) => v.booked).length, total: plan.vendors.length },
  }
}

/**
 * Pulls a planProposal block out of an assistant reply, so the UI can offer
 * Apply. Returns null when the reply proposes nothing (or a malformed block —
 * the server validates again on apply either way).
 */
export function extractProposal(text: string): PlanProposal | null {
  if (!text) return null
  const matches = [...text.matchAll(/```(?:planProposal|json)\s*\n?([\s\S]*?)```/g)]
  for (const match of matches.toReversed()) {
    const body = match[1]
    if (!body || !/"/.test(body)) continue
    try {
      const parsed = JSON.parse(body) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
      const proposal = parsed as PlanProposal
      const hasAny =
        (Array.isArray(proposal.insertIdeas) && proposal.insertIdeas.length > 0) ||
        (Array.isArray(proposal.insertTimeline) && proposal.insertTimeline.length > 0) ||
        (Array.isArray(proposal.insertVendors) && proposal.insertVendors.length > 0) ||
        (Array.isArray(proposal.insertBudgetLines) && proposal.insertBudgetLines.length > 0) ||
        (Array.isArray(proposal.budgetLines) && proposal.budgetLines.length > 0) ||
        (Array.isArray(proposal.timeline) && proposal.timeline.length > 0) ||
        (Array.isArray(proposal.vendors) && proposal.vendors.length > 0)
      if (hasAny) return proposal
    } catch {
      /* incomplete or junk JSON: not a proposal */
    }
  }
  return null
}
