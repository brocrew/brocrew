import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 421 · what the host says it is DOING with a row, and what a gesture costs
 *
 * ## The two questions this file exists for
 *
 * ⛔ **HO-023 §2.3 ruled that a conversation the app is running must never be drawn as ended, and
 * that the gesture a person is offered must be one that works.** The rail's half of that is a fold
 * over a wire field; this is the field itself — `RunningState`, answered from the slot map — and
 * the cost of the gesture it unlocks.
 *
 * 🔴 **§2 is the half the dispatch said to measure BEFORE shipping the gesture.** `418` §2.3 found
 * that a REOPEN re-reserves a conversation under the reopening window's own `ownerId`, so from that
 * moment a window close, a reload or a renderer crash CLOSES it — where the same gesture a minute
 * earlier would only have released it. ⚠️ If a claim did the same, the fix would hand a person a
 * working gesture that quietly makes their conversation mortal, which is not an improvement over a
 * refusal. **It does not, and the field that decides it is a birth fact.**
 *
 * ## ⚠️ Why a host test and not a demo test
 *
 * `two-sessions-of-one-agent.demo.test.ts` walks the whole chain to the rail's fold, which is what
 * makes it able to say what a PERSON sees. What is here is what the host itself answers, including
 * two states no rail can produce on demand — a slot that is on its way out, and a row that was
 * written before this process existed.
 */

/** A `FakeRuntime` per launch over one shared ledger of provider sessions — a resume needs it. */
function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

