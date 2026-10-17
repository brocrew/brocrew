import { mkdtempSync, rmSync } from 'node:fs'
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

/**
 * **After an abnormal exit, the reopen list showed dead sessions as "working"** (074, from 069 §2.5).
 *
 * The durable `status` column is written as a session runs and reconciled by `settleTx`, which runs
 * on resume and in the finalizer. A clean quit reaches the finalizer. A crash, a `SIGKILL` or a
 * power cut reaches neither — so the row keeps saying `working`, `resumable()` reads that column
 * straight out to the reopen list, and a conversation whose provider died months ago is still
 * listed as running. It never recovered on its own: nothing revisited the row until someone resumed
 * that one conversation by hand.
 *
 * The repair is the same argument `clearOrphanBuilds` already makes about the other column a dead
 * process can strand, and it sits beside it: **at construction nothing is running**, so any row
 * claiming to be is claiming it about a run that ended without saying so.
 *
 * The crash is simulated the only way it can be — by leaving the row exactly as a killed process
 * leaves it and opening the store again. There is no finalizer to skip in a unit test, which is
 * precisely the state under test.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * The normal answer to "what is something alive running right now" — nothing (198).
 *
 * ⚠️ **Named rather than written `new Set()` nine times**, because it is the CONTROL for every
 * assertion below: with an empty set the repair is the one 074 shipped, and `one-app.test.ts` is
 * where a non-empty one is asserted to change the outcome. A reader who finds a bare literal here
 * cannot tell which of those two facts a test is about.
 */
const NOTHING_RUNNING: ReadonlySet<string> = new Set()

describe('a session a dead process left mid-run', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-orphan-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A session that reached the reopen list and then died mid-turn.
   *
   * The `session` event matters: `resumable()` returns only rows carrying a provider ref, because a
   * conversation with no ref cannot be reopened at all. So a fixture without one would never appear
   * in the list this whole finding is about, and the test would pass by looking at nothing.
   */
  const crashedMidTurn = (
    id: string,
    over: { provider?: 'claude' | 'codex'; at?: number } = {},
  ): void => {
    const provider = over.provider ?? 'claude'
    const at = over.at ?? 1_700_000_000_000
    store.create({
      id,
      provider,
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append(
      id,
      0,
      {
        type: 'session',
        state: 'started',
        ref: { provider, sessionId: `p_${id}`, cwd: '/work', rotation: 0 },
      },
      at,
    )
    store.append(id, 1, { type: 'user_turn', text: 'run the tests' }, at + 1)
    store.append(id, 2, { type: 'status', state: 'working' }, at + 2)
    // …and nothing else. The process is gone: no `turn`, no terminal status, no finalizer.
  }

  const settled = (id: string, over: { status: 'idle' | 'ended' } = { status: 'idle' }): void => {
    store.create({
      id,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append(
      id,
      0,
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'claude', sessionId: `p_${id}`, cwd: '/work', rotation: 0 },
      },
      1_700_000_000_000,
    )
    store.append(id, 1, { type: 'status', state: over.status }, 1_700_000_000_001)
  }

  const statusOf = (id: string): string | undefined =>
    store.resumable().find((row) => row.sessionId === id)?.status

  it('is listed as working until something reconciles it — the defect', () => {
    crashedMidTurn('sess_crashed')
    expect(statusOf('sess_crashed')).toBe('working')
  })

  it('is settled at startup, so the reopen list stops calling it live', () => {
    crashedMidTurn('sess_crashed')

    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(1)

    // `idle` is the honest word here and the one 042's ruling defines: it means "we are no longer
    // driving a turn", which is true of a session whose process is gone. It does NOT say the
    // conversation ended — nobody watched it end, and that fact lives on the turn.
    expect(statusOf('sess_crashed')).toBe('idle')
  })

  it('records the turn as `unknown`, never as completed', () => {
    crashedMidTurn('sess_crashed')
    store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)

    const [turn] = store.turns('sess_crashed')
    // ⚠️ The reason code is the whole point of settling rather than deleting. `completed` would be
    // an invention, `failed` a verdict nobody reported; `unknown` is the enum member that exists for
    // "the app was gone for the ending" — the same one resume uses, for the same reason.
    expect(turn?.endReason).toBe('unknown')
    expect(turn?.closedAt).toBe(1_700_000_100_000)
  })

  it('leaves the conversation in the list — the status was the lie, not the row', () => {
    crashedMidTurn('sess_crashed')
    store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)
    // Hiding it would answer the finding by removing the evidence: the session is genuinely still
    // resumable, and that is the reason the list exists.
    expect(store.resumable().map((row) => row.sessionId)).toContain('sess_crashed')
  })

  it('settles a session stranded WAITING on a permission nobody can answer', () => {
    // The second status that asserts something is happening right now. A card frozen on a dead
    // process is not waiting for anyone — there is nothing left to answer to.
    crashedMidTurn('sess_frozen', { provider: 'codex' })
    store.append(
      'sess_frozen',
      3,
      { type: 'status', state: 'waiting_permission' },
      1_700_000_000_003,
    )

    expect(statusOf('sess_frozen')).toBe('waiting_permission')
    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(1)
    expect(statusOf('sess_frozen')).toBe('idle')
  })

  it('does not touch a session that DID say how it ended', () => {
    // ⚠️ Terminal is permanent — the first ending recorded is the one that stands. A session that
    // reached `ended` said so; rewriting it to `idle` would replace a fact with a weaker one and
    // would put a finished conversation back among the live-looking ones.
    settled('sess_done', { status: 'ended' })

    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(0)
    expect(statusOf('sess_done')).toBe('ended')
  })

  it('does not touch a session that was simply idle', () => {
    settled('sess_idle')

    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(0)
    expect(statusOf('sess_idle')).toBe('idle')
  })

  it('is a no-op the second time, so a restart that changes nothing reports nothing', () => {
    crashedMidTurn('sess_crashed')
    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(1)
    expect(store.settleOrphanRuns(1_700_000_200_000, NOTHING_RUNNING)).toBe(0)
  })

  it('settles every stranded session, not just the first', () => {
    crashedMidTurn('sess_a')
    crashedMidTurn('sess_b')
    crashedMidTurn('sess_c')
    expect(store.settleOrphanRuns(1_700_000_100_000, NOTHING_RUNNING)).toBe(3)
    for (const id of ['sess_a', 'sess_b', 'sess_c']) expect(statusOf(id)).toBe('idle')
  })

  it('is what CONSTRUCTING the host does, not something a caller must remember', () => {
    // ⚠️ The wiring is the fix. A correct `settleOrphanRuns` that nothing calls would leave the
    // reopen list exactly as 069 found it, and every assertion above would still pass — so this
    // starts a host the way the app does and asserts the row was repaired by that alone. It sits
    // beside `clearOrphanBuilds` in the constructor for the same reason and with the same argument.
    crashedMidTurn('sess_crashed')
    expect(statusOf('sess_crashed')).toBe('working')

    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_unused',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'x',
        authNote: null,
        files: [],
      }),
    })

    expect(statusOf('sess_crashed')).toBe('idle')
  })
})
