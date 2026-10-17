import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { COMPACT_FROM_FREE_BYTES, compactWhenMuchIsFree } from '../src/main/db/compact'

/**
 * Migration `0004` · **Claude's stream fragments go, and what stays is renumbered** — landing
 * coverage for what the commit's scratch check showed once and nothing committed: exactly the
 * fragments are removed, every other kind survives, and each conversation's ordinals keep only the
 * holes they already had. And `compactWhenMuchIsFree`, the launch-time step that gives the space back.
 */

const real = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * The migrations folder as it stood before `0004` — every migration from `0004` on taken out, so
 * the ones written after it (`0005` the fold index, …) are applied in their order, after it.
 */
function beforeTheFragmentsWentIn(dir: string): string {
  const folder = join(dir, 'migrations-before')
  cpSync(real, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  for (const entry of journal.entries.filter((one) => one.idx >= 4)) {
    rmSync(join(folder, `${entry.tag}.sql`))
    // Index-only migrations need no generated schema snapshot.
    rmSync(join(folder, 'meta', `${entry.tag.slice(0, 4)}_snapshot.json`), { force: true })
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < 4)
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

const streamFrame = (
  delta: object,
  over: { category?: string; provider?: string; type?: string } = {},
): string =>
  JSON.stringify({
    type: 'unknown',
    provider: over.provider ?? 'claude',
    category: over.category ?? 'activity',
    raw: {
      type: over.type ?? 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta },
    },
  })

const FRAGMENT = streamFrame({ type: 'input_json_delta', partial_json: '"x"' })
const message = (n: number): string =>
  JSON.stringify({ type: 'assistant_message', text: `words ${n}` })

interface Planted {
  readonly session: string
  readonly generation: number
  readonly ordinal: number
  readonly type: string
  readonly payload: string
}

describe('0004 · the stream fragments', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-mig0004-'))
    db = openDatabase(join(dir, 'test.sqlite'))
    applyMigrations(db, beforeTheFragmentsWentIn(dir))
    const add = db.prepare(
      `INSERT INTO provider_session (id, provider, cwd, created_at, updated_at) VALUES (?, 'claude', '/tmp', 1, 1)`,
    )
    for (const id of ['A', 'B', 'C']) add.run(id)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function plant(rows: readonly Planted[]): void {
    const insert = db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`,
    )
    for (const row of rows) {
      insert.run(
        `${row.session}-${row.generation}-${row.ordinal}`,
        row.session,
        row.ordinal,
        row.type,
        row.payload,
        row.generation,
      )
    }
  }

  const left = (session: string, generation = 0) =>
    db
      .prepare(
        `SELECT id, ordinal FROM events WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
      )
      .all(session, generation) as { id: string; ordinal: number }[]

  it('🔴 removes the fragments and moves what follows each one down by the fragments before it', () => {
    plant([
      { session: 'A', generation: 0, ordinal: 0, type: 'assistant_message', payload: message(0) },
      { session: 'A', generation: 0, ordinal: 1, type: 'unknown', payload: FRAGMENT },
      { session: 'A', generation: 0, ordinal: 2, type: 'unknown', payload: FRAGMENT },
      { session: 'A', generation: 0, ordinal: 3, type: 'assistant_message', payload: message(3) },
      { session: 'A', generation: 0, ordinal: 4, type: 'unknown', payload: FRAGMENT },
      { session: 'A', generation: 0, ordinal: 5, type: 'assistant_message', payload: message(5) },
    ])
    applyMigrations(db, real)
    expect(left('A')).toEqual([
      { id: 'A-0-0', ordinal: 0 },
      { id: 'A-0-3', ordinal: 1 },
      { id: 'A-0-5', ordinal: 2 },
    ])
  })

  it('⛔ keeps thinking that carries words, and every frame it cannot be sure is a fragment', () => {
    const thinking = (words: string) =>
      streamFrame({ type: 'thinking_delta', thinking: words }, { category: 'reasoning' })
    plant([
      { session: 'A', generation: 0, ordinal: 0, type: 'unknown', payload: thinking('some words') },
      { session: 'A', generation: 0, ordinal: 1, type: 'unknown', payload: thinking('') },
      { session: 'A', generation: 0, ordinal: 2, type: 'unknown', payload: 'not json at all' },
      {
        session: 'A',
        generation: 0,
        ordinal: 3,
        type: 'unknown',
        payload: streamFrame({ type: 'input_json_delta' }, { category: 'unrecognized' }),
      },
      {
        session: 'A',
        generation: 0,
        ordinal: 4,
        type: 'unknown',
        payload: streamFrame({ type: 'input_json_delta' }, { provider: 'codex' }),
      },
      {
        session: 'A',
        generation: 0,
        ordinal: 5,
        type: 'unknown',
        payload: JSON.stringify({
          type: 'unknown',
          provider: 'claude',
          category: 'activity',
          raw: { type: 'tool_progress' },
        }),
      },
      {
        session: 'A',
        generation: 0,
        ordinal: 6,
        type: 'unknown',
        payload: JSON.stringify({
          type: 'unknown',
          provider: 'claude',
          category: 'activity',
          raw: { brobot2Discarded: true },
        }),
      },
      // The same fragment under a type that is not `unknown` is not one.
      { session: 'A', generation: 0, ordinal: 7, type: 'tool_call', payload: FRAGMENT },
    ])
    applyMigrations(db, real)
    // Only the empty thinking delta (ordinal 1) is a fragment; the rest close up behind it.
    expect(left('A').map((row) => row.id)).toEqual([
      'A-0-0',
      'A-0-2',
      'A-0-3',
      'A-0-4',
      'A-0-5',
      'A-0-6',
      'A-0-7',
    ])
    expect(left('A').map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('⚑ a hole a conversation already had stays a hole of the same width', () => {
    const planted = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]
    const fragments = new Set([1, 4, 9])
    plant(
      planted.map((ordinal) => ({
        session: 'B',
        generation: 0,
        ordinal,
        type: fragments.has(ordinal) ? 'unknown' : 'tool_call',
        payload: fragments.has(ordinal) ? FRAGMENT : message(ordinal),
      })),
    )
    applyMigrations(db, real)
    expect(left('B').map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 6, 7, 8])
  })

  it('⚑ conversations and generations are renumbered apart, and nothing is left dangling', () => {
    const rows: Planted[] = []
    for (const generation of [0, 1]) {
      for (let ordinal = 0; ordinal < 9; ordinal++) {
        const fragment = ordinal % 3 === 1
        rows.push({
          session: 'C',
          generation,
          ordinal,
          type: fragment ? 'unknown' : 'user_turn',
          payload: fragment ? FRAGMENT : message(ordinal),
        })
      }
    }
    // A conversation with no fragment at all is untouched.
    rows.push({
      session: 'A',
      generation: 0,
      ordinal: 0,
      type: 'assistant_message',
      payload: message(0),
    })
    rows.push({
      session: 'A',
      generation: 0,
      ordinal: 1,
      type: 'assistant_message',
      payload: message(1),
    })
    plant(rows)
    applyMigrations(db, real)
    for (const generation of [0, 1]) {
      expect(left('C', generation).map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4, 5])
    }
    expect(left('A')).toEqual([
      { id: 'A-0-0', ordinal: 0 },
      { id: 'A-0-1', ordinal: 1 },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    // The helper table the migration builds is gone, and the unique order index still holds.
    expect(db.prepare(`SELECT count(*) AS n FROM sqlite_temp_master`).get()).toEqual({ n: 0 })
  })

  it('⚑ an empty database migrates, and a second run changes nothing', () => {
    applyMigrations(db, real)
    expect(() => applyMigrations(db, real)).not.toThrow()
    plant([
      { session: 'A', generation: 0, ordinal: 0, type: 'assistant_message', payload: message(0) },
    ])
    applyMigrations(db, real)
    expect(left('A')).toEqual([{ id: 'A-0-0', ordinal: 0 }])
  })
})

describe('compactWhenMuchIsFree', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-compact-'))
    db = openDatabase(join(dir, 'test.sqlite'))
    db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, body BLOB)')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const MB = 1024 * 1024
  /** A file with `kept` MB held and about `freed` MB free, the free part from deleted rows. */
  function fillAndEmpty(kept: number, freed: number): void {
    const add = db.prepare('INSERT INTO filler (id, body) VALUES (?, zeroblob(?))')
    db.transaction(() => {
      for (let i = 0; i < kept + freed; i++) add.run(i, MB)
    })()
    db.prepare('DELETE FROM filler WHERE id >= ?').run(kept)
    db.pragma('wal_checkpoint(TRUNCATE)')
  }

  const freeBytes = (): number =>
    Number(db.pragma('freelist_count', { simple: true })) *
    Number(db.pragma('page_size', { simple: true }))

  it('🔴 leaves a database with little free space alone, whatever the disk holds', () => {
    fillAndEmpty(2, 2)
    expect(freeBytes()).toBeLessThan(COMPACT_FROM_FREE_BYTES)
    expect(compactWhenMuchIsFree(db, 1e12)).toBe('not-needed')
    expect(freeBytes()).toBeGreaterThan(0)
  })

  it('⛔ never starts a copy the disk cannot hold, nor one it cannot measure', () => {
    fillAndEmpty(8, 70)
    expect(freeBytes()).toBeGreaterThanOrEqual(COMPACT_FROM_FREE_BYTES)
    const before = freeBytes()
    expect(compactWhenMuchIsFree(db, null)).toBe('not-enough-disk')
    // Less than twice what is kept: the copy and the log beside it would not fit.
    expect(compactWhenMuchIsFree(db, 2 * 8 * MB - 10 * MB)).toBe('not-enough-disk')
    expect(freeBytes()).toBe(before)
  })

  it('🔴 gives the free pages back when a quarter of the file or more is free and the disk has room', () => {
    fillAndEmpty(8, 70)
    expect(compactWhenMuchIsFree(db, 1e12)).toBe('compacted')
    expect(freeBytes()).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM filler').get()).toEqual({ n: 8 })
    // A second launch finds nothing to do.
    expect(compactWhenMuchIsFree(db, 1e12)).toBe('not-needed')
  })

  it('⚑ says so when a reader holds the log and it keeps its size', () => {
    fillAndEmpty(8, 70)
    const reader = openDatabase(join(dir, 'test.sqlite'))
    try {
      reader.exec('BEGIN')
      reader.prepare('SELECT count(*) FROM filler').get()
      expect(compactWhenMuchIsFree(db, 1e12)).toBe('compacted-log-held')
      expect(freeBytes()).toBe(0)
    } finally {
      reader.exec('ROLLBACK')
      reader.close()
    }
  })
})
