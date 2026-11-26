import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { eventTrimWriter, trimOldEvents } from '../src/main/db/event-retention'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const folder = mkdtempSync(join(tmpdir(), 'fictional-chatter-rule-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 26)
const OLD = NOW - 10 * DAY
const NEW = NOW - 60_000

const chatter = (label: string, raw: object, extra: object = {}) =>
  JSON.stringify({
    type: 'unknown',
    provider: 'codex',
    category: 'lifecycle',
    label,
    raw,
    ...extra,
  })
const claude = (label: string, category: string, raw: object) =>
  JSON.stringify({ type: 'unknown', provider: 'claude', category, label, raw })
const echo = (text: string, parts?: object[]) =>
  JSON.stringify({
    type: 'unknown',
    provider: 'codex',
    category: 'echo',
    label: 'userMessage',
    raw: { type: 'userMessage', content: parts ?? [{ type: 'text', text, text_elements: [] }] },
  })
const warning = (message: string, extra: object = {}) =>
  JSON.stringify({ type: 'error', message, fatal: false, ...extra })
const input = (sent: string, text = 'Example ask') =>
  JSON.stringify({ type: 'user_turn', text, sent })
const check = (output: object) => ({
  params: {
    metadata: {
      prompt: { omnimod: { protection_type: 'omnimod', outputs: [output] } },
      generation: {},
      tool_call: {},
      tool_response: {},
    },
  },
})
const clear = { results: [{ category_flags: { A1: false } }], is_blocked: false }
const passed = check(clear)
const blocked = check({ results: [], is_blocked: true })

/** id → [turn, payload, at], oldest first. Everything from `in-4` on is the newest turn. */
const ROWS: [string, string | null, string, number][] = [
  ['in-1', 't1', input('First fictional message.'), OLD],
  ['echo-1', 't1', echo('First fictional message.'), OLD],
  [
    'close-1',
    't1',
    warning('codex is approaching its rate limit — 90% of a 7-day window used'),
    OLD,
  ],
  [
    'signed-out',
    't1',
    JSON.stringify({ type: 'error', message: 'Sign in again.', fatal: true }),
    OLD,
  ],
  [
    'reconnect-fatal',
    't1',
    JSON.stringify({ type: 'error', message: 'Reconnecting... 5/5', fatal: true }),
    OLD,
  ],
  ['in-2', 't2', input('Second fictional message.'), OLD],
  ['echo-2', 't2', echo('Second message, changed by the provider.'), OLD],
  ['echo-2-image', 't2', echo('', [{ type: 'image', url: 'x' }]), OLD],
  [
    'echo-2-spans',
    't2',
    echo('', [{ type: 'text', text: 'Second fictional message.', text_elements: [{ start: 0 }] }]),
    OLD,
  ],
  ['mod-ok-1', 't2', chatter('turn/moderationMetadata', passed), OLD],
  ['mod-blocked', 't2', chatter('turn/moderationMetadata', blocked), OLD],
  ['mod-unreadable', 't2', chatter('turn/moderationMetadata', { params: { metadata: {} } }), OLD],
  [
    'server-failed',
    't2',
    chatter('mcpServer/startupStatus/updated', { params: { status: 'failed' } }),
    OLD,
  ],
  ['usage-1', 't2', chatter('account/rateLimits/updated', { params: { usedPercent: 40 } }), OLD],
  ['in-3', 't3', input('Example ask', 'Third fictional message.'), OLD],
  ['echo-3-shown-only', 't3', echo('Third fictional message.'), OLD],
  ['usage-2', 't3', chatter('account/rateLimits/updated', { params: { usedPercent: 60 } }), NEW],
  ['degraded', 't3', chatter('skills/changed', { params: {} }, { degradedFrom: 'status' }), OLD],
  [
    'other-category',
    't3',
    JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      label: 'skills/changed',
      raw: { params: {} },
    }),
    OLD,
  ],
  [
    'unlabelled',
    't3',
    JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'lifecycle',
      raw: { type: 'skills/changed' },
    }),
    OLD,
  ],
  ['inherited', 't3', chatter('constructor', { params: {} }), OLD],
  ['probe', 't3', chatter('a/kind/never/seen', { params: {} }), OLD],
  [
    'command-done',
    't3',
    claude('command_lifecycle', 'lifecycle', { type: 'command_lifecycle', state: 'completed' }),
    OLD,
  ],
  [
    'command-cancelled',
    't3',
    claude('command_lifecycle', 'lifecycle', { type: 'command_lifecycle', state: 'cancelled' }),
    OLD,
  ],
  [
    'command-started',
    't3',
    claude('command_lifecycle', 'lifecycle', { type: 'command_lifecycle', state: 'started' }),
    OLD,
  ],
  [
    'mod-outside',
    't3',
    chatter('turn/moderationMetadata', { params: { is_blocked: false, metadata: {} } }),
    OLD,
  ],
  [
    'echo-annotated',
    't3',
    JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'echo',
      label: 'userMessage',
      raw: {
        type: 'userMessage',
        content: [{ type: 'text', text: 'Example ask', text_elements: [] }],
        annotation: 'x',
      },
    }),
    OLD,
  ],
  ['reading-labelled', 't3', chatter('account/updated', { params: { planType: 'example' } }), OLD],
  [
    'reading-unlabelled',
    't3',
    JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'lifecycle',
      raw: { type: 'account/updated' },
    }),
    OLD,
  ],
  ['reading-malformed', 't3', chatter('account/updated', null as unknown as object), OLD],
  [
    'mod-unreadable-sibling',
    't3',
    chatter('turn/moderationMetadata', {
      params: {
        metadata: {
          ...check(clear).params.metadata,
          prompt: {
            omnimod: { protection_type: 'omnimod', outputs: [clear, { error: 'unavailable' }] },
          },
        },
      },
    }),
    OLD,
  ],
  [
    'mod-nothing-ran',
    't3',
    chatter('turn/moderationMetadata', {
      params: { metadata: { prompt: {}, generation: {}, tool_call: {}, tool_response: {} } },
    }),
    OLD,
  ],
  [
    'echo-structured-client',
    't3',
    JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'echo',
      label: 'userMessage',
      raw: {
        type: 'userMessage',
        clientId: { tag: 'x' },
        content: [{ type: 'text', text: 'Example ask', text_elements: [] }],
      },
    }),
    OLD,
  ],
  ['mod-ok-2', 't3', chatter('turn/moderationMetadata', passed), NEW],
  [
    'server-ready',
    't3',
    chatter('mcpServer/startupStatus/updated', { params: { status: 'ready' } }),
    NEW,
  ],
  ['usage-3', 't3', chatter('account/rateLimits/updated', { params: { usedPercent: 76 } }), NEW],
  ['stall-1', 't3', warning('Still thinking (2 min).', { stall: true, thinking: true }), NEW],
  [
    'close-2',
    't3',
    warning('codex is approaching its rate limit — 95% of a 7-day window used'),
    NEW,
  ],
  ['stall-2', 't3', warning('still working — no activity for 120s.', { stall: true }), NEW],
  [
    'given-4',
    't3',
    JSON.stringify({ type: 'work_given', piece: 'work_example', label: 'W1.1' }),
    NEW,
  ],
  ['skills-after-give', 't3', chatter('skills/changed', { params: {} }), NEW],
  ['in-4', 't4', input('Fourth fictional message.'), NEW],
  ['echo-4', 't4', echo('Fourth fictional message.'), NEW],
  ['mod-ok-4', 't4', chatter('turn/moderationMetadata', passed), NEW],
]

