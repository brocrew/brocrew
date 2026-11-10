import type { DeleteVerdict } from '../../src/shared/conversation-archive'

export const NOTE = 'note:/homes/pm/memory/its-note.md'
export const RECOVERY =
  'The recovery copies in the data folder still hold its records until newer copies replace them.'
export const HISTORY = 'The prompt history in an agent’s folder isn’t changed.'

export const LISTED: Extract<DeleteVerdict, { ok: true }> = {
  ok: true,
  conversation: 'sess_root',
  name: 'W1 · Bakery website',
  helpers: [{ conversation: 'sess_helper', name: 'W1.1 · Photos' }],
  parts: [
    {
      id: 'records',
      kind: 'records',
      says: 'Its messages and pieces of work, with the same of the 1 helper below it: W1.1 · Photos.',
      conversation: 'sess_root',
      paths: [],
      bytes: null,
    },
    {
      id: 'files:sess_root',
      kind: 'provider-files',
      says: 'W1 · Bakery website’s transcript and what was kept for it (2 items).',
      conversation: 'sess_root',
      paths: ['/homes/pm/projects/p/root.jsonl', '/homes/pm/projects/p/root'],
      bytes: 3 * 1024 * 1024,
    },
    {
      id: NOTE,
      kind: 'memory-note',
      says: 'A memory note W1 · Bakery website wrote: “its-note” — what it learned',
      conversation: 'sess_root',
      paths: ['/homes/pm/memory/its-note.md'],
      bytes: 120,
    },
  ],
  ends: ['W1.1 · Photos is running: it is stopped first.'],
  stays: ['Copies of what it sent to other conversations stay in theirs.'],
  cannot: [HISTORY, RECOVERY],
}
