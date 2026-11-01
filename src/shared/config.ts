// The product's configuration, shared by the Worker and the app. Most
// customisation happens here: the name, the assistant's instructions, which
// models people may pick, and the usage limits that protect the API credits.

export const BRAND = 'Gather'
export const TAGLINE = 'A planning copilot for weddings, birthdays, and community events.'

/** What the assistant is told before every conversation. */
export const SYSTEM_PROMPT = `You are ${BRAND}, an event-planning copilot. Each conversation belongs to one host and usually one event (a wedding, a birthday, or a community gathering). Your job is practical: make plans people can act on this week.

How you answer:
- Ground every number in the event context you are given (budget, guest count, date, city). Never contradict it silently; if data is missing, ask one short question.
- Be specific and usable: actual venue and vendor types to call, realistic unit prices, quantities (drinks, chairs, cake slices), and days-before milestones. Match prices to the guest count and the host's stated vibe.
- Keep budgets conservative: include head-count-driven quantities and a buffer for the things nobody remembers.
- Respect the event type: a 5-year-old's birthday, a 30th birthday, and a town fundraiser should never get the same advice.
- Keep answers compact. Use Markdown lists and short headings when it helps; no filler, no disclaimers.

When your answer proposes changes to the plan itself (budget lines, timeline milestones, vendors, or saved ideas), append one fenced code block so the app can offer to apply it:

\`\`\`planProposal
{"insertIdeas":["A popcorn machine instead of dessert tables is cheaper and doubles as a snack bar"]}
\`\`\`

Keep the block small: only sections that change, as the plan schema (insertBudgetLines, insertTimeline, insertVendors, insertIdeas). It must be valid JSON on one fence. Never mention the block in prose.`

/**
 * Models people may choose, in picker order. Ids are Groq model ids
 * (GET https://api.groq.com/openai/v1/models lists them). The Worker refuses
 * any model not in this list, so this is also the spending allowlist.
 * `streams` is the fallback when the API does not advertise capabilities.
 */
export const MODELS = [
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', description: 'Fastest and cheapest, for everyday planning', streams: true },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', description: 'Flagship: careful reasoning and writing', streams: true },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', description: 'Multilingual reasoning (preview)', streams: true },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'openai/gpt-oss-120b'

/** Per-user limits. Messages are counted per UTC day. */
export const DAILY_MESSAGE_LIMIT = 50
/** How much history goes to the model with each message. */
export const MAX_CONTEXT_MESSAGES = 24
export const MAX_MESSAGE_CHARS = 8_000
export const MAX_OUTPUT_TOKENS = 2_048

/** Shown on the empty (event-less) chat. */
export const SUGGESTIONS = [
  'Diary: create it first — plan a 30th-birthday party for 25 guests on a $900 budget',
  'My town fundraiser needs a vendor checklist — what do I book first?',
  'How can I cut $500 from a wedding budget without making it worse?',
  'Draft a friendly invitation message for a block-party potluck',
]

/** The Groq API, unless GROQ_BASE_URL says otherwise. */
export const GROQ_API_URL = 'https://api.groq.com/openai/v1'
/** Where the app's owner creates and funds an API key. */
export const GROQ_API_KEYS_URL = 'https://console.groq.com/keys'
