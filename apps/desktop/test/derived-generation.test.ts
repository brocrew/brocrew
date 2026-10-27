import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'
import { importCodexRollout } from '../src/main/archive/import-codex'
import { linesOf } from './helpers/provider-lines'

/**
 * **A derived ledger says what read it, and is rebuilt only when asked** (065, from 061 finding 6 —
 * the last of its six blocking findings).
 *
 * The finding, verbatim: *"Raw preservation and derived projection have no shared completeness
 * contract: no normalizer version, raw watermark, projection generation, or atomic promotion
 * state."* And the cost: *"If a provider transcript grows after its first import, the archive
 * preserves the new raw bytes but the UI can permanently present the old derived tail as
 * complete."*
 *
 * The provider's file is the only record now, so "stale" is a ledger an older importer read, and a
 * grown file is read again by a rebuild. Fixtures are synthetic shapes verified against the real
 * corpus; no personal content is copied.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

const SESSION = 'sess_derived'

/** Two Claude records that fold to a real conversation — the smallest file worth projecting. */
const claudeFrames = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      type: index % 2 === 0 ? 'user' : 'assistant',
      timestamp: new Date(1_700_000_000_000 + (from + index) * 1_000).toISOString(),
      message: { content: `line ${from + index}` },
    }),
  )

