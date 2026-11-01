// A sample event (with its plan) and a chat bound to it, for the local
// development user, so the app has something to show before an API key is
// configured. It is only ever written in development mode (see routes/account.ts);
// real accounts start empty.

import { DEFAULT_MODEL } from '../shared/config'
import { buildPlan, extractProposal } from '../shared/planner'
import type { EventKind } from '../shared/types'
import { id, now, titleFrom } from './db'

const SEED_EVENT_ID = 'seed-event'
export const WELCOME_CONVERSATION_ID = 'seed-thread'

const KIND: EventKind = 'birthday'
const title = "Riya turns 30"
const date = new Date(now() + 42 * 86_400_000).toISOString().slice(0, 10)

const input = { kind: KIND, title, date, city: 'Bengaluru', guests: 28, budgetTotal: 1_200, details: 'Mixed ages, some vegetarian, she loves 90s Bollywood music.' }

const turn1Question = 'What should I book first for this party?'
const turn1Answer = `Book the **venue** first — it locks the date and everything else keys off it. With 28 guests and a $1,200 budget, look at a cafe or community hall rather than a restaurant table minimum; you should land under $350.

Next two, in order:

1. **Cake** — small bakeries need 5–7 days' notice, and a 2 kg cake feeds about 20.
2. **Food plan** — for 28 people at this budget, a home-order from your favourite neighborhood place usually beats formal catering.

The timeline tab has each of these as a milestone; remaining dates work backwards from ${date}.`
const turn2Question = 'Any ideas to make it feel special without spending much?'
const turn2Answer = `Three that fit a 90s-Bollywood theme on a small budget:

- **Cassette-printed banner** — print a "Top 30 of the 30 years" tracklist; costs about $15.
- **Antakshari opener** — split guests into two teams, one round after cake. Zero cost, gets mixed ages singing.
- **Polaroid wall** — ask each guest to pin a photo with Riya as they arrive; doubles as a gift.

Quoting one of these in the plan:

\`\`\`planProposal
{"insertIdeas":["Cassette-printed banner: 'Top 30 of the 30 years' tracklist, ~$15","Antakshari team round after cake — free, works for mixed ages","Polaroid wall as guests arrive — doubles as a gift book"]}
\`\`\`

Apply takes about a minute and keeps the ideas on the Ideas card of the plan. Need anything else?`

export function seedStatements(db: D1Database, owner: string) {
  // Dated yesterday, so it does not count toward today's replies.
  const start = now() - 26 * 60 * 60_000
  const eventPlan = buildPlan(input, start)
  // The proposal in the sample reply is already applied.
  const accepted = extractProposal(turn2Answer)
  const statements = [
    db
      .prepare(
        `INSERT INTO events (id, owner_sub, kind, title, event_date, city, guests, budget_total, details, plan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEED_EVENT_ID,
        owner,
        KIND,
        title,
        date,
        input.city,
        input.guests,
        input.budgetTotal,
        input.details,
        JSON.stringify(accepted ? { ...eventPlan, ideas: ['Cassette-printed banner: \'Top 30 of the 30 years\' tracklist, ~$15', 'Antakshari team round after cake — free, works for mixed ages', 'Polaroid wall as guests arrive — doubles as a gift book'], source: 'ai', updatedAt: start } : eventPlan),
        start,
        start,
      ),
    db
      .prepare(`INSERT INTO conversations (id, owner_sub, title, model, event_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(WELCOME_CONVERSATION_ID, owner, titleFrom(turn1Question), DEFAULT_MODEL, SEED_EVENT_ID, start, start + 2 * 60_000),
  ]
  const turns: [string, string][] = [
    [turn1Question, turn1Answer],
    [turn2Question, turn2Answer],
  ]
  turns.forEach(([question, answer], i) => {
    const at = start + i * 2 * 60_000
    statements.push(
      db
        .prepare(`INSERT INTO messages (id, owner_sub, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, 'user', ?, NULL, ?)`)
        .bind(id(), owner, WELCOME_CONVERSATION_ID, question, at),
      db
        .prepare(`INSERT INTO messages (id, owner_sub, conversation_id, role, content, model, interrupted, created_at) VALUES (?, ?, ?, 'assistant', ?, ?, 0, ?)`)
        .bind(id(), owner, WELCOME_CONVERSATION_ID, answer, DEFAULT_MODEL, at + 9_000),
    )
  })
  return statements
}
