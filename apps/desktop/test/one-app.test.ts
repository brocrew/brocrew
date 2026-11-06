import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProcessExit, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentRuntime,
  ModelChoice,
  ProviderRuntimeContext,
  ResumeOptions,
  SessionHandle,
  SessionRef,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { joinLiveHosts, workRunningElsewhere } from '../src/main/runtime/live-hosts'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import {
  SECOND_LAUNCH_NOTICE,
  STOOD_DOWN_NOTICE,
  runAsSoleInstance,
} from '../src/main/single-instance'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

/** What a caught rejection actually says — never `String(error)`, which prints `[object Object]`. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : `not an Error: ${JSON.stringify(error)}`

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A provider that never answers, so its session stays RESERVED and never registers (062).
 *
 * Everything but `start` is the fake's, because nothing here is about resume or the model list —
 * the whole point is one window in one method.
 */
class NeverArrives implements AgentRuntime {
  readonly provider = 'claude' as const
  private readonly inner = new FakeRuntime('claude')

  start(): Promise<SessionHandle> {
    return new Promise<SessionHandle>(() => {})
  }

  resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    return this.inner.resume(ref, options)
  }

  listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    return this.inner.listModels(context)
  }
}

it('starts immediately from the OS lock without waiting for another ownership answer', async () => {
  const start = vi.fn()
  const pending = runAsSoleInstance({
    requestLock: () => true,
    onSecondLaunch: () => {},
    focusExisting: () => {},
    announce: () => {},
    standDown: () => {},
    start,
    log: () => {},
  })
  expect(start).toHaveBeenCalledOnce()
  await pending
})

