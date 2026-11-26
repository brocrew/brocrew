import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { migrationsFolder } from './scheduled-jobs-clock-fixture'

/* ══════════════════ what the ledger says, read off the real store ══════════════════ */

describe('D-029 · what the ledger says a conversation scheduled', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let warn: MockInstance<typeof console.warn>
  let clock: number
  const tick = (): number => clock++
  const ordinals = new Map<string, number>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wakeup-ledger-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000
    store = createSessionStore(db, tick)
    ordinals.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: userData, approvalMode: 'ask', profileId: 'agent' })
    return id
  }
  const append = (id: string, event: Record<string, unknown>, at: number): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event as unknown as TranscriptEvent, at)
  }
  const lists = (id: string, jobs: Record<string, unknown>[], at: number): void =>
    append(id, { type: 'scheduled_work', jobs, source: 'test' }, at)
  /** A row whose payload is written raw, as a torn or short one is: ordinals past any real one. */
  const rawLevel = (id: string, ordinal: number, payload: string, at: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'scheduled_work', ?, ?)`,
    ).run(`evt_${id}_${String(ordinal)}`, id, ordinal, payload, at)
  }

  it("a wake-up is built from each conversation's newest level: an emptied level hides an older one, and a torn one costs only its own conversation", () => {
    // The control: a store that holds no conversation reads nothing.
    expect(store.newestScheduleLevels()).toEqual([])

    const nightly = { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly' }
    const once = { id: 'j2', schedule: '30 4 28 9 *', recurring: false }
    // keeps: a level, a compaction, a newer level that adds a job, a newer compaction.
    conversation('sess_keeps')
    lists('sess_keeps', [nightly], 100)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 150)
    lists('sess_keeps', [nightly, once], 200)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 250)
    // cleared: a job, then the model clears the schedule.
    conversation('sess_cleared')
    lists('sess_cleared', [{ id: 'jobA', schedule: '0 3 * * *', recurring: true }], 100)
    lists('sess_cleared', [], 200)
    // torn: a valid level, then a row that is not JSON.
    conversation('sess_torn')
    lists('sess_torn', [{ id: 'jobB', schedule: '0 3 * * *', recurring: true }], 100)
    rawLevel('sess_torn', 900, 'not json', 200)
    // short: one readable row, one with no id, one whose id is no string, and a stated count of one.
    conversation('sess_short')
    rawLevel(
      'sess_short',
      900,
      '{"jobs":[{"id":"ok","schedule":"0 3 * * *","recurring":true},{"schedule":"no id"},{"id":7}],"dropped":1}',
      300,
    )
    // understated: no row to list, and a count that says two were not.
    conversation('sess_understated')
    rawLevel('sess_understated', 900, '{"jobs":[],"dropped":2}', 300)
    // quiet: says nothing about a schedule at all.
    conversation('sess_quiet')
    append('sess_quiet', { type: 'status', state: 'idle' }, 100)

    const read = [...store.newestScheduleLevels()].sort((a, b) =>
      a.conversation.localeCompare(b.conversation),
    )

    // The conversations it does read, beside the omissions that follow.
    expect(read.map((row) => row.conversation)).toEqual([
      'sess_keeps',
      'sess_short',
      'sess_understated',
    ])
    const [keeps, short, understated] = read
    // Newest level wins; j1's first listing is its EARLIEST level; the newest compaction is kept.
    expect(keeps?.level).toEqual({
      jobs: [
        { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly', listedSince: 100 },
        { id: 'j2', schedule: '30 4 28 9 *', recurring: false, listedSince: 200 },
      ],
      dropped: 0,
    })
    expect(keeps?.compactedAt).toBe(250)
    // The count adds the stated one to the two rows that could not be read.
    expect(short?.level).toEqual({
      jobs: [{ id: 'ok', schedule: '0 3 * * *', recurring: true, listedSince: 300 }],
      dropped: 3,
    })
    expect(short?.compactedAt).toBeNull()
    expect(understated?.level).toEqual({ jobs: [], dropped: 2 })
    expect(understated?.compactedAt).toBeNull()

    // An emptied newest level hides the older one, and a torn newest does NOT fall back to it: its
    // own conversation is skipped, once, said.
    const absent = read.map((row) => row.conversation)
    expect(absent).not.toContain('sess_cleared')
    expect(absent).not.toContain('sess_torn')
    expect(absent).not.toContain('sess_quiet')
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('session store skipped an unreadable schedule in sess_torn')
  })
})
