# Gather — a GenAI planning assistant for events

Gather helps one host plan one gathering — a **wedding**, a **birthday**, or a
**community event** — with budgets, timelines, vendor checklists, and
personalised ideas. It is a chat assistant that plans against real numbers
instead of generic advice: it knows your guest count, your budget, your date,
and what is already booked, and every answer is grounded in that.

> **Chosen challenge vertical:** event planning (weddings, birthdays, community events).

Each event holds a deterministic, rule-computed **plan**:

- **Budget** — category shares by event kind, with per-guest floors for
  head-count-driven categories (catering cannot be 26% for 200 guests and $150).
- **Timeline** — milestones computed backwards from the event date and
  compressed proportionally when the date is close.
- **Vendor checklist** — the vendor types that kind of event needs, scaled by
  guest count, with essentials first.
- **Ideas** — suggestions the assistant made and the host chose to keep.

The assistant chat is bound to that plan. It receives a compact context digest
on every turn, proposes changes in a structured block, and those changes are
validated and applied through the same rule engine — never raw.

## Approach and logic

The core split is **rules for structure, the model for specifics**:

1. **A rule engine builds the plan** (`src/shared/planner.ts`, pure functions,
   no model calls). Given kind/date/guests/budget it always produces the
   same budget shares, timeline dates and vendor list. This is the "logical
   decision making based on user context": it is testable, transparent, and
   cannot hallucinate arithmetic.

   Examples of the encoded logic:
   - *budget floors:* head-count categories get a sensible minimum per guest
     (`MIN_PER_GUEST`). If floors exceed the total, the plan is flagged
     `stretched` (shown in the UI as "Budget is tight") and everything is
     proportionally scaled to fit — the app never pretends an unrealistic
     budget works.
   - *timeline compression:* milestones are defined in weeks-before; the lead
     time is measured against the host's chosen date and scaled, so a party in
     two weeks gets the same milestones with everything compressed instead of
     silently dropped, and already-past items appear as **overdue**.
   - *checklist scale:* vendor templates carry `minGuests` gates (rentals at
     30+, day-of coordinator at 100+, first aid at 60+ guests).

2. **The assistant plans against that plan.** Conversations can be bound to an
   event; on every turn the Worker emits a compact `EVENT CONTEXT` block
   (kind, date and countdown, guests, budget with shares, overdue/next
   milestones, booked vendors, host notes) into the system prompt
   (`src/worker/routes/chat.ts`). The model is instructed to ground numbers in
   it and never contradict it silently — the context is marked authoritative.

3. **Model output is proposed, validated, then applied.** When a reply changes
   the plan, the model appends one fenced `planProposal` JSON block. The UI
   parses it (`extractProposal`) and shows an *Apply* card; applying goes
   through `POST /api/events/:id/plan`, where `applyPlanEdit` cleans and clamps
   every value (text length caps, control-character stripping, numeric
   clamps, due-date clamping to the event window, list-size caps) before it
   touches the stored plan. Raw model output never lands in the plan
   unchecked, and the host sees exactly which sections a proposal rewrites
   before choosing to apply it.

## How it works

- **Stack:** React + TypeScript + Tailwind on Vite, a Hono Worker handling
  `/api/*`, D1 for storage, deployed on Cloudflare (Freebuff Sites). The LLM
  is called by the Worker through Groq's OpenAI-compatible API;
  streaming replies are server-sent events.
- **Models:** the Worker calls `/chat/completions` with the app's key from
  `GROQ_API_KEY`; the browser never sees credentials. The picker allowlists
  GPT-OSS 20B, GPT-OSS 120B and Qwen 3.8 27B (openai/gpt-oss-20b,
  openai/gpt-oss-120b, qwen/qwen3.8-27b on Groq).
- **Event flow:** create an event (type, name, date, guests, budget, city,
  notes) → the server builds the plan → the event page shows the plan panels
  and an event-bound chat. Toggle milestones/vendors, drop saved ideas,
  edit details (structure edits recalculate), and ask the assistant for what
  the rules cannot know: venue types, quantities, invitations, day-of runs.
- **Proposal flow:** the assistant writes prose plus an optional planProposal
  block → the UI offers *Apply* → the server validates/clamps → the plan and
  the budget bars update.

## Assumptions

Documented simplifications, on purpose:

1. **Currency is display-level:** amounts are unitless numbers rendered with a
   `$` sign; a real product would carry a currency field.
2. **Per-guest floors are fixed constants**, not live market prices. They are
   initial reasoning defaults for the assistant to refine, not quotes.
3. **"Essential" vendor flags** are rule-set opinions (what can ruin the event),
   not contractual requirements; officiant/police permits are examples of
   region-specific items left to the assistant's answers.
4. **One host per event** (the signed-in owner). Collaboration, RSVPs and
   guest-level data capture are out of scope.