describe('the derived-generation contract (065)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let issued: number
  /** The provider's lines a derive reads, as the test has planted and grown them. */
  let held: string[]

  beforeEach(() => {
    held = []
    dir = mkdtempSync(join(tmpdir(), 'brobot2-derived-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    issued = 0
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** An adopted row with `count` lines of its provider's file behind it — what a derive reads. */
  function planted(count = 6, frames = claudeFrames(0, count)): string {
    store.adopt({
      id: SESSION,
      provider: 'claude',
      sessionId: 'thread-planted',
      cwd: '/tmp/there',
      profileId: 'default',
      updatedAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    })
    held = [...frames]
    return SESSION
  }

  type Options = Parameters<typeof deriveLedger>[4]
  const derive = (options: Partial<Options> = {}) =>
    deriveLedger(store, SESSION, 'claude', linesOf(held), {
      fallbackAt: 1_700_000_000_000,
      ...options,
    })

  describe('a projection says how far it reaches (acceptance 2, 4)', () => {
    it('records the normalizer version and how many lines it read, and reads `current`', async () => {
      planted(6)
      expect(await derive()).toBe('imported')

      const status = store.ledgerStatus(SESSION)
      expect(status.present).toBe(true)
      expect(status.derived).toBe('current')
      // Acceptance 4: the version is RECORDED, not assumed.
      expect(status.normalizerVersion).toBe(NORMALIZER_VERSION)
      expect(status.derivedThrough).toBe(6)
    })

    it('detects a ledger built by an OLDER normalizer, file unchanged (acceptance 4)', async () => {
      planted(6)
      await derive()

      // The same rows, re-stamped as the work of a version that predates this one — which is what a
      // bump to NORMALIZER_VERSION does to every ledger already on disk. No line moved.
      db.prepare('UPDATE derived_generation SET normalizer_version = ? WHERE session_id = ?').run(
        NORMALIZER_VERSION - 1,
        SESSION,
      )

      const status = store.ledgerStatus(SESSION)
      expect(status.derived).toBe('stale')
      expect(status.derivedThrough).toBe(6)
    })

    it('leaves every stored row and version untouched when an older projection is opened again', async () => {
      planted(6)
      await derive()
      db.prepare('UPDATE derived_generation SET normalizer_version = ? WHERE session_id = ?').run(
        NORMALIZER_VERSION - 1,
        SESSION,
      )
      const before = store.events(SESSION)
      const generation = db
        .prepare('SELECT * FROM derived_generation WHERE session_id = ?')
        .get(SESSION)
      let reads = 0
      expect(
        await deriveLedger(
          store,
          SESSION,
          'claude',
          () => {
            reads++
            throw new Error('an existing projection must not read the provider file')
          },
          { fallbackAt: 1_700_000_000_000, rebuild: false },
        ),
      ).toBe('skipped')
      expect(reads).toBe(0)
      expect(store.events(SESSION)).toEqual(before)
      expect(
        db.prepare('SELECT * FROM derived_generation WHERE session_id = ?').get(SESSION),
      ).toEqual(generation)
      expect(store.ledgerStatus(SESSION).derived).toBe('stale')
      expect(store.ledgerStatus(SESSION).normalizerVersion).toBe(NORMALIZER_VERSION - 1)
    })

    it('says nothing about a ledger that was RECORDED rather than projected', () => {
      // A session this app ran. Its ledger is the recording — and `current` would be a claim about a
      // reading nobody made.
      store.create({
        id: 'sess_live',
        provider: 'claude',
        cwd: '/work',
        approvalMode: 'ask',
        profileId: 'default',
      })
      store.append('sess_live', 0, { type: 'user_turn', text: 'hello' }, 1_700_000_000_000)

      const status = store.ledgerStatus('sess_live')
      expect(status.present).toBe(true)
      expect(status.derived).toBeNull()
    })

    it('says nothing when a build found no conversation to promote', async () => {
      store.adopt({
        id: SESSION,
        provider: 'claude',
        sessionId: 'thread-chatter',
        cwd: '/tmp/there',
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
      held = [JSON.stringify({ type: 'queue-operation', n: 1 })]

      expect(await derive()).toBe('nothing-readable')
      const status = store.ledgerStatus(SESSION)
      expect(status.present).toBe(false)
      // NOT `stale`: there is no old tail on screen for anything to be behind.
      expect(status.derived).toBeNull()
    })
  })

  describe('a rebuild is bounded, cancellable, and flips atomically (acceptance 3)', () => {
    it('replaces the projection and leaves exactly one generation behind', async () => {
      planted(6)
      await derive()
      const before = store.events(SESSION).length

      held.push(...claudeFrames(6, 4))
      expect(await derive({ rebuild: true })).toBe('imported')

      const after = store.ledgerStatus(SESSION)
      expect(after.derived).toBe('current')
      expect(after.derivedThrough).toBe(10)
      expect(store.events(SESSION).length).toBeGreaterThan(before)
      // The superseded rows are COLLECTED, not left to double the database on every rebuild. The
      // table holds the active projection and nothing else.
      const rows = db
        .prepare('SELECT count(*) AS c FROM events WHERE session_id = ?')
        .get(SESSION) as { c: number }
      expect(rows.c).toBe(store.events(SESSION).length)
      const strays = (table: 'events' | 'turn'): number =>
        (
          db
            .prepare(
              `SELECT count(*) AS c FROM ${table} WHERE session_id = ?
                 AND generation <> (SELECT active FROM derived_generation WHERE session_id = ?)`,
            )
            .get(SESSION, SESSION) as { c: number }
        ).c
      expect(strays('events')).toBe(0)
      // Turns too. They are an INDEX OVER the ledger, scoped by the same number, so a collection
      // that took the events and left the turns would leave half a projection on disk.
      expect(strays('turn')).toBe(0)
    })

    it('never hands out a generation number twice, so nothing has to be deleted first', async () => {
      // ⚠️ The reason this matters is a step that would otherwise be UNBOUNDED. If a build reused
      // `active + 1`, it would first have to clear whatever a failed or cancelled attempt left
      // there — millions of rows in one synchronous transaction on the measured 1.53 GB session,
      // which is exactly the shape 061 said had expired. Monotonic numbers make the leftovers
      // harmless: they are collected in bounded steps whenever there is a moment, and no build ever
      // waits on that having happened.
      planted(6)
      const handed: number[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        handed.push(store.beginGeneration(SESSION))
        store.abandonGeneration(SESSION, handed[handed.length - 1]!, null)
      }
      expect(handed).toEqual([1, 2, 3])
      // ...and after a real derive lands on a fresh number, everything below it is collectable.
      await derive()
      const status = store.ledgerStatus(SESSION)
      expect(status.derived).toBe('current')
      expect(store.deadGenerations(SESSION)).not.toContain(
        (
          db.prepare('SELECT active FROM derived_generation WHERE session_id = ?').get(SESSION) as
            { active: number } | undefined
        )?.active,
      )
    })

    it('writes in bounded batches and asks between them whether it may continue', async () => {
      planted(20)
      const batches: number[] = []
      const asked: number[] = []
      const watched: SessionStore = {
        ...store,
        appendGeneration: (id, generation, entries) => {
          batches.push(entries.length)
          store.appendGeneration(id, generation, entries)
        },
      }

      await deriveLedger(watched, SESSION, 'claude', linesOf(held), {
        fallbackAt: 1_700_000_000_000,
        batchSize: 4,
        cancelled: () => {
          asked.push(1)
          return false
        },
      })

      // Bounded: no single write carried the whole conversation. Yielding: the cancellation
      // predicate was consulted between batches, which is the only place an `await` can happen.
      expect(batches.length).toBeGreaterThan(1)
      expect(Math.max(...batches)).toBeLessThanOrEqual(4)
      expect(asked.length).toBeGreaterThan(0)
    })

    /**
     * ONE Claude record that becomes MANY events (073, from 068 finding 6).
     *
     * The shape the whole finding turns on, and the one every fixture in this file was missing: an
     * assistant record's `content` is an ARRAY, and each `tool_use` block in it is its own ledger
     * row. `claudeFrames` above sends string content — exactly one event per frame — so the
     * "maximum batch" assertion could hold while a single commit carried an arbitrary number of
     * rows. 068: *"one high-fan-out frame can still monopolize Electron's main thread in the
     * 'bounded' transaction."*
     */
    const fanOutFrame = (blocks: number): string =>
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(1_700_000_000_000).toISOString(),
        message: {
          content: Array.from({ length: blocks }, (_, index) => ({
            type: 'tool_use',
            id: `call_${index}`,
            name: 'Bash',
            input: { command: `echo ${index}` },
          })),
        },
      })

    it('bounds what one TRANSACTION writes, not just what one read takes', async () => {
      // A single frame, twenty rows. Read-bounded at four frames, this batch is one row of input.
      planted(1, [fanOutFrame(20)])
      const batches: number[] = []

      const outcome = await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            batches.push(entries.length)
            store.appendGeneration(id, generation, entries)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        { fallbackAt: 1_700_000_000_000, batchSize: 4 },
      )

      expect(outcome).toBe('imported')
      // THE assertion. Before this, the twenty rows landed in one synchronous commit because the
      // bound counted the one frame they came from.
      expect(Math.max(...batches)).toBeLessThanOrEqual(4)
      expect(batches.length).toBe(5)
      // ...and the conversation is whole: this is slicing, not dropping.
      expect(store.events(SESSION)).toHaveLength(20)
    })

    it('can be stopped part-way through a single frame’s fan-out', async () => {
      // The other half of the same bound. A batch that cannot be interrupted is a batch whose size
      // is the only thing standing between a quit and the main thread, which is the state 068
      // described — and it is reachable with one frame, so "between batches" was never enough.
      planted(1, [fanOutFrame(20)])
      const batches: number[] = []
      let asks = 0

      const outcome = await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            batches.push(entries.length)
            store.appendGeneration(id, generation, entries)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        { fallbackAt: 1_700_000_000_000, batchSize: 4, cancelled: () => ++asks >= 2 },
      )

      expect(outcome).toBe('stopped')
      // It wrote something and then stopped, inside one frame batch — a build that never wrote
      // would satisfy the outcome for the wrong reason.
      expect(batches).toEqual([4])
      expect(store.ledgerStatus(SESSION).present).toBe(false)
    })

    it('is asked before the FIRST batch, so a small derive is cancellable at all', async () => {
      // 068 read the ask as being at the wrong boundary; measuring it showed the boundary was also
      // the wrong SIDE. Asked only after a batch, a derive that fits in one — which at the default
      // of two thousand frames is most of the corpus — was never asked, and a quit landing on it
      // built the whole projection anyway.
      planted(2)
      const batches: number[] = []
      const outcome = await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            batches.push(entries.length)
            store.appendGeneration(id, generation, entries)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        { fallbackAt: 1_700_000_000_000, cancelled: () => true },
      )

      expect(outcome).toBe('stopped')
      expect(batches).toEqual([])
      expect(store.ledgerStatus(SESSION).present).toBe(false)
    })

    it('leaves the PREVIOUS projection active and intact when a rebuild fails part-way', async () => {
      planted(6)
      await derive()
      const original = store.events(SESSION)
      expect(original.length).toBeGreaterThan(1)

      held.push(...claudeFrames(6, 10))

      let batches = 0
      const flaky: SessionStore = {
        ...store,
        appendGeneration: (id, generation, entries) => {
          // After the first batch has genuinely landed, so the failure is mid-build and not before
          // it — a rebuild that never wrote anything would pass this test for the wrong reason.
          if (++batches === 2) throw new Error('the disk went away mid-rebuild')
          store.appendGeneration(id, generation, entries)
        },
      }

      const outcome = await deriveLedger(flaky, SESSION, 'claude', linesOf(held), {
        fallbackAt: 1_700_000_000_000,
        batchSize: 2,
        rebuild: true,
      })

      expect(outcome).toBe('failed')
      expect(batches).toBeGreaterThan(1)
      // THE assertion: byte for byte the conversation that was there before the attempt.
      expect(store.events(SESSION)).toEqual(original)
      const status = store.ledgerStatus(SESSION)
      expect(status.derived).toBe('failed')
      expect(status.failure).toContain('the disk went away')
      // ...and the watermark did not move, so nothing claims to cover the frames it never read.
      expect(status.derivedThrough).toBe(6)
    })

    it('recovers from that failure on the next attempt, with no leftovers', async () => {
      planted(6)
      await derive()
      held.push(...claudeFrames(6, 4))

      let batches = 0
      await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            if (++batches === 2) throw new Error('mid-rebuild')
            store.appendGeneration(id, generation, entries)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        { fallbackAt: 1_700_000_000_000, batchSize: 2, rebuild: true },
      )
      expect(store.ledgerStatus(SESSION).derived).toBe('failed')

      expect(await derive({ rebuild: true })).toBe('imported')
      const status = store.ledgerStatus(SESSION)
      expect(status.derived).toBe('current')
      // The failure is CLEARED by the build that worked rather than left beside it, and the rows the
      // failed attempt wrote were swept before this one started.
      expect(status.failure).toBeNull()
      const rows = db
        .prepare('SELECT count(*) AS c FROM events WHERE session_id = ?')
        .get(SESSION) as { c: number }
      expect(rows.c).toBe(store.events(SESSION).length)
    })

    it('treats being asked to stop as a stop, not a failure', async () => {
      planted(20)
      await derive()
      const original = store.events(SESSION)
      held.push(...claudeFrames(20, 10))

      // ⚠️ Both properties in ONE test, which the review found they were not (LOW). The bounding
      // test above always answers "carry on", so a build that ignored the answer would pass it; a
      // cancellation test that measured no batch sizes would pass a build whose batches had doubled.
      // Measured together, neither regression survives.
      let asks = 0
      const batches: number[] = []
      const outcome = await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            batches.push(entries.length)
            store.appendGeneration(id, generation, entries)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        {
          fallbackAt: 1_700_000_000_000,
          batchSize: 2,
          rebuild: true,
          cancelled: () => ++asks >= 2,
        },
      )

      expect(outcome).toBe('stopped')
      // It genuinely wrote something before it stopped — a build that fell over on its first batch
      // would satisfy every assertion below for the wrong reason — and no batch exceeded the bound.
      expect(batches.length).toBeGreaterThan(0)
      expect(Math.max(...batches)).toBeLessThanOrEqual(2)
      // ...and it stopped WHEN ASKED rather than running to the end: 15 frames at 2 per batch is
      // eight batches, and the second answer was the one that said stop.
      expect(batches.length).toBeLessThan(8)
      expect(store.events(SESSION)).toEqual(original)
      const status = store.ledgerStatus(SESSION)
      // ⚠️ Still `current`, and deliberately NOT `failed`: a quit interrupting catch-up work is not
      // a fault, and a red state on a session because somebody closed the app would be a lie the
      // user then has to investigate.
      expect(status.derived).toBe('current')
      expect(status.failure).toBeNull()
    })

    it('never lets a half-built generation be read, even mid-build', async () => {
      planted(6)
      await derive()
      const original = store.events(SESSION)
      held.push(...claudeFrames(6, 6))

      const seen: number[] = []
      await deriveLedger(
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            store.appendGeneration(id, generation, entries)
            // Read the session THROUGH the public API while the replacement is being written. It
            // must answer with the old projection every time, because that is what is still active.
            seen.push(store.events(SESSION).length)
          },
        },
        SESSION,
        'claude',
        linesOf(held),
        { fallbackAt: 1_700_000_000_000, batchSize: 2, rebuild: true },
      )

      expect(seen.length).toBeGreaterThan(1)
      expect(new Set(seen)).toEqual(new Set([original.length]))
    })
  })

  /**
   * **Generation 0 is a generation** (073, from 068 finding 5).
   *
   * 065's collector enumerated `1…highest`, which is every number `beginGeneration` hands out — and
   * none of the ones this app inherited. Migration 0011's backfill and `importSnapshot` both write
   * their rows at generation 0 with `active = 0`, so the first rebuild of a migrated or bundled
   * session promoted generation 1 and left the entire old projection beside it, permanently, with no
   * enumeration that could ever return it. 068: *"On the documented multi-gigabyte database, that
   * can consume gigabytes and invalidate disk-admission assumptions."*
   */
  describe('the projection this app INHERITED is collectable too (068 finding 5)', () => {
    const BUNDLE = 'sess_bundle'

    /** A bundle import — the production path that plants a populated, ACTIVE generation 0. */
    function bundled(entries = 4): void {
      store.importSnapshot({
        session: {
          id: BUNDLE,
          provider: 'claude',
          sessionId: 'thread-bundle',
          cwd: '/tmp/there',
          profileId: 'default',
          updatedAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
        },
        derivedThrough: 6,
        ledger: Array.from({ length: entries }, (_, ordinal) => ({
          ordinal,
          event: { type: 'assistant_message' as const, text: `bundled ${ordinal}` },
          at: 1_700_000_000_000 + ordinal,
        })),
      })
    }

    const rowsAt = (generation: number, table: 'events' | 'turn' = 'events'): number =>
      (
        db
          .prepare(`SELECT count(*) AS c FROM ${table} WHERE session_id = ? AND generation = ?`)
          .get(BUNDLE, generation) as { c: number }
      ).c

    const active = (): number | undefined =>
      (
        db.prepare('SELECT active FROM derived_generation WHERE session_id = ?').get(BUNDLE) as
          { active: number } | undefined
      )?.active

    const rebuild = (overrides: Partial<Options> = {}, target: SessionStore = store) =>
      deriveLedger(target, BUNDLE, 'claude', linesOf(claudeFrames(0, 6)), {
        fallbackAt: 1_700_000_000_000,
        rebuild: true,
        ...overrides,
      })

    it('does not offer the projection that is being READ, however it got there', () => {
      bundled()
      // The state 068 names, stated before anything is done to it: everything at 0, and 0 active.
      expect(rowsAt(0)).toBe(4)
      expect(active()).toBe(0)
      // Nothing to collect — this is the conversation, not a leftover. A collector that enumerated
      // from zero without excluding the active number would delete a bundle on import.
      expect(store.deadGenerations(BUNDLE)).toEqual([])
    })

    it('collects generation 0 once its successor is promoted', async () => {
      bundled()
      expect(rowsAt(0)).toBeGreaterThan(0)

      expect(await rebuild()).toBe('imported')

      // THE assertion, and the one that was impossible before: the inherited projection is gone.
      expect(active()).toBe(1)
      expect(rowsAt(0)).toBe(0)
      expect(rowsAt(0, 'turn')).toBe(0)
      // ...and what replaced it is intact and readable, so this is collection and not deletion.
      expect(store.events(BUNDLE).length).toBeGreaterThan(0)
      const total = db
        .prepare('SELECT count(*) AS c FROM events WHERE session_id = ?')
        .get(BUNDLE) as { c: number }
      expect(total.c).toBe(store.events(BUNDLE).length)
    })

    it('keeps generation 0 when the rebuild FAILED, because it is still the projection', async () => {
      bundled()
      const original = store.events(BUNDLE)
      expect(original.length).toBe(4)

      let batches = 0
      const outcome = await rebuild(
        { batchSize: 2 },
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            if (++batches === 2) throw new Error('the disk went away mid-rebuild')
            store.appendGeneration(id, generation, entries)
          },
        },
      )

      expect(outcome).toBe('failed')
      expect(batches).toBeGreaterThan(1)
      // The active pointer never moved, so 0 is excluded and the bundle survives its own rebuild.
      expect(active()).toBe(0)
      expect(rowsAt(0)).toBe(4)
      expect(store.events(BUNDLE)).toEqual(original)
      // The half-built successor is what is dead here — and it is offered, so the next pass sweeps
      // it. "Collect the old one" and "collect the failed one" are the same rule, read off `active`.
      expect(store.deadGenerations(BUNDLE)).toEqual([1])
    })

    it('sweeps both the failed attempt and the inherited projection on the retry', async () => {
      bundled()
      await rebuild(
        { batchSize: 2 },
        {
          ...store,
          appendGeneration: (id, generation, entries) => {
            if (generation === 1) throw new Error('mid-rebuild')
            store.appendGeneration(id, generation, entries)
          },
        },
      )
      expect(store.ledgerStatus(BUNDLE).derived).toBe('failed')

      expect(await rebuild()).toBe('imported')

      expect(rowsAt(0)).toBe(0)
      expect(rowsAt(1)).toBe(0)
      const total = db
        .prepare('SELECT count(*) AS c FROM events WHERE session_id = ?')
        .get(BUNDLE) as { c: number }
      expect(total.c).toBe(store.events(BUNDLE).length)
    })
  })

  describe('nothing rebuilds a corpus behind the user (acceptance 7)', () => {
    it('a catch-up derive skips a session it has read rather than rebuilding it', async () => {
      planted(6)
      await derive()
      held.push(...claudeFrames(6, 4))
      const before = store.events(SESSION)

      // The shape every sweep and adopt pass uses — `rebuild` absent, which is the default.
      expect(await derive()).toBe('skipped')

      expect(store.events(SESSION)).toEqual(before)
      expect(store.ledgerStatus(SESSION).derivedThrough).toBe(6)
    })

    it('leaves a live session with no generation record at all', () => {
      store.create({
        id: 'sess_live',
        provider: 'claude',
        cwd: '/work',
        approvalMode: 'ask',
        profileId: 'default',
      })
      store.append('sess_live', 0, { type: 'user_turn', text: 'hi' }, 1_700_000_000_000)
      const row = db
        .prepare('SELECT count(*) AS c FROM derived_generation WHERE session_id = ?')
        .get('sess_live') as { c: number }
      expect(row.c).toBe(0)
    })
  })

  describe('a re-derived Codex session keeps its images (acceptance 5)', () => {
    /**
     * Use a rollout `event_msg` with payload type `image_generation_end`, a `call_id`
     * matching the filename, and a `result` containing the PNG as base64. Real cases carry
     * 2.15 MB and 2.92 MB; a kilobyte fixture suffices to prove those bytes are never
     * carried.
     */
    const imageLine = (callId: string, savedPath?: string): string =>
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-05T03:14:00.000Z',
        payload: {
          type: 'image_generation_end',
          call_id: callId,
          status: 'completed',
          revised_prompt: 'a cutaway diagram of a lighthouse, watercolour',
          result: 'A'.repeat(4096),
          ...(savedPath === undefined ? {} : { saved_path: savedPath }),
        },
      })

    const prompt = JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-05T03:13:00.000Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'draw' }] },
    })

    it('reads the id and the prompt, and NEVER the base64', () => {
      const { entries } = importCodexRollout([prompt, imageLine('call_abc')], 0)
      const image = entries.find((entry) => entry.event.type === 'image')
      expect(image?.event).toEqual({
        type: 'image',
        imageId: 'call_abc',
        prompt: 'a cutaway diagram of a lighthouse, watercolour',
      })
      // The whole event, serialised, is smaller than the payload it came from by three orders of
      // magnitude. 052's 64 KiB bound never had to move: the bytes are simply not read.
      expect(JSON.stringify(image?.event).length).toBeLessThan(200)
    })

    it('carries a path only when a checker approves one', () => {
      const claims: { imageId: string; savedPath?: string }[] = []
      const { entries } = importCodexRollout(
        [prompt, imageLine('call_abc', '/homes/codex/generated_images/t/call_abc.png')],
        0,
        {
          resolveImage: (claim) => {
            claims.push(claim)
            return '/real/generated_images/t/call_abc.png'
          },
        },
      )
      expect(claims).toEqual([
        { imageId: 'call_abc', savedPath: '/homes/codex/generated_images/t/call_abc.png' },
      ])
      expect(entries.find((entry) => entry.event.type === 'image')?.event).toMatchObject({
        path: '/real/generated_images/t/call_abc.png',
      })
    })

    it('refuses a claim the checker turns down, rather than passing it through', () => {
      const { entries } = importCodexRollout(
        [prompt, imageLine('call_abc', '/etc/passwd.png')],
        0,
        { resolveImage: () => null },
      )
      const image = entries.find((entry) => entry.event.type === 'image')
      expect(image).toBeDefined()
      expect(image?.event).not.toHaveProperty('path')
    })

    it('still renders nothing twice — every other `event_msg` stays skipped', () => {
      // The committed fixture carries `event_msg` duplicates of its own `response_item` lines, which
      // is the reason this importer read only one line type. Opening the door for images must not
      // have opened it for them.
      const frames = readFileSync(join(here, 'fixtures/codex-rollout.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
      const duplicates = frames.filter((line) => line.includes('"type":"event_msg"'))
      expect(duplicates.length).toBeGreaterThan(0)

      const { entries } = importCodexRollout(frames, 0)
      const texts = entries.flatMap((entry) =>
        entry.event.type === 'assistant_message' ? [entry.event.text] : [],
      )
      expect(new Set(texts).size).toBe(texts.length)
    })

    it('a session derived from its rollout holds the image the live one would have', async () => {
      store.adopt({
        id: SESSION,
        provider: 'codex',
        sessionId: 'thread-image',
        cwd: '/tmp/there',
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
      const rollout = [
        prompt,
        imageLine('call_abc', '/homes/codex/generated_images/t/call_abc.png'),
      ]

      expect(
        await deriveLedger(store, SESSION, 'codex', linesOf(rollout), {
          fallbackAt: 1_700_000_000_000,
          resolveImage: () => '/served/generated_images/t/call_abc.png',
        }),
      ).toBe('imported')

      const images = store
        .events(SESSION)
        .filter((entry) => entry.event.type === 'image')
        .map((entry) => entry.event)
      // 067: *"A live Codex session shows its images. The same session, re-derived, shows none — even
      // though the PNGs are still on disk."* This is that closed.
      expect(images).toHaveLength(1)
      expect(images[0]).toMatchObject({
        imageId: 'call_abc',
        path: '/served/generated_images/t/call_abc.png',
      })
      // ...and the base64 is NOT in the ledger: the reader takes the id and the prompt.
      expect(JSON.stringify(store.events(SESSION))).not.toContain('A'.repeat(4096))
    })
  })

  describe('`hasEvents` is no longer the completeness signal (acceptance 6)', () => {
    /** Every production source file in the main process, with comments stripped. */
    const sources = (): { path: string; code: string }[] => {
      const found: { path: string; code: string }[] = []
      const walk = (at: string): void => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
          const path = join(at, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== 'migrations') walk(path)
            continue
          }
          if (!entry.name.endsWith('.ts')) continue
          const code = readFileSync(path, 'utf8')
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join('\n')
          found.push({ path, code })
        }
      }
      walk(join(here, '../src/main'))
      return found
    }

    it('is called nowhere, and the contract is called in its place', () => {
      const files = sources()
      // Non-vacuity #1: the scan is looking at real files.
      expect(files.length).toBeGreaterThan(20)

      const offenders = files.filter((file) => /\.hasEvents\s*\(/.test(file.code))
      expect(offenders.map((file) => file.path)).toEqual([])

      // Non-vacuity #2, and EXACT rather than a floor — 064's review found that a floor I had
      // guessed was half the real count, and would therefore have tolerated deleting half the sites
      // in silence.
      //
      // ⚠️ **CALL SITES, not files (073, 068 finding 14) — the sixth vacuous test.** The comment
      // below has always said four; the assertion counted the three FILES they live in, so deleting
      // either duplicate, or adding a fifth call inside a file already on the list, moved nothing.
      // 068: *"A completeness gate can be removed from one production path without moving this
      // advertised mutation guard."* A map keeps both properties in one assertion: a new file is a
      // new key, a lost file is a missing one, and a call appearing or vanishing inside any of them
      // is a number that no longer matches.
      //
      // **FIVE is what is there, and the comment that said four was itself wrong** — which is the
      // finding twice over: an assertion that could not count and a sentence beside it that had
      // miscounted. 068 said five and it is five: the derive's idempotence guard; the sweep's
      // up-to-date short-circuit and its failure-reason reporter; the host's import readback and
      // the host's own `status`. (068's line numbers are stale — the calls are at
      // `derive-ledger.ts:131`, `sweep.ts:695,799` and `runtime-host.ts:1791,1848` — but the count
      // it drew from them was right.) ⚑ **FIVE again since the provider's file became the only
      // record**: the one-file import asks once, where the bulk pass it replaced asked twice. Line numbers are not asserted, deliberately — they move on
      // every edit and a guard nobody can keep green is a guard that gets deleted. Changing the
      // count is allowed; changing it without noticing is what this stops.
      //
      // ⚑ **SIX since 119**, and the new one is `importRecordedSession`'s read-back — the row's own
      // Import, which owes the same answer the sweep's import owes and gets it the same way. It is
      // ONE site for three endings on purpose: the two refusals ahead of the attempt need `readable`
      // too, and three literal calls would have moved this number by three to say one new thing.
      // Unsorted, deliberately: `toEqual` on an object does not care about key order, so a `.sort()`
      // here would be decoration standing where an assertion should be.
      const sites: Record<string, number> = {}
      for (const file of files) {
        const count = [...file.code.matchAll(/\.ledgerStatus\s*\(/g)].length
        if (count > 0) {
          const portable = file.path.replaceAll('\\', '/')
          sites[portable.slice(portable.indexOf('/src/main/'))] = count
        }
      }
      expect(sites, 'the scan found the wrong contract call sites').toEqual({
        '/src/main/archive/derive-ledger.ts': 1,
        '/src/main/archive/import-from-home.ts': 1,
        '/src/main/runtime/runtime-host.ts': 3,
      })
      expect(Object.values(sites).reduce((a, b) => a + b, 0)).toBe(5)
    })

    it('counts every call rather than every file, so a duplicate cannot go missing', () => {
      // ⚠️ Non-vacuity for the count itself, and the one the file-path version could not have: two
      // calls in one file must read as two. Written against a synthetic file because the real
      // corpus is what is under test — a guard that proved itself by measuring its own subject
      // would agree with whatever the subject happened to be.
      const code = [
        '  // deps.store.ledgerStatus(commented)',
        '  const a = deps.store.ledgerStatus(one).present',
        '  const b = deps.store.ledgerStatus (two).failure',
      ]
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n')
      expect([...code.matchAll(/\.ledgerStatus\s*\(/g)]).toHaveLength(2)
      // …and the shape the old assertion used sees the same file once, whichever it is. This is the
      // defect, kept as an executable statement of it rather than a sentence about it.
      expect(/\.ledgerStatus\s*\(/.test(code)).toBe(true)
    })

    it('the scan would still catch a call, so it is testing real content', () => {
      // Non-vacuity #3, for the comment stripping itself: a call in code is found, one in prose is
      // not — so the emptiness above is a fact about the code rather than about the regex.
      const stripped = ['  // store.hasEvents(x)', '  if (store.hasEvents(y)) return']
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n')
      expect(/\.hasEvents\s*\(/.test(stripped)).toBe(true)
    })

    it('the store does not offer it either, so a new caller cannot reach for it', () => {
      const source = readFileSync(join(here, '../src/main/db/session-store.ts'), 'utf8')
      // The interface itself: `hasEvents` is gone as a member, not merely unused. A method left on
      // the surface is one an unrelated task adds a caller to.
      expect(source).not.toMatch(/^\s*hasEvents\(/m)
      expect(source).toMatch(/^\s*ledgerStatus\(sessionId: string\): LedgerStatus/m)
    })
  })

  describe('a re-derive is reachable, through the one coordinator (acceptance 3)', () => {
    /** A sink that swallows: these tests are about the ledger, not about what a window sees. */
    const SINK = {
      ownerId: 'test',
      aPersonIsBehindIt: false,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }

    /** The provider's file a rebuild reads: the lines the test holds, written out. */
    const providerFile = (): string => {
      const path = join(dir, 'thread-planted.jsonl')
      writeFileSync(path, `${held.join('\n')}\n`)
      return path
    }

    const buildHost = (): RuntimeHost =>
      new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => (held.length === 0 ? null : providerFile()),
        exportDirectory: () => join(dir, 'exports'),
        createRuntime: (provider) => new FakeRuntime(provider),
        prepareProviderHome: (provider) => join(dir, 'homes', provider),
        providerHomePath: (provider) => join(dir, 'homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
        newSessionId: () => `sess_host_${++issued}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'x',
          authNote: null,
          files: [],
        }),
      })

    it('rebuilds a session when it is named, reading its grown file, and reports what it did', async () => {
      planted(6)
      await derive()
      held.push(...claudeFrames(6, 4))

      const result = await buildHost().rebuildLedger(SESSION)
      expect(result.outcome).toBe('imported')
      expect(result.status?.derived).toBe('current')
      expect(result.status?.derivedThrough).toBe(10)
    })

    it('refuses once the quit has closed the background lane, and changes nothing', async () => {
      planted(6)
      await derive()
      held.push(...claudeFrames(6, 4))
      const before = store.events(SESSION)

      const host = buildHost()
      host.stopSweeping()

      const result = await host.rebuildLedger(SESSION)
      // A refusal, not a failure: the rebuild is there next time. Through the coordinator's OWN gate (062) rather than a second shutdown flag — which is
      // the mechanism 061 finding 1 was about, and the dispatch said not to reinvent.
      expect(result.outcome).toBe('refused')
      expect(store.events(SESSION)).toEqual(before)
      expect(store.ledgerStatus(SESSION).derivedThrough).toBe(6)
    })

    it('refuses a session that is open right now', async () => {
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)
      const result = await host.rebuildLedger(created.sessionId)
      // Its ledger is being RECORDED, not projected, and its provider is still writing its file.
      expect(result.outcome).toBe('in-use')
      await host.close(created.sessionId, SINK)
    })

    it('says so plainly when there is no such session', async () => {
      const result = await buildHost().rebuildLedger('sess_nobody')
      expect(result).toEqual({ outcome: 'unknown-session', status: null })
    })

    /**
     * 🔴 **702 · `697` H-f — a conversation closed before its provider NAMED it is a recording, not a
     * stranger.**
     *
     * ⛔ **Measured by `697` on `695`'s run**: the library lists such a row (`recordedOne`), and this
     * door looked it up with `find`, which *"drops a row with no provider ref"* — so a Rebuild press on
     * `sess_9f643857` answered `unknown-session` about a conversation the library had just drawn.
     * ⚑ Planted the way it happens: a Claude conversation this app ran and closed, whose ref never
     * arrived — the column is NULL.
     */
    it('🔴 answers a closed conversation with NO provider ref as the recording it is — and a stranger as a stranger', async () => {
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)
      await host.close(created.sessionId, SINK)
      db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(
        created.sessionId,
      )
      // ⚑ The premise, off the two readers that disagreed: the library's has it, resume's does not.
      expect(store.recordedOne(created.sessionId)).not.toBeNull()
      expect(store.find(created.sessionId)).toBeNull()
      const before = store.events(created.sessionId)

      // ⛔ **Measured on `main`: `unknown-session`.**
      const result = await host.rebuildLedger(created.sessionId)
      expect(result.outcome).toBe('recorded')
      expect(store.events(created.sessionId)).toEqual(before)
      // ⚑ **THE CONTROL**: an id no row carries is still nobody.
      expect(await host.rebuildLedger('sess_nobody')).toEqual({
        outcome: 'unknown-session',
        status: null,
      })
    })

    it('clears a rebuild marker a dead process left, so no session is stuck rebuilding', async () => {
      // ⚠️ **The review's own HIGH.** A crash between opening a generation and finishing it leaves
      // `building` set. `derivedStateOf` then reads `rebuilding` forever — and the library withholds
      // the Rebuild button from a session that is already rebuilding, so there is no way out of it
      // from the UI. A marker means "right now", and at construction nothing is building anything.
      planted(6)
      await derive()
      const orphaned = store.beginGeneration(SESSION)
      expect(orphaned).toBeGreaterThan(0)
      expect(store.ledgerStatus(SESSION).derived).toBe('rebuilding')

      // A fresh host is a fresh run of the app.
      buildHost()

      const status = store.ledgerStatus(SESSION)
      expect(status.derived).not.toBe('rebuilding')
      // Cleared as an interruption, NOT as a fault: the app going away is not something the user
      // has to investigate, and a red state on a session because the machine rebooted would be.
      expect(status.failure).toBeNull()
      expect(status.derived).toBe('current')
    })

    it('🔒 refuses to replace a RECORDING with a projection of the same conversation', async () => {
      // A session this app ran has lifecycle events the provider's own file does not contain — they
      // are our session machine's, not its. Re-deriving that from the file would replace a richer
      // record with a poorer one and call it a repair, which is the one way this feature could
      // destroy something.
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)
      await host.close(created.sessionId, SINK)
      const before = store.events(created.sessionId)
      expect(before.length).toBeGreaterThan(0)
      expect(store.ledgerStatus(created.sessionId).derived).toBeNull()

      const result = await host.rebuildLedger(created.sessionId)
      expect(result.outcome).toBe('recorded')
      expect(store.events(created.sessionId)).toEqual(before)
    })
  })
})
