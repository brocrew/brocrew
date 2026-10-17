import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('ledger waits keep only committed folds', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let reads: number

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-kept-waits-'))
    db = openDatabase(':memory:')
    applyMigrations(db, migrations)
    reads = 0
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      const all = statement.all.bind(statement)
      vi.spyOn(statement, 'all').mockImplementation((...args: unknown[]) => {
        reads += 1
        return all(...args)
      })
      return statement
    })
    store = createSessionStore(db, () => 1)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function conversation(id: string): string {
    store.create({
      id,
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'agent',
    })
    return id
  }

  const given = (owner: string): TranscriptEvent => ({
    type: 'work_given',
    piece: `piece-${owner}`,
    label: 'W1.1',
    parent: 'root',
    givenBy: 'giver',
    title: 'fictional work',
    brief: 'fictional brief',
  })
  const note: TranscriptEvent = {
    type: 'user_turn',
    text: 'a note',
    attribution: 'app_authored',
    relayedFrom: 'giver',
    says: 'note',
  }
  const person: TranscriptEvent = { type: 'user_turn', text: 'a person writes' }
  const ended: TranscriptEvent = { type: 'turn', state: 'completed' }
  const idle: TranscriptEvent = { type: 'status', state: 'idle' }

  function append(owner: string, events: readonly TranscriptEvent[], first = 0): void {
    store.appendMany(
      owner,
      events.map((event, n) => ({ ordinal: first + n, at: first + n + 1, event })),
    )
  }

  function waits(owner: string) {
    const unread = rowsUnreadOnce()
    const rows = store.piecesWaitingOnWhoWroteIn(owner, unread)
    return { rows, unread }
  }

  it('keeps the original person wait through two note turns and forgets it when the person writes', () => {
    const owner = conversation('holder')
    append(owner, [given(owner), person, ended, idle])
    const original = waits(owner).rows
    expect(original).toHaveLength(1)
    for (const first of [4, 7]) {
      append(owner, [note, ended, idle], first)
      const current = waits(owner).rows
      expect(current).toEqual(original)
      expect(current).not.toBe(original)
    }
    append(owner, [person], 10)
    expect(waits(owner).rows).toEqual([])
    expect(original).toHaveLength(1)
  })

  it('bypasses a warm answer inside a read-only transaction and reuses it after commit', () => {
    const owner = conversation('read-only-transaction')
    append(owner, [given(owner), person, ended, idle])
    const original = waits(owner).rows
    const before = reads
    store.atomically(() => {
      const speculative = waits(owner).rows
      expect(speculative).toEqual(original)
      expect(speculative).not.toBe(original)
      expect(reads).toBeGreaterThan(before)
    })
    const after = reads
    expect(waits(owner).rows).toBe(original)
    expect(reads).toBe(after)
  })

  it('does not keep a transaction answer across rollback and reuse of the same ordinals', () => {
    const owner = conversation('rollback')
    append(owner, [given(owner), note, ended, idle])
    expect(waits(owner).rows).toEqual([])
    expect(() =>
      store.atomically(() => {
        append(owner, [person, ended, idle], 4)
        expect(waits(owner).rows).toHaveLength(1)
        throw new Error('fictional rollback')
      }),
    ).toThrow('fictional rollback')
    append(owner, [note, ended, idle], 4)
    expect(waits(owner).rows).toEqual([])
  })

  it('does not retain a first-work floor observed only inside a rolled-back transaction', () => {
    const owner = conversation('floor')
    expect(() =>
      store.atomically(() => {
        append(owner, [given(owner), person, ended], 20)
        expect(waits(owner).rows).toHaveLength(1)
        throw new Error('fictional rollback')
      }),
    ).toThrow('fictional rollback')
    append(owner, [given(owner), person, ended])
    expect(waits(owner).rows.map((one) => one.piece)).toEqual([`piece-${owner}`])
  })

  it('reads a promoted generation again even when the last ordinal is unchanged', () => {
    const owner = conversation('promoted')
    append(owner, [given(owner), person, ended, idle])
    expect(waits(owner).rows).toHaveLength(1)
    const next = store.beginGeneration(owner)
    store.appendGeneration(
      owner,
      next,
      [given(owner), note, ended, idle].map((event, ordinal) => ({
        ordinal,
        event,
        at: ordinal + 1,
      })),
    )
    expect(store.promoteGeneration(owner, next, { normalizerVersion: 1, derivedThrough: 0 })).toBe(
      true,
    )
    expect(waits(owner).rows).toEqual([])
  })

  it('never turns an uncounted torn-row read into a complete cached answer', () => {
    const owner = conversation('torn')
    append(owner, [given(owner), person, ended, idle])
    expect(waits(owner).rows).toHaveLength(1)
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      VALUES ('torn', ?, 0, 99, 'status', '{broken', 100)`,
    ).run(owner)
    expect(store.piecesWaitingOnWhoWroteIn(owner)).toHaveLength(1)
    for (let n = 0; n < 2; n++) {
      const current = waits(owner)
      expect(current.rows).toHaveLength(1)
      expect(current.unread.count).toBe(1)
      expect(current.unread.ledgersSkipped).toBe(0)
    }
  })

  it('keeps no-person-wait controls empty', () => {
    const owner = conversation('ordinary')
    append(owner, [given(owner), note, ended, idle])
    const original = waits(owner).rows
    expect(original).toEqual([])
    expect(waits(owner).rows).toBe(original)
    append(owner, [note, ended, idle], 4)
    expect(waits(owner).rows).toEqual([])
  })

  it('does no history reads for forty unchanged ledgers after 900000 unrelated rows are appended', () => {
    const owners = Array.from({ length: 40 }, (_, n) => conversation(`holder-${n}`))
    for (const owner of owners) append(owner, [given(owner)])
    db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 24999)
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'fold-' || n, 'holder-' || (n % 40), 0, 1 + CAST(n / 40 AS INTEGER),
             'status', '{"type":"status","state":"idle"}', n + 1 FROM numbers`)
    for (const owner of owners) append(owner, [person, ended, idle], 626)
    const kept = owners.map((owner) => ({
      waits: waits(owner).rows,
      routed: store.routedRequestsOf(owner, rowsUnreadOnce()),
    }))
    expect(kept.every((one) => one.waits.length === 1)).toBe(true)
    const coldReads = reads
    expect(coldReads).toBeGreaterThanOrEqual(80)
    for (let pass = 0; pass < 2; pass++) {
      for (const [n, owner] of owners.entries()) {
        expect(waits(owner).rows).toBe(kept[n]?.waits)
        expect(store.routedRequestsOf(owner, rowsUnreadOnce())).toBe(kept[n]?.routed)
      }
    }
    expect(reads).toBe(coldReads)
    db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 899999)
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'noise-' || n, 'holder-' || (n % 40), 0, 1000 + CAST(n / 40 AS INTEGER),
             'tool_result', '{"type":"tool_result"}', n + 1 FROM numbers`)
    for (const [n, owner] of owners.entries()) {
      expect(waits(owner).rows).toBe(kept[n]?.waits)
      expect(store.routedRequestsOf(owner, rowsUnreadOnce())).toBe(kept[n]?.routed)
    }
    expect(reads).toBe(coldReads)
    expect(db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 925160 })
  }, 60_000)
})
