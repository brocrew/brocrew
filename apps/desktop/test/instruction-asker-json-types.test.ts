import { rmSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixtureDatabase, fixtureFolder } from './lib/host-fixture'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'

let folder: string
let db: ReturnType<typeof fixtureDatabase>
let store: ReturnType<typeof createSessionStore>
let ordinal: number
const owners = ['first', 'second']

beforeEach(() => {
  folder = fixtureFolder('instruction-id-types-')
  db = fixtureDatabase(folder)
  store = createSessionStore(db)
  ordinal = 100
  for (const id of owners)
    store.create({ id, provider: 'codex', cwd: folder, approvalMode: 'ask' })
})

afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

function append(owner: string, type: 'instruction_proposed' | 'instruction_settled', askId: unknown) {
  const event = type === 'instruction_proposed'
    ? { type, askId, ask: 'propose', about: 'target', proposedBy: owner, text: 'Fictional rule', why: 'Fictional reason' }
    : { type, askId, ending: 'approved' }
  db.prepare(`INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
    VALUES (?, ?, 0, ?, ?, ?, ?)`).run(`${owner}-${ordinal}`, owner, ordinal, type, JSON.stringify(event), ordinal)
  ordinal++
}

function expectCanonical(expected: string[], skipped: number) {
  const canonicalUnread = rowsUnreadOnce()
  const canonical = store.instructionAsksWaiting(canonicalUnread).map((one) => one.conversation)
  expect(canonical).toEqual(expected)
  expect(canonicalUnread.count).toBe(skipped)
  const projectedUnread = rowsUnreadOnce()
  expect(store.instructionAskersAmong(owners, projectedUnread)).toEqual(canonical)
  expect(projectedUnread.count).toBe(canonicalUnread.count)
  expect(projectedUnread.ledgersSkipped).toBe(canonicalUnread.ledgersSkipped)
}

const nonStrings = [
  { name: 'object', value: { part: 1 }, literal: '{"part":1}' },
  { name: 'array', value: [1, 2], literal: '[1,2]' },
  { name: 'null', value: null, literal: 'null' },
  { name: 'number', value: 12, literal: '12' },
  { name: 'boolean', value: false, literal: 'false' },
  { name: 'missing', value: undefined, literal: 'undefined' },
]

it('preserves canonical instruction IDs, unread rows and settlement ordering', () => {
  for (const { value, literal } of nonStrings) {
    db.prepare('DELETE FROM events').run()
    append('first', 'instruction_proposed', literal)
    append('second', 'instruction_proposed', value)
    expectCanonical(['first'], 1)
    append('second', 'instruction_settled', value)
    expectCanonical(['first'], 2)
    append('second', 'instruction_settled', literal)
    expectCanonical([], 2)
  }

  db.prepare('DELETE FROM events').run()
  append('first', 'instruction_proposed', '{"part":1}')
  append('second', 'instruction_proposed', '{"part":1}')
  append('first', 'instruction_proposed', '[1,2]')
  expectCanonical(['second', 'first'], 0)
  append('second', 'instruction_settled', '{"part":1}')
  append('first', 'instruction_proposed', '{"part":1}')
  expectCanonical(['first'], 0)
  append('second', 'instruction_settled', '[1,2]')
  expectCanonical([], 0)
})