function aWorkspace(name: string): string {
  const file = join(folder, name)
  const db = openDatabase(file)
  applyMigrations(db, migrations)
  db.prepare(
    `INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at)
    VALUES ('c', 'codex', '/', 'idle', 0, 0)`,
  ).run()
  const turn = db.prepare(`INSERT INTO turn (id, session_id, ordinal, prompt, opened_at)
    VALUES (?, 'c', ?, 'Example ask', 0)`)
  ;['t1', 't2', 't3', 't4'].forEach((id, n) => turn.run(id, n))
  const event =
    db.prepare(`INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id)
    VALUES (?, 'c', ?, ?, ?, ?, ?)`)
  db.transaction(() =>
    ROWS.forEach(([id, turnId, payload, at], ordinal) =>
      event.run(id, ordinal, JSON.parse(payload).type, payload, at, turnId),
    ),
  )()
  db.close()
  return file
}

const REMOVED = [
  'echo-1',
  'close-1',
  'mod-ok-1',
  'usage-1',
  'usage-2',
  'command-done',
  'mod-ok-2',
  'server-ready',
  'stall-1',
  'mod-nothing-ran',
]

it('removes only the decided routine forms, at any age, and nothing recovery reads', async () => {
  const file = aWorkspace('selected.sqlite')
  const selected: string[] = []
  const anyAge: string[] = []
  const result = await trimOldEvents(
    file,
    () => false,
    async (batch) => {
      selected.push(...batch.ids)
      anyAge.push(...(batch.atAnyAge ?? []))
      return { changed: batch.ids.length, durationMs: 0 }
    },
    NOW,
  )
  expect(selected.sort()).toEqual([...REMOVED].sort())
  expect(anyAge.sort()).toEqual([...REMOVED].sort())
  expect(result.chatterSelected).toEqual({
    'codex userMessage': 1,
    'codex turn/moderationMetadata': 3,
    'codex mcpServer/startupStatus/updated': 1,
    'codex account/rateLimits/updated': 2,
    'claude command_lifecycle': 1,
    'warning usage close': 1,
    'warning still working': 1,
  })
})

it('deletes those rows however recent they are, and leaves everything else', async () => {
  const file = aWorkspace('deleted.sqlite')
  const db = openDatabase(file)
  try {
    const write = eventTrimWriter(db)
    const result = await trimOldEvents(
      file,
      () => false,
      async (batch) => write(batch),
      NOW,
    )
    expect(result.removed).toBe(REMOVED.length)
    const left = (
      db.prepare('SELECT id FROM events ORDER BY ordinal').all() as { id: string }[]
    ).map((row) => row.id)
    expect(left).toEqual(ROWS.map(([id]) => id).filter((id) => !REMOVED.includes(id)))
  } finally {
    db.close()
  }
})
