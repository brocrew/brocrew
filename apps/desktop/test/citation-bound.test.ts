import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_RECALL_ENTRIES,
  MAX_RECALL_NOTE,
  MAX_RECALL_PATH,
  MAX_RECALL_THREADS,
  type MemoryRecallEvent,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { toWireEvent } from '../src/main/runtime/event-wire'
import {
  applyEvent,
  createTranscript,
  type MemoryRecallItem,
} from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **319 · what a REPLAYED citation may hand the renderer.**
 *
 * ⛔ **Replay is a trust boundary and nothing schema-parses it.** `toPersistedEvents` CASTS the
 * stored payload after `JSON.parse` — that is the rule `216` §2 and `318 M10` are both about — so a
 * ledger row written by a later build, or edited on disk, can otherwise hand the renderer an
 * unbounded array of unbounded strings and watch it paint them into the DOM.
 *
 * ⚑ **The bound is the ADAPTER's own rule, not a second copy.** `boundStoredEvent` calls
 * `boundRecall`, which is the function `codex/normalize.ts` runs on the wire — `169` §1, because two
 * sets of ceilings means one path shipping rows the other rejects.
 *
 * ⚠️ **Three doors, all crossed here**: the IPC boundary (`toWireEvent`, which re-validates against
 * the schema and degrades what fails), the database, and the fold.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-319-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
  store.create({ id: 'sess_r', provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: 'd' })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const replayed = (ordinal: number): MemoryRecallEvent =>
  store.events('sess_r')[ordinal]!.event as MemoryRecallEvent