5. **The daily reply cap (50/user/day)** is a spending protection, not a
   product decision.
6. **The model proposal is one-shot replace-per-section.** Applying rewrites
   the budget lines, timeline, or vendor list as a whole; fine-grained diffs
   were traded for validation simplicity and an auditable whole-section change.
7. **Event dates are UTC-precision** (no time-of-day scheduling).
8. **Development mode** (loopback-only, no `FREEBUFF_CLIENT_ID`) signs in a local
   user and seeds a sample event + conversation; deployed it is off and Sign in
   with Freebuff is required.

## Running and Deploying

### Deploying on Vercel

The repository is configured with `vercel.json` and a serverless API handler in `api/index.ts`:

1. Import the repository in [Vercel](https://vercel.com/new).
2. Framework preset is automatically detected as **Vite** (output directory: `dist`).
3. Add your environment variable in Vercel project settings:
   - `GROQ_API_KEY`: Your Groq API key (from https://console.groq.com/keys).
4. Click **Deploy**.

Vercel serves the built client assets statically and routes /api/* to the serverless function in `api/index.ts`, backed by a lightweight SQLite persistence shim and demo host user for immediate hackathon evaluation.

### Local Development

```sh
bun install
bun run dev        # http://localhost:5173
bun test           # planner-engine, validation, and Vercel integration tests
bun run typecheck
bun run build      # production build (dist/ + Cloudflare Worker bundle)
```

Until an API key is configured the app shows a setup card, and it unlocks on
its own once `GROQ_API_KEY` exists. Get a free key at
https://console.groq.com/keys. The key lives in `.env` (git-ignored) locally
and in Sites → Secrets when deployed; it is only read by the Worker.

## Security

- The API key is read in the Worker only (`src/worker/ai.ts`) and never sent to
  the browser, logged, or stored in D1.
- Every `/api/*` route requires a signed-in user, is scoped by `owner_sub`, and
  mutations are same-origin (`src/worker/auth.ts`). Personalised responses are
  `Cache-Control: private, no-store`.
- All input is validated and clamped server-side (`validateEventInput`,
  `applyPlanEdit`): type checks, range checks, text caps, control-character
  stripping, model-proposal sanitising.
- Model output cannot inject markup: `react-markdown` renders no raw HTML,
  links are scheme-checked (`http(s)`, `mailto`) and `noopener noreferrer`,
  plan proposals are JSON-only and re-validated at the server boundary.
- Models are allowlisted server-side (`MODELS`); message sizes, context
  history and output tokens are capped, with a per-user daily reply limit and
  an inflight guard per user.

## Efficiency

- Event context is a compact digest (not full plan JSON) and stays under
  ~1.4k characters even with a full plan, so every turn's prompt cost is small.
- Plans are built and stored once, recomputed only on structural edits.
- Model capabilities (`/models`) are cached per isolate for 10 minutes, plus an
  inflight dedup, so repeated turns don't re-fetch.
- The daily limit, `MAX_CONTEXT_MESSAGES`, and `MAX_OUTPUT_TOKENS` bound each
  request; streaming keeps responses perceived-fast without extra traffic.
- React Query caches by `['event', id]` / `['conversation', id]` so toggles
  update one cached object instead of refetching pages.

## Accessibility

- Semantic structure (`header`/`section`/`list` with headings tied by
  `aria-labelledby`), real `<input type="checkbox">` controls for plan toggles,
  labels on every form field.
- The plan/chat pane switch is a `role="tablist"` with `aria-selected`; its
  buttons are keyboard-focusable.
- Status text (`aria-live="polite"`) for the composer; toasts replace alerts;
  dialogs close on Escape and restore focus.
- Contrast comes from the palette (dark foreground `#1b1a17` on `#f7f6f2`); no
  colour-only states (overdue items pair colour with a struck-through label
  and a date).

## Testing

`bun test` keeps deterministic expectations on the pure engine:

- budget lines always sum to the total, floors apply and flag stretched budgets,
- timelines run backwards, stay sorted, compress on short leads and never pass
  the event date,
- vendor gating by guest count,
- proposal/edge-case handling: malformed JSON instances, hostile strings,
  junk numbers, due-date clamping, dedupe/caps,
- event input validation and corrupted-plan-JSON recovery.

The chat plumbing (limits, SSE, regeneration) is covered by the unchanged
template behaviour plus server-side defensive checks described above.

## What is deliberately not here

Payments, region-specific permit integrations, real vendor search/booking, RSVP
collection, collaborative editing, and timezone-aware scheduling. They are the
next steps, in that order: the proposal pipeline (rules-in, validated-model
changes-out) is designed so that external vendor/price lookup could replace
the fixed floors without changing the UI contract.
"# event_planner_virtual_promptwars" 