/** A promise somebody else resolves — `reopen-while-closing.test.ts`'s helper, same shape. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

/**
 * A handle that announces its ending and then keeps tearing down — `418`'s proxy, reused verbatim
 * because it is the only way to hold a slot in `closing` long enough to ask it anything.
 */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('421 · a live conversation is never drawn as ended', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let window1: WindowSink
  let window2: WindowSink
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-421-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = sharedRuntime(provider, sessions)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      // ⚠️ **A bound on the MACHINE, not on the rule** (`418`'s note). One test parks a teardown on
      // purpose and the default 5 s drain would be charged to this suite for it.
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window1 = new WindowSink('webContents:1')
    window2 = new WindowSink('webContents:2')
  })

  afterEach(async () => {
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (sink: RuntimeEventSink | null): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      sink,
    )
    return sessionId
  }

  /** What the two list commands say about one id — the field, from both halves. */
  const runningOf = (sessionId: string): string | undefined => {
    const rows = [...host.resumableSessions(), ...host.unresumableSessions()]
    return rows.find((row) => row.sessionId === sessionId)?.running
  }

  const statusOf = (sessionId: string): string | undefined => {
    const rows = [...host.resumableSessions(), ...host.unresumableSessions()]
    return rows.find((row) => row.sessionId === sessionId)?.status
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the field, and the column that cannot stand in for it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · what the host says it is doing with a recorded row', () => {
    it('🔴 tells the three states apart, and every one of them is reachable', async () => {
      const unwatched = await open(null)
      const held = await open(window1)
      // A row this host has never run: written straight to the ledger, which is the shape a
      // previous process leaves behind.
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      expect(runningOf(unwatched)).toBe('unwatched')
      expect(runningOf(held)).toBe('in-a-window')
      expect(runningOf('sess_from_a_dead_process')).toBe('not-running')
    })

    it('🔴 …and the STATUS column cannot, which is why the field exists', async () => {
      const live = await open(null)
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      // ⛔ **The two rows read the same column and the app is running one of them.** `418` assumed
      // a fix needed no new field because `ResumableSessionInfo` already carries `status`; this is
      // the measurement that says otherwise. `settleOrphanRuns` settles a stranded `working` row to
      // **`idle`** at the next launch, and a conversation that was open and idle when the app died
      // was never non-terminal to begin with — so `idle` is what both of these say, forever.
      expect(statusOf(live)).toBe('idle')
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
      expect(runningOf(live)).toBe('unwatched')
      expect(runningOf('sess_from_a_dead_process')).toBe('not-running')

      // ⚑ **And both halves of that claim are asserted rather than remembered**, because the
      // paragraph above is the whole reason this field exists.
      //
      // ⛔ **A stranded RUN settles to a non-terminal status.** This is the call `settleOrphanRuns`
      // makes for each row it finds — `settleTx(id, 'unknown', at, null)` — and its write is
      // `terminal ?? 'idle'`.
      ledger.closeOpenTurn('sess_from_a_dead_process', 'unknown', Date.now())
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
      // ⛔ **And a row that was already `idle` is not swept at all**: the launch sweep selects only
      // `working` and `waiting_permission`, so a conversation that was open and NOT mid-turn when
      // the app died keeps the `idle` it already had, for ever.
      expect(ledger.settleOrphanRuns(Date.now(), new Set())).toBe(0)
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
    })

    it('⚠️ a conversation on its way OUT is not running, and the claim door agrees', async () => {
      closeGate = deferred()
      const sessionId = await open(null)
      const ending = host.close(sessionId, THE_APP_ITSELF)
      await waitFor(
        () => ledger.events(sessionId).some((one) => one.event.type === 'status'),
        'the provider to announce its ending while the teardown is parked',
      )

      // ⛔ **`not-running`, and it is a ruling rather than a rounding.** A claim on it is refused —
      // so offering a take-over would be offering a gesture that cannot work — while the REOPEN is
      // the gesture that does: `075` made `resumeSession` wait a teardown out and then reopen.
      expect(host.sessionIds).toContain(sessionId)
      expect(runningOf(sessionId)).toBe('not-running')
      expect(() => host.claimSession(sessionId, window1)).toThrow(
        describeUnavailable('still-closing'),
      )

      // ⚑ The control: released, the same id goes back to being a row nothing is running.
      closeGate.release()
      await ending
      expect(runningOf(sessionId)).toBe('not-running')
      expect(host.sessionIds).not.toContain(sessionId)
    })

    it('⚑ both list commands carry it, and neither half is the half with the live rows', async () => {
      // ⛔ **A live conversation can be in EITHER list, which is why the field is on both.** Which
      // one a row lands in is decided by whether it has a provider ref — `hasSomewhereToReopen` —
      // and a real Claude session has none until its first turn's init arrives, so the newest
      // conversation in the app is routinely in the half with no ref. ⚠️ **The double hands one
      // over at start**, so the live-row-without-a-ref case is asserted where it can be built by
      // hand: `closed-threads.test.ts`'s *"the UNRESUMABLE half carries it too"*.
      const live = await open(null)
      ledger.create({
        id: 'sess_no_ref',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      const resumable = host.resumableSessions()
      const unresumable = host.unresumableSessions()
      // Non-vacuity: both lists really have a row in them, or the loop below asserts over nothing.
      expect(resumable.map((row) => row.sessionId)).toContain(live)
      expect(unresumable.map((row) => row.sessionId)).toContain('sess_no_ref')
      for (const row of [...resumable, ...unresumable]) {
        expect(row.running, row.sessionId).toBeDefined()
      }
      expect(resumable.find((row) => row.sessionId === live)!.running).toBe('unwatched')
      expect(unresumable.find((row) => row.sessionId === 'sess_no_ref')!.running).toBe(
        'not-running',
      )

      // ⚑ …and it moves with the owner rather than with the list: the same row, claimed.
      host.claimSession(live, window1)
      expect(host.resumableSessions().find((row) => row.sessionId === live)!.running).toBe(
        'in-a-window',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · 🔴 what the gesture COSTS — measured before it shipped
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what taking a conversation over costs, against what reopening one costs', () => {
    it('🔴 a claim does NOT make the conversation mortal — the window goes and it lives', async () => {
      const sessionId = await open(null)
      host.claimSession(sessionId, window1)

      // ⚠️ **A renderer RELOAD is this call**, not only a window being closed — `index.ts` wires it
      // to `SESSION_RELEASE_EVENTS`, *"closed, crashed, or reloaded into a renderer that has
      // forgotten them"*.
      window1.alive = false
      await host.closeSessionsForOwner('webContents:1')

      // 🔴 **336's birth fact holds**: `bornWithoutASurface` is fixed at reservation and survives
      // every claim, so a departing owner RELEASES a conversation it merely took over. ⛔ This is
      // what makes the rail's new gesture safe to ship: a person who takes a spawned conversation
      // over and then reloads has not destroyed it.
      expect(host.sessionIds).toContain(sessionId)
      expect(runningOf(sessionId)).toBe('unwatched')
      expect(ledger.find(sessionId)?.status).not.toBe('ended')
      // ⚑ …and nothing was written about it ending, which is the ledger half of the same claim.
      expect(ledger.events(sessionId).map((one) => one.event.type)).not.toContain(
        'conversation_ended',
      )

      // ⚑ **The control, in the same call**: a conversation this window STARTED goes with it.
      // Without this, "it survived" would be a fact about `closeSessionsForOwner` doing nothing.
      const started = await open(window1)
      await host.closeSessionsForOwner('webContents:1')
      expect(host.sessionIds).not.toContain(started)
      expect(host.sessionIds).toContain(sessionId)
    })

    it('🔴 a REOPEN does — and that is a finding this dispatch pins rather than fixes', async () => {
      // ⛔ **`418` §2.3, asserted rather than described.** `resumeSession` re-reserves the id, and
      // `reserve` writes `bornWithoutASurface: ownerId === null` — so a conversation that was born
      // without a surface and is REOPENED by a window is, from that moment, one the window's
      // departure ends. ⚠️ A reload, a renderer crash and a window close are all the same call.
      //
      // ⚑ **661 · still true HERE, and no longer of an agent's child** (`656` F2). The reservation
      // now also reads `anAgentAskedForIt` — the durable spawn provenance (341) — so a conversation
      // an AGENT asked for keeps its hand-back through a reopen
      // (`what-a-close-does-that-a-reopen-never-undoes.test.ts` §1). ⛔ This one was opened through
      // 336's no-surface door by nobody, which no row records, so this pin still stands for it.
      const spawned = await open(null)
      await host.close(spawned, THE_APP_ITSELF)
      expect(ledger.find(spawned)?.status).toBe('ended')

      const reopened = await host.resumeSession(spawned, window1)
      expect(reopened.sessionId).toBe(spawned)
      expect(runningOf(spawned)).toBe('in-a-window')

      window1.alive = false
      await host.closeSessionsForOwner('webContents:1')

      // 🔴 **Closed, not released.** The same gesture, on the same conversation, a minute apart:
      // taken over it survives, reopened it does not.
      expect(host.sessionIds).not.toContain(spawned)
      expect(runningOf(spawned)).toBe('not-running')

      // ⚑ **The pair, in one test, which is the whole point of putting them here.** A conversation
      // this window CLAIMED survives the identical call.
      const claimed = await open(null)
      host.claimSession(claimed, window2)
      window2.alive = false
      await host.closeSessionsForOwner('webContents:2')
      expect(host.sessionIds).toContain(claimed)
    })

    it('⚠️ …and the repair for that is a later slice, named rather than improvised', () => {
      // ⛔ **Nothing about ownership is persisted** — `ownerId` appears in no migration, and
      // `SessionSlot.spawnedBy`'s own note says the field dies with the process. So a reopen cannot
      // restore *"this conversation was nobody's"* from the ledger: the fact is not there to
      // restore. ⚑ **661 used the one fact that IS there** — who SPAWNED it (341's provenance) —
      // which repairs the agent's-child half and leaves this one, the surface-less conversation
      // nobody spawned, exactly as it was. ⚑ Making it restorable is the persisted-session-ref work the code already calls a
      // later slice, and this assertion is here so the gap cannot be closed silently or forgotten.
      // ⚠️ The claim is about the ROW, and it is asserted against the store's own shape: a recorded
      // session says who spawned it and never says who was watching it, so a reopen has nothing to
      // read the old answer back out of.
      ledger.create({
        id: 'sess_shape',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })
      const row = ledger.recordedOne('sess_shape')
      expect(row).not.toBeNull()
      expect(Object.keys(row as object)).not.toContain('ownerId')
    })
  })
})