describe('319 · a citation is bounded on the way back out of the ledger', () => {
  it('keeps the good rows, drops what cannot be a path, and counts what it cut', () => {
    // ⛔ **The malformed entries LEAD the payload**, which is `216`'s own lesson and `318`'s: behind
    // forty valid ones, a `slice` with the filter deleted still produces a clean list.
    const malformed = [
      { path: 'x'.repeat(MAX_RECALL_PATH + 1), note: 'too long a path' },
      { path: 42, note: 'not a path at all' },
      { path: '', note: 'no path' },
      'not even an object',
      null,
    ]
    const valid = Array.from({ length: MAX_RECALL_ENTRIES + 5 }, (_, i) => ({
      path: `rollout_summaries/n${i}.md`,
      lineStart: 1,
      lineEnd: 2,
      note: 'ok',
    }))
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_recall',
        entries: [...malformed, ...valid],
        source: 'memoryCitation',
      } as never,
      1,
    )

    const back = replayed(0)
    // Exactly the cap, not merely under it, and the survivors are the VALID ones in order — false
    // for every bound that slices before it filters.
    expect(back.entries).toHaveLength(MAX_RECALL_ENTRIES)
    expect(back.entries.map((each) => each.path)).toEqual(
      valid.slice(0, MAX_RECALL_ENTRIES).map((each) => each.path),
    )
    // ⛔ **The cap does not go silent on the way OUT** — `092` §4 on the replay path.
    expect(back.dropped, 'the replay cap went silent').toBe(
      malformed.length + valid.length - MAX_RECALL_ENTRIES,
    )
  })

  it('⛔ lets no undeclared key ride the payload into the renderer', () => {
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_recall',
        entries: [
          { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'hi', blob: 'z'.repeat(5000) },
        ],
        source: 'memoryCitation',
      } as never,
      1,
    )
    // CONSTRUCTED, never spread — the rule `boundMemoryNotes` records one function over.
    expect(Object.keys(replayed(0).entries[0]!).sort()).toEqual([
      'lineEnd',
      'lineStart',
      'note',
      'path',
    ])
  })

  it('a stored range that could never have been drawn live is not drawn on replay either', () => {
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_recall',
        entries: [
          { path: 'a.md', lineStart: 234, lineEnd: 3, note: 'reversed' },
          { path: 'b.md', lineStart: '1', lineEnd: '9', note: 'strings' },
          { path: 'c.md', lineStart: 1, lineEnd: 9, note: 'fine' },
        ],
        source: 'memoryCitation',
      } as never,
      1,
    )
    const back = replayed(0)
    expect(back.entries[0]).toEqual({ path: 'a.md', note: 'reversed' })
    expect(back.entries[1]).toEqual({ path: 'b.md', note: 'strings' })
    // ⚑ The paired positive on the SAME payload: a usable range survives, so this cannot pass by
    // the bound having stopped carrying ranges at all.
    expect(back.entries[2]).toEqual({ path: 'c.md', lineStart: 1, lineEnd: 9, note: 'fine' })
  })

  it('clips a stored note and bounds the ids, and counts the ids it cut', () => {
    const ids = Array.from({ length: MAX_RECALL_THREADS + 4 }, (_, i) => `id-${i}`)
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_recall',
        entries: [{ path: 'MEMORY.md', note: 'n'.repeat(MAX_RECALL_NOTE * 4) }],
        threadIds: [...ids, 99, null],
        source: 'memoryCitation',
      } as never,
      1,
    )
    const back = replayed(0)
    expect(back.entries[0]!.note).toHaveLength(MAX_RECALL_NOTE)
    expect(back.threadIds).toHaveLength(MAX_RECALL_THREADS)
    // ⛔ So a COUNT on screen cannot understate what the citation named.
    expect(back.threadsDropped).toBe(4)
  })

  it('⛔ a row whose every id is unusable does not keep the stored array', () => {
    // **Found reviewing this diff.** `{ ...event }` with a CONDITIONAL override leaves the stored
    // value in place on exactly the path that matters: every id too long to carry means
    // `threadIds: []`, the override does not fire, and the original unbounded array of unbounded
    // strings rides into the renderer — the payload this whole bound exists to stop.
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_recall',
        entries: [{ path: 'MEMORY.md' }],
        threadIds: ['x'.repeat(9000)],
        dropped: 'a very long string that is not a number'.repeat(200),
        source: 'memoryCitation',
      } as never,
      1,
    )
    const back = replayed(0)
    expect(back.threadIds).toBeUndefined()
    // ⚑ …and it is still counted, so the row cannot understate what the citation named.
    expect(back.threadsDropped).toBe(1)
    // ⛔ A stored `dropped` that is not a number is stripped, not painted by `{{ item.dropped }}`.
    expect(back.dropped).toBeUndefined()
    // 193: the paired positive on the same row — the entry itself survived.
    expect(back.entries).toEqual([{ path: 'MEMORY.md' }])
  })

  it('⚑ a well-formed row is replayed untouched — or "bounded" would mean "always discards"', () => {
    const clean = {
      type: 'memory_recall' as const,
      entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' }],
      threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
      source: 'memoryCitation',
    }
    store.append('sess_r', 0, clean, 1)
    expect(replayed(0)).toEqual(clean)
  })

  it('crosses the IPC boundary intact, and folds into exactly one row', () => {
    // ⚠️ `toWireEvent` re-validates against the schema and DEGRADES what fails, so a bound that
    // produced a row the schema rejects would lose the citation silently at this door.
    const wire = toWireEvent('codex', {
      type: 'memory_recall',
      entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' }],
      threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
      source: 'memoryCitation',
    })
    expect(wire.type).toBe('memory_recall')

    const state = createTranscript()
    applyEvent(state, wire)
    const rows = state.items.filter((item) => item.kind === 'memoryRecall') as MemoryRecallItem[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entries[0]!.note).toBe('the user’s full name')
    expect(rows[0]!.threadIds).toEqual(['019c6e27-e55b-73d1-87d8-4e01f1f75043'])
  })

  it('⛔ a stored row with NO entries draws nothing rather than an empty heading', () => {
    // The adapter cannot emit one; the replay path can, once a build's caps have moved. Pushed, it
    // renders a heading claiming a recall with no file behind it — the bare "used memory" row.
    const state = createTranscript()
    applyEvent(state, { type: 'memory_recall', entries: [], source: 'memoryCitation' })
    expect(state.items.filter((item) => item.kind === 'memoryRecall')).toHaveLength(0)
    // 193: the paired positive on the same fold, so this cannot pass over a dead transcript.
    applyEvent(state, {
      type: 'memory_recall',
      entries: [{ path: 'MEMORY.md' }],
      source: 'memoryCitation',
    })
    expect(state.items.filter((item) => item.kind === 'memoryRecall')).toHaveLength(1)
  })
})

/**
 * 🔴 **332 · a launch row is bounded on the way back out too** — the same `216` §2 rule its two
 * neighbours in `boundStoredEvent` state, on the third event that carries a path.
 *
 * ⚠️ **Replay is a trust boundary.** A stored payload is broadly cast after `JSON.parse`, so a row
 * written by a later build — or edited on disk — can otherwise hand the renderer an unbounded string
 * to paint and a number to print.
 */