describe('one app per data folder', () => {
  it('stands down before startup when the OS lock is held', async () => {
    const start = vi.fn()
    const standDown = vi.fn()
    const log = vi.fn()
    const onSecondLaunch = vi.fn()
    expect(
      await runAsSoleInstance({
        requestLock: () => false,
        start,
        standDown,
        log,
        onSecondLaunch,
        focusExisting: () => {},
        announce: () => {},
      }),
    ).toBe('already-running')
    expect(start).not.toHaveBeenCalled()
    expect(onSecondLaunch).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(STOOD_DOWN_NOTICE)
    expect(standDown).toHaveBeenCalledOnce()
  })
  it('focuses the existing window on a second launch', async () => {
    let second!: () => void
    const focusExisting = vi.fn()
    const announce = vi.fn()
    await runAsSoleInstance({
      requestLock: () => true,
      start: () => {},
      standDown: () => {},
      log: () => {},
      onSecondLaunch: (handler) => {
        second = handler
      },
      focusExisting,
      announce,
    })
    second()
    expect(focusExisting).toHaveBeenCalledOnce()
    expect(announce).toHaveBeenCalledWith(SECOND_LAUNCH_NOTICE)
  })
  describe('work another live host is running', () => {
    let dir: string
    let db: AppDatabase
    let store: SessionStore
    const leaves: (() => void)[] = []

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-one-app-'))
      db = openDatabase(join(dir, 'db.sqlite'))
      applyMigrations(db, migrations)
      store = createSessionStore(db)
    })

    afterEach(() => {
      for (const leave of leaves.splice(0)) leave()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    const SINK = {
      ownerId: 'test',
      aPersonIsBehindIt: false,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }

    const buildHost = (over: Partial<RuntimeHostDeps> = {}): RuntimeHost =>
      new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(dir, 'exports'),
        createRuntime: (provider) => new FakeRuntime(provider),
        prepareProviderHome: (provider) => join(dir, 'homes', provider),
        providerHomePath: (provider) => join(dir, 'homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
        newSessionId: () => `sess_${Math.random().toString(16).slice(2)}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'x',
          authNote: null,
          files: [],
        }),
        ...over,
      })

    /**
     * Another host, standing in the process-wide directory and holding `ids`.
     *
     * ⚠️ **A stand-in and not a second `RuntimeHost`, deliberately.** What the repair consumes is
     * the directory's answer; what a real host CONTRIBUTES to that answer is asserted separately
     * against a real one, two tests below. Splitting them is what stops either half passing on the
     * other's behalf — a single test driving two real hosts would go green if `workInFlight` were
     * honest and the repair ignored it, or the other way round.
     */
    const anotherHostRunning = (...ids: string[]): void => {
      // ⚠️ **Over THIS store**, which is the whole of what makes its ids mean anything here: a host
      // over another database running `sess_1` is running a different conversation, and excluding
      // ours because of it would be 074's defect reintroduced by its own guard.
      leaves.push(joinLiveHosts({ ledger: store, workInFlight: () => ids }))
    }

    /** The same stand-in, over somebody else's database — the control for the line above. */
    const anotherLedgerRunning = (...ids: string[]): void => {
      leaves.push(joinLiveHosts({ ledger: { notThisStore: true }, workInFlight: () => ids }))
    }

    /** A session a dead process left mid-turn — `orphan-runs.test.ts`'s fixture, in one place. */
    const crashedMidTurn = (id: string): void => {
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
      store.append(id, 1, { type: 'user_turn', text: 'run the tests' }, 1_700_000_000_001)
      store.append(id, 2, { type: 'status', state: 'working' }, 1_700_000_000_002)
    }

    const statusOf = (id: string): string | undefined =>
      store.resumable().find((row) => row.sessionId === id)?.status

    const adopted = (id: string): void => {
      store.adopt({
        id,
        provider: 'claude',
        sessionId: `p_${id}`,
        cwd: '/work',
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
    }

    it('⛔ is left exactly as it is when a second host is constructed', () => {
      crashedMidTurn('sess_live')
      anotherHostRunning('sess_live')

      buildHost()

      // 194 H1, failure 1: B closes A's open turn as `unknown` and writes `idle` over a session
      // whose provider is mid-answer. A's real turn terminal can never replace that `unknown`,
      // because `appendTx` closes only the turn that is currently open.
      expect(statusOf('sess_live')).toBe('working')
      expect(store.turns('sess_live')[0]?.endReason).toBeNull()
    })

    it('⛔ …and the paired positive: the SAME construction settles one nobody is running', () => {
      // Without this beside it, the test above is satisfied by a repair that does nothing at all.
      crashedMidTurn('sess_stranded')

      buildHost()

      expect(statusOf('sess_stranded')).toBe('idle')
      expect(store.turns('sess_stranded')[0]?.endReason).toBe('unknown')
    })

    it('⛔ …and a host over ANOTHER database holds nothing here, whatever it calls its sessions', () => {
      // A session id is meaningless without the database it lives in. A guard that forgot this
      // would leave a genuinely stranded row claiming to be busy forever because something
      // unrelated happened to use the same string — 074's defect, reintroduced by its own fix.
      crashedMidTurn('sess_stranded')
      anotherLedgerRunning('sess_stranded')

      buildHost()

      expect(statusOf('sess_stranded')).toBe('idle')
    })

    it('reports what it SETTLED, not what it looked at', () => {
      crashedMidTurn('sess_live')
      crashedMidTurn('sess_stranded')
      anotherHostRunning('sess_live')

      // The number the launch log puts in front of the user. Counting the rows scanned would have
      // it announce repairs to conversations it deliberately left alone.
      expect(store.settleOrphanRuns(1_700_000_100_000, new Set(['sess_live']))).toBe(1)
      expect(statusOf('sess_live')).toBe('working')
      expect(statusOf('sess_stranded')).toBe('idle')
    })

    it("⛔ leaves another host's rebuild marker alone, and clears the one nobody holds", () => {
      // 194 H1, failure 2: B clears A's `building = G`, A goes on writing rows into a generation
      // nothing will promote, `promoteGeneration` then updates zero rows — and the derive still
      // returns success, so the caller is told the import worked.
      adopted('sess_building')
      adopted('sess_abandoned')
      expect(store.beginGeneration('sess_building')).toBeGreaterThan(0)
      expect(store.beginGeneration('sess_abandoned')).toBeGreaterThan(0)
      anotherHostRunning('sess_building')

      buildHost()

      expect(store.ledgerStatus('sess_building').derived).toBe('rebuilding')
      expect(store.ledgerStatus('sess_abandoned').derived).not.toBe('rebuilding')
    })

    it('a live host says a session in a slot is work in flight', async () => {
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)

      expect([...host.workInFlight()]).toContain(created.sessionId)

      await host.close(created.sessionId, SINK)
      expect([...host.workInFlight()]).not.toContain(created.sessionId)
    })

    it('⛔ …and one that is only RESERVED, whose provider has not arrived', async () => {
      // 062's rule: ownership begins when the id is taken, before the provider answers. That window
      // is exactly where a second host's repair would land — the row is `working`, nothing is
      // registered, and `sessionIds` (which filters to sessions with a handle to drive) would report
      // silence. `workInFlight` reads the slot MAP for this reason.
      const host = buildHost({
        createRuntime: () => new NeverArrives(),
        newSessionId: () => 'sess_reserved',
        // ⚠️ **Short deadlines, because the WAIT is not what is under test.** A launch that never
        // arrives is given up on at `launchTimeoutMs` (102), and the default fifteen seconds is
        // fifteen seconds of `pnpm run ci` spent asserting nothing. The reservation is taken
        // synchronously inside `createSession`, so the assertion below is already true before this
        // clock has ticked at all.
        launchTimeoutMs: 500,
        closeDrainTimeoutMs: 25,
      })
      const opening = host.createSession({ provider: 'claude', cwd: dir }, SINK)
      void opening.catch(() => {})

      await waitFor(() => [...host.workInFlight()].includes('sess_reserved'), 'the reservation')

      // Handed back, so the pending launch ends rather than running out this file's clock.
      await host.closeAll()
      await opening.catch(() => {})
      // 🔴 **This line used to assert silence, and the silence was the defect** (265 §3, from 259
      // lens B finding 3). The reservation really is gone — `awaitLaunch` abandons it when the bound
      // expires — but the LAUNCH is deliberately retained, because a handshake that never answered
      // never confirmed its child died. `closeAll` says so out loud in the same breath: *"1 provider
      // launch(es) had not confirmed termination … a provider process may still be running"*. So the
      // honest answer to *"what is this host holding"* is this id, and the old `[]` is exactly what
      // a second host could not see before it started a provider onto the same transcript.
      //
      // ⚑ **The pairing is a separate test** — *"a host that has closed everything stops holding its
      // work"* — where the provider DOES confirm and this method goes empty. Without it, the
      // assertion below would be satisfied by a host that never let anything go.
      expect([...host.workInFlight()]).toEqual(['sess_reserved'])
    })

    it('⛔ …and a REBUILD, which no slot ever names', async () => {
      // `rebuildLedger` refuses a session that is in `slots` as `in-use`, so every in-flight rebuild
      // is by construction a session no slot names. A slots-only answer would report silence here.
      adopted('sess_rebuilding')
      const path = join(dir, 'fictional-rebuild.jsonl')
      writeFileSync(path, '{"type":"user","message":{"role":"user","content":"fictional"}}\n')
      const host = buildHost({ nativeTranscriptPath: () => path })

      const pending = host.rebuildLedger('sess_rebuilding')
      // Synchronous on purpose: the count is taken before the first suspension, which is the window
      // a host constructed beside this one would land in.
      expect([...host.workInFlight()]).toContain('sess_rebuilding')

      await pending
      expect([...host.workInFlight()]).not.toContain('sess_rebuilding')
    })

    it('is not asked about itself', async () => {
      // A host that counted its own work would refuse to repair anything it happened to be running,
      // which at construction is nothing — but the day it is not, the guard would be silently
      // permanent rather than about other hosts.
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)

      expect([...workRunningElsewhere(host)]).not.toContain(created.sessionId)

      await host.close(created.sessionId, SINK)
    })

    it('⛔ refuses to resume a conversation another live host is running', async () => {
      // 191 H7 / 194 H2: reservation is synchronous, and that is what makes it a lock — over this
      // host's own map only. Two hosts both find the id free, both read the same `nextOrdinal`, and
      // the one that loses the unique-index race stops recording for the rest of that session's life
      // while its provider goes on producing output nobody writes down.
      crashedMidTurn('sess_contested')
      anotherHostRunning('sess_contested')
      const host = buildHost()

      const refusal = await host
        .resumeSession('sess_contested', SINK)
        .catch((error: unknown) => error)

      // ⚠️ **The SENTENCE, because that is what crosses IPC.** `refusalTranslated` logs the
      // diagnostic — which carries the id — and throws a hand-written, id-free line in its place
      // (100). Asserting the discriminant here would pin a value the surface never receives.
      expect(errorText(refusal)).toBe(describeUnavailable('run-by-another-host'))
      expect(errorText(refusal)).not.toContain('sess_contested')
      // ⛔ **And it did not settle the row on its way to refusing.** `resumeSession` closes the open
      // turn as `unknown` before it launches; a refusal that ran that first would have done 194 H1's
      // damage in the course of preventing 194 H2's.
      expect(statusOf('sess_contested')).toBe('working')
    })

    it('⛔ refuses to REBUILD a conversation another live host is running', async () => {
      // 191 H8: `slots` is host-local, so a second host finds the id free and promotes a new active
      // generation underneath the first. The first's already-written tail becomes unreachable and
      // its next append reuses ordinals in a generation that is no longer the active one.
      adopted('sess_contested_build')
      anotherHostRunning('sess_contested_build')

      const refused = await buildHost().rebuildLedger('sess_contested_build')

      expect(refused.outcome).toBe('in-use')
    })

    it('⛔ …and the paired positive: it rebuilds one nobody is running', async () => {
      // Without this, the test above is satisfied by a `rebuildLedger` that refuses everything.
      adopted('sess_free_build')

      const allowed = await buildHost().rebuildLedger('sess_free_build')

      expect(allowed.outcome).not.toBe('in-use')
    })

    /**
     * 🔴 **265 §3 · the retained launch tail, asked by the host that cannot see it**
     * (259 lens B finding 3).
     *
     * ⛔ **The launch registry is private to one host; cross-host exclusion runs over the shared
     * ledger.** `finish(launch, terminated)` deliberately keeps owning a subject after a bounded stop
     * gives up — that is 068 finding 2 — but the only question that reaches it is
     * `LaunchRegistry.refuse`, and host B asks its OWN registry, which has never heard of A's entry.
     * Meanwhile finalization has already deleted A's slot, so `workInFlight` advertised nothing.
     * B then started a second provider against the same provider reference and native transcript
     * while A's first may still have been alive and writing it.
     *
     * ⚠️ **Two REAL hosts, because this is about what a host CONTRIBUTES**, not about what the
     * directory does with it — the stand-in above answers the other half.
     */
    it('🔴 265 §3 · a retained launch tail is refused to another host over the same ledger', async () => {
      const exit = new FakeProcessExit()
      const sessions = new FakeProviderSessions()
      const createRuntime = (provider: 'claude' | 'codex'): AgentRuntime =>
        new FakeRuntime(provider, { exit, sessions })
      const first = buildHost({ createRuntime, newSessionId: () => 'sess_tail' })
      await first.createSession({ provider: 'claude', cwd: dir }, SINK)
      await first.close('sess_tail', SINK)

      // ⛔ **The exact state the finding describes**, and all three halves are asserted because any
      // one of them alone would make the refusal below mean something different: the slot is gone,
      // the process was never confirmed dead, and the launch is still owned.
      expect(first.sessionIds, 'the slot is gone').toEqual([])
      expect(exit.isConfirmed, 'and nothing confirmed the process died').toBe(false)
      expect([...first.workInFlight()], 'so the host still advertises it').toContain('sess_tail')

      const second = buildHost({ createRuntime })
      const refusal = await second.resumeSession('sess_tail', SINK).catch((error: unknown) => error)
      expect(errorText(refusal)).toBe(describeUnavailable('run-by-another-host'))
      expect(errorText(refusal)).not.toContain('sess_tail')

      // ⚑ **Paired: confirming the exit releases it.** Without this the test would pass against a
      // host that refused every cross-host resume forever — which is 149's stranded conversation
      // arriving through the fix for 068's double provider.
      exit.confirm()
      await waitFor(
        () => ![...first.workInFlight()].includes('sess_tail'),
        'the retained tail to be released',
      )
      const reopened = await second.resumeSession('sess_tail', SINK)
      expect(reopened.sessionId).toBe('sess_tail')
      await second.closeAll()
      await first.closeAll()
    })

    it('a host that has closed everything stops holding its work — by closing it', async () => {
      // ⛔ **The first version of this test passed for the wrong reason**, and 198's mutation table
      // is what said so: M12 removed the `closeAll` that used to leave the directory and came back
      // GREEN. The host it built held no sessions, so the guard it was meant to prove was never
      // asked anything. The host holds a REAL session now, and what is asserted is the mechanism
      // that actually releases it: `closeAll` closes every session, so the slots empty — the
      // directory has nothing to do with it, and `live-hosts.ts` carries why the leave was removed
      // rather than repaired.
      const first = buildHost()
      const created = await first.createSession({ provider: 'claude', cwd: dir }, SINK)
      expect([...first.workInFlight()]).toContain(created.sessionId)

      crashedMidTurn('sess_handover')
      await first.closeAll()
      expect([...first.workInFlight()]).toEqual([])

      // The guard must not be permanent: an app that quit and relaunched in one process — which is
      // what a test file is — has to repair the row the previous host left.
      buildHost()

      expect(statusOf('sess_handover')).toBe('idle')
    })
  })
})
