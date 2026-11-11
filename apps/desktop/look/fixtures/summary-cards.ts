const NOW = Date.now()
const MIN = 60_000

const EVENTS: unknown[] = [
  {
    type: 'user_turn',
    text: 'Note from Ada: the header mockup is ready for review. I kept the logo left and moved the menu to the right.',
    relayedFrom: 'sess_ada',
    relayedFromProfile: 'designer',
  },
  { type: 'status', state: 'working' },
  { type: 'assistant_message', text: 'Thanks, Ada. I checked the header against the brief: it fits.' },
  { type: 'command_summary', description: 'Ran pnpm test on the header: 42 passed.' },
  {
    type: 'turn_summary',
    status: 'completed',
    detail: 'Reviewed the header mockup and replied to Ada',
    needsAction: '',
  },
  { type: 'turn', state: 'completed' },
  { type: 'status', state: 'idle' },
  {
    type: 'error',
    message: 'claude is approaching its rate limit (five_hour) — 91% used',
    fatal: false,
  },
  {
    type: 'user_turn',
    text: 'Note from Ali: the contact form sends now. Can you check the error messages?',
    relayedFrom: 'sess_ali',
    relayedFromProfile: 'developer',
  },
  { type: 'status', state: 'working' },
  { type: 'assistant_message', text: 'The error messages read well. One typo fixed in “adress”.' },
  {
    type: 'turn_summary',
    status: 'completed',
    detail: 'Checked the contact form errors and fixed one typo',
    needsAction: '',
  },
  { type: 'turn', state: 'completed' },
  { type: 'status', state: 'idle' },
]

export const SUMMARY_CARD_EVENTS: readonly [unknown, number][] = EVENTS.map((event, index) => [
  event,
  NOW - (EVENTS.length - index) * MIN,
])