describe('332 · the launch row survives the ledger, or draws nothing', () => {
  const back = (ordinal: number) =>
    store.events('sess_r')[ordinal]!.event as {
      type: string
      index: string
      beside: number
      lookedAt?: number
    }

  it('carries an ordinary row through untouched', () => {
    // ⛔ **The control that makes every assertion below a bound rather than a coincidence.**
    store.append('sess_r', 0, { type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside: 4 }, 1)

    expect(back(0)).toEqual({ type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside: 4 })
  })

  it('⛔ empties a path it cannot carry, so the fold draws nothing rather than a row with no file', () => {
    // ⚠️ **Truncating was the other option and it is worse**: a cut path looks like a real one and
    // sends a person to a file that is not there (086).
    store.append(
      'sess_r',
      0,
      { type: 'memory_loaded', index: `/h/${'x'.repeat(9000)}.md`, beside: 1 } as never,
      1,
    )

    expect(back(0).index).toBe('')
  })

  it('⛔ …and does the same for a path that is not a string, or is empty', () => {
    store.append('sess_r', 0, { type: 'memory_loaded', index: 42, beside: 1 } as never, 1)
    store.append('sess_r', 1, { type: 'memory_loaded', index: '', beside: 1 } as never, 2)

    expect(back(0).index).toBe('')
    expect(back(1).index).toBe('')
  })

  it('⚑ re-derives a count that is not a finite non-negative number to 0 — which draws no clause', () => {
    for (const [ordinal, beside] of [
      [0, -3],
      [1, 'lots'],
      [2, Number.NaN],
      [3, Number.POSITIVE_INFINITY],
    ] as const) {
      store.append(
        'sess_r',
        ordinal,
        { type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside } as never,
        1,
      )
      expect(back(ordinal).beside, String(beside)).toBe(0)
    }
    // …and a real count is untouched, so the zeros above are a bound rather than a field ignored.
    store.append('sess_r', 4, { type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside: 7 }, 1)
    expect(back(4).beside).toBe(7)
  })

  /**
   * 🔴 **604 · the look time is a DECLARED key, and this is the test that says so.**
   *
   * ⛔ **The arm this file tests constructs its answer rather than spreading it**, so a field added
   * to `MemoryLoadedEvent` and not added there is carried on the wire and dropped on the next
   * replay. ⚠️ A row that said *when this app looked* until the app restarted, and then stopped,
   * is worse than one that never said it — so the bound and the field land together.
   */
  it('⚑ 604 · carries a look time through the ledger', () => {
    const LOOKED_AT = Date.parse('2026-09-20T14:02:00.000Z')
    store.append(
      'sess_r',
      0,
      { type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside: 4, lookedAt: LOOKED_AT },
      1,
    )

    expect(back(0)).toEqual({
      type: 'memory_loaded',
      index: '/h/memory/MEMORY.md',
      beside: 4,
      lookedAt: LOOKED_AT,
    })
  })

  it('⛔ …and a moment this app could not have taken comes back ABSENT, not wrong', () => {
    for (const [ordinal, lookedAt] of [
      [0, -1],
      [1, 0],
      [2, Number.NaN],
      [3, Number.POSITIVE_INFINITY],
      [4, 'this morning'],
    ] as const) {
      store.append(
        'sess_r',
        ordinal,
        { type: 'memory_loaded', index: '/h/memory/MEMORY.md', beside: 1, lookedAt } as never,
        1,
      )
      // ⚑ **Absent rather than `0`**, because the field is optional by design: a row from before
      // 604 has none, and a garbage one must be indistinguishable from that rather than printing
      // 1970 beside a sentence about when we looked.
      expect(Object.keys(back(0 + ordinal)), String(lookedAt)).not.toContain('lookedAt')
    }
    // …and a real one is untouched, so the absences above are a bound rather than a field dropped.
    store.append(
      'sess_r',
      5,
      {
        type: 'memory_loaded',
        index: '/h/memory/MEMORY.md',
        beside: 1,
        lookedAt: 1_758_000_000_000,
      },
      1,
    )
    expect(back(5).lookedAt).toBe(1_758_000_000_000)
  })

  it('⛔ lets no undeclared key ride the payload into the renderer', () => {
    // CONSTRUCTED, never spread — the rule its neighbours record.
    store.append(
      'sess_r',
      0,
      {
        type: 'memory_loaded',
        index: '/h/memory/MEMORY.md',
        beside: 1,
        blob: 'z'.repeat(5000),
      } as never,
      1,
    )

    expect(Object.keys(back(0)).sort()).toEqual(['beside', 'index', 'type'])
  })
})
