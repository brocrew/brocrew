import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import { CLAUDE_JSONL } from '../src/main/archive/native-file'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { linesOf } from './helpers/provider-lines'
import type { SessionBundle } from '../src/main/archive/export-session'

/**
 * **An import is all-or-nothing** (051, from 048 §1 finding 5).
 *
 * The finding was written against a snapshot that predates 046, and half of it had already been
 * closed there: the ledger DERIVE — the path adoption, the sweep and the import button all share —
 * has been one transaction since 046's own review. That half is re-proved here rather than
 * inherited, by injecting a failure into the middle of a derive and reading the database
 * afterwards; a guard nobody re-checks is a guard that has already stopped holding once.
 *
 * The other half was live. `importBundle` wrote a session row, then its frames, then one committed
 * transaction PER ledger entry — and its "have we got this already" check is the row. A failure
 * after entry N left a conversation that stops mid-sentence behind a row that says it is complete,
 * and every retry returned that row without writing anything. `importSnapshot` puts the three writes
 * in one transaction, which does not make the failure less likely: it makes the surviving state
 * impossible.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')

describe('import has one completion boundary (051)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost

  const rows = () =>
    db.prepare('SELECT id, external_ref FROM provider_session').all() as {
      id: string
      external_ref: string
    }[]
  const countIn = (table: 'events') =>
    (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-import-boundary-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'x',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A bundle of `entries` messages, optionally with the ordinal collision that fails an import. */
  function bundle(entries: number, options: { collideAt?: number } = {}): SessionBundle {
    return {
      bundleVersion: 2,
      meta: {
        sessionId: 'exported-elsewhere',
        provider: 'claude',
        ref: { provider: 'claude', sessionId: 'thread-9', cwd: '/tmp/there', rotation: 0 },
        cwd: '/tmp/there',
        profileId: 'default',
        status: 'ended',
        adoptedAt: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      },
      raw: { format: CLAUDE_JSONL, frames: ['{"line":1}', '{"line":2}'] },
      ledger: Array.from({ length: entries }, (_, index) => ({
        // A duplicate ordinal violates `UNIQUE(session_id, ordinal)` PART-WAY THROUGH the ledger —
        // a real database failure raised by the real constraint, rather than a mocked throw. What is
        // under test is what survives it, and only a genuine mid-transaction failure can answer
        // that honestly.
        ordinal:
          options.collideAt !== undefined && index === entries - 1 ? options.collideAt : index,
        at: 1_700_000_000_000 + index,
        event: { type: 'assistant_message' as const, text: `message ${index}` },
      })),
    }
  }

  it('leaves nothing behind when a bundle import fails part-way', () => {
    expect(() => host.importBundle(bundle(6, { collideAt: 1 }))).toThrow()

    // Not "some rows": NONE. The row is what the retry check reads, so a row without its
    // conversation is precisely the state that made a partial import permanent.
    expect(rows()).toEqual([])
    expect(countIn('events')).toBe(0)
  })

  it('stays retryable after that failure, and the retry completes it', () => {
    expect(() => host.importBundle(bundle(6, { collideAt: 1 }))).toThrow()

    // The same conversation, this time intact. Before 051 this returned the id of the half-imported
    // row and wrote nothing, and the missing tail was neither retried nor reported.
    const { sessionId } = host.importBundle(bundle(6))
    expect(store.events(sessionId)).toHaveLength(6)
    expect(store.ledgerStatus(sessionId).present).toBe(true)
    // The bundle's provider lines are not kept: the ledger records how many it was read from.
    expect(store.ledgerStatus(sessionId).derivedThrough).toBe(2)
  })

  it('leaves the retry check itself answering "no", which is what made a partial permanent', () => {
    expect(() => host.importBundle(bundle(6, { collideAt: 1 }))).toThrow()

    // THE assertion, and it is deliberately the exact lookup `importBundle` performs before doing
    // anything: a non-null answer here is what used to send the retry down the early-return with a
    // half-written conversation behind it. Asserting over `rows()` instead would be a loop with
    // nothing to iterate — vacuously true whatever the fix did.
    expect(store.findByProviderRef('claude', 'thread-9')).toBeNull()
  })

  // ⚠️ A REGRESSION GUARD, not evidence of the fix: every assertion below passes on the pre-051
  // three-commit version too. It is here because moving three writes into one transaction is
  // exactly the kind of change that quietly alters ordinals or timestamps on the way past.
  it('imports the whole bundle when nothing fails, unchanged', () => {
    const { sessionId } = host.importBundle(bundle(4))
    expect(store.events(sessionId).map((entry) => entry.ordinal)).toEqual([0, 1, 2, 3])
    // The bundle's own times, not ours — the behaviour 089 landed and this must not have moved.
    expect(store.events(sessionId)[0]?.at).toBe(1_700_000_000_000)
    expect(store.find(sessionId)?.adoptedAt).not.toBeNull()
  })

  /**
   * Acceptance 7: the guards this task was told to extend, not rewrite. Both are re-measured rather
   * than assumed still true.
   *
   * ⚠️ These test **046 and 045, not 051** — they pass with `importSnapshot` reverted, because the
   * derive path never went through it. That is the point: the dispatch asked whether the neighbouring
   * guards survived being built next to, and the only way to answer is to exercise them. Read them
   * as "the guards still hold", never as "the bundle boundary works" — the four tests above are that.
   */
  describe('046 and 045 still hold', () => {
    /** The fixture's lines, as a derive reads them from the provider's file. */
    const fixture = linesOf(readFileSync(CLAUDE_FIXTURE, 'utf8').split('\n').filter(Boolean))

    /** An adopted row — the state a derive starts from. */
    function planted(): string {
      const sessionId = 'sess_archived'
      store.adopt({
        id: sessionId,
        provider: 'claude',
        sessionId: 'thread-planted',
        cwd: '/tmp/there',
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
      return sessionId
    }

    it('publishes nothing when a derive fails half way, and a retry completes it (046)', async () => {
      const sessionId = planted()
      let batches = 0
      // The store the derive writes THROUGH, so the failure lands inside a real committed batch
      // rather than beside it.
      const flaky: SessionStore = {
        ...store,
        appendGeneration: (id, generation, entries) => {
          batches += 1
          if (batches === 2) throw new Error('the disk went away mid-import')
          store.appendGeneration(id, generation, entries)
        },
      }

      // A batch size small enough that there IS a second batch to fail on.
      //
      // ⚠️ **It no longer THROWS, and that is the product change 065 made** (061 finding 6). 046
      // kept the ledger whole with one enormous transaction, which could not yield, could not be
      // cancelled, and had to let the exception out. The projection is now built in a generation
      // nothing reads, so a mid-build failure is an ordinary outcome with a name: the previous
      // projection — here, none at all — is exactly as it was, and the reason is on the record.
      const failed = await deriveLedger(flaky, sessionId, 'claude', fixture, {
        fallbackAt: 1_700_000_000_000,
        batchSize: 2,
      })
      expect(failed).toBe('failed')
      expect(store.ledgerStatus(sessionId).present).toBe(false)
      expect(store.events(sessionId)).toEqual([])
      expect(store.ledgerStatus(sessionId).failure).toContain('the disk went away')

      // ...and because nothing was published, the next pass is let straight in.
      const outcome = await deriveLedger(store, sessionId, 'claude', fixture, {
        fallbackAt: 1_700_000_000_000,
        batchSize: 2,
      })
      expect(outcome).toBe('imported')
      const after = store.ledgerStatus(sessionId)
      expect(after.present).toBe(true)
      // The failure is CLEARED by the build that succeeded, not left beside it as a second opinion.
      expect(after.failure).toBeNull()
      expect(after.derived).toBe('current')
    })

    it('closes an imported conversation with the only honest reason (045)', async () => {
      const sessionId = planted()
      await deriveLedger(store, sessionId, 'claude', fixture, { fallbackAt: 1_700_000_000_000 })

      // A provider file records prompts and replies, never turn lifecycle, so every turn an import
      // opens has an ending nobody observed. `unknown` is what that is called.
      const turns = store.turns(sessionId)
      expect(turns.length).toBeGreaterThan(0)
      expect(turns.at(-1)).toMatchObject({ endReason: 'unknown' })
      expect(turns.every((turn) => turn.closedAt !== null)).toBe(true)
    })
  })
})
