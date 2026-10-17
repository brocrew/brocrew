import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionHandle,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **652 · a resume that needs no window.**
 *
 * ⛔ **`resumeSession` took `sink: RuntimeEventSink` and `createSession` has taken `| null` since
 * `336`.** `646` measured what the gap costs the moment anything but a window reopens a
 * conversation: the only sink a non-window caller could hand it was one it fabricated — the obvious
 * one being `NO_SURFACE` — and the slot was then reserved under that sink's `ownerId`, so
 * `runningStateOf` answered `in-a-window` and a person pressing to take it over was told
 * *"Switch to that window"* about a window that does not exist.
 *
 * ⚑ **The change is one signature, and every test here is a property it must not have cost.** A
 * `null` resume is reserved under NO owner, exactly as a spawn is, and everything else a reopen
 * does — the refusal of an unknown conversation, the recorded approval mode, the re-read
 * instructions, the commander re-derived from the provenance row — happens exactly as it does for a
 * window.
 *
 * ⚠️ **No production caller passed `null` when this was written.** The IPC boundary passes a
 * window's sink, and the agent verb that would wake a conversation (`resume_agent`) was the next
 * dispatch's — ⚑ `663`'s, whose `RuntimeHost.wakeSession` was the production caller of the null arm
 * until D-017 removed it; ⚑ a delivery's start with no window is now (`ensureRunning`). These tests
 * call the door directly because the door is what this dispatch built.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails, real toolsets.** The provider is
 * the only double, subclassed — as in `a-task-row-that-lies-about-its-holder.test.ts` — to keep the
 * toolset and the options the HOST handed each launch, and to give a Claude handle the per-session
 * sign-in latch `FakeRuntime` has no state for.
 *
 * 🔴 **Every relaunch here is a NEW host over its OWN store object on the same database** — the
 * shape a real launch has, since a new process opens its own. ⚠️ **After `closeAll()` a shared store
 * would behave identically**: `live-hosts` excludes only work another host still holds, and the old
 * one holds nothing once it has closed. ⚑ The separate object is so that no exclusion can ever be
 * the reason a read here passes (`a-next-launch-test-needs-its-own-store-object`, whose case is a
 * CRASH — a host still live — which this relaunch does not model: it follows a quit).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** Everything the host handed the provider, in the order it handed it. */
interface Handed {
  readonly toolsets: AgentToolset[]
  readonly resumes: ResumeOptions[]
  /** Typed as the contract, which is where `checkSignIn` is declared — the Fake does not have one. */
  readonly handles: SessionHandle[]
  starts: number
}

/** ⛔ The provider double: it keeps what it was handed, and it can move the machine credential. */
class WatchingRuntime extends FakeRuntime {
  constructor(
    private readonly runningProvider: Provider,
    private readonly handed: Handed,
    sessions: FakeProviderSessions,
    private readonly credentialGeneration: () => number,
  ) {
    super(runningProvider, { sessions })
  }
  /** ⛔ The real Claude handle remembers the credential it opened with and LATCHES (147). */
  private watch(handle: FakeSessionHandle): FakeSessionHandle {
    this.handed.handles.push(handle)
    if (this.runningProvider !== 'claude') return handle
    const openedWith = this.credentialGeneration()
    let superseded = false
    Object.defineProperties(handle, {
      signInSuperseded: { get: () => superseded, configurable: true },
      checkSignIn: {
        value: async () => {
          if (this.credentialGeneration() !== openedWith) superseded = true
          return superseded
        },
        configurable: true,
      },
    })
    return handle
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    this.handed.starts++
    const handle = await super.start(options)
    if (options.agentTools) this.handed.toolsets.push(options.agentTools)
    return this.watch(handle as FakeSessionHandle)
  }
  override async resume(ref: Parameters<FakeRuntime['resume']>[0], options: ResumeOptions) {
    this.handed.resumes.push(options)
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.toolsets.push(options.agentTools)
    return this.watch(handle as FakeSessionHandle)
  }
}

describe('652 · a resume that needs no window', () => {
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let userData: string
  let root: string
  let counter: number
  let clock: number
  let window: RecordingSink
  let secondWindow: RecordingSink
  let handed: Handed
  let issued: FakeProviderSessions
  let credentialGeneration: number
  /** Every instruction read the host asked for, so a reopen can be shown to have made one. */
  let reads: Array<{ provider: Provider; cwd: string }>
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new WatchingRuntime(provider, handed, issued, () => credentialGeneration),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **A hint that is different on every read**, so the one a reopen hands its provider can
      // only have come from a read made FOR that reopen — never replayed off the row.
      readInstructions: (provider, cwd) => {
        reads.push({ provider, cwd })
        return {
          instructions: {
            injected: [],
            agentMemory: [],
            provider: [],
            refused: [],
            note: '',
            recallsReported: false,
            writesReported: false,
            composed: null,
          },
          systemHint: `the instructions as read at launch #${reads.length}`,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-652-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-652-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = { toolsets: [], resumes: [], handles: [], starts: 0 }
    issued = new FakeProviderSessions()
    credentialGeneration = 0
    reads = []
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⛔ **The app quits and launches again.** The old host closes everything it held — the process is
   * gone — and the new one gets its OWN store object over the same database, so nothing it reads
   * is excused as *running elsewhere* (see the file docblock).
   */
  const relaunch = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost(createSessionStore(db, tick))
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  const refusalOf = async (act: () => unknown): Promise<string> => {
    try {
      await act()
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('the gesture was allowed')
  }

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }
  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.toolsets.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  /**
   * ⛔ **A PM in a window with one child of its own** — `auto`, so the child's turns finish on their
   * own and nothing parks on a card nobody can see.
   *
   * ⚑ **D-016 · the child comes into being by a give**, so its brief is its first turn: in `auto`
   * that turn runs and ends on its own, and the piece it opened is the one the child holds.
   */
  const aPmAndItsWorker = async (
    pmProfile = 'pm',
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens(pmProfile)
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'do it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the woken conversation is nobody's — unwatched, and claimable
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a reopen with no surface is `unwatched`, exactly as a spawn is', () => {
    it('🔴 §1.1 after a relaunch, a null resume is running for NOBODY — and the claim `646` measured refused goes through', async () => {
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      expect(runningOf(worker)).toBe('not-running') // non-vacuity: the relaunch really emptied it

      const woken = await host.resumeSession(worker, null)

      // ⛔ **The trap `646` §5 measured.** Reserved under a fabricated sink's id, this read
      // `in-a-window` — and nothing about it was in one.
      expect(runningOf(worker)).toBe('unwatched')
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([worker])
      expect(woken).toMatchObject({
        sessionId: worker,
        handover: 'resumed',
        // ⚑ This LIFE began with no window, which is what makes a claimer's departure a release.
        startedWithoutAWindow: true,
        // ⚠️ Nobody holds it, so nobody may give it back.
        mayHandItBack: false,
        // 🔴 373's derivation, on a reopen nobody asked for through a window.
        hasACommander: true,
      })

      // 🔴 **And the refusal `646` measured is gone**: *"This conversation is already open in
      // another window. Switch to that window…"* was what a person got here.
      const claimed = host.claimSession(worker, window)
      expect(claimed.sessionId).toBe(worker)
      expect(runningOf(worker)).toBe('in-a-window')
    })

    it("⚑ §1.2 THE CONTROL — the same resume WITH a window is that window's, and nobody else may claim it", async () => {
      // ⛔ **Rule 3's pair, one fact over.** Without it, §1.1 would pass over a host that reserved
      // every reopen under nobody — which is the reverse defect: a person's own Reopen would stop
      // ending with their window.
      const { worker } = await aPmAndItsWorker()
      await relaunch()

      const opened = await host.resumeSession(worker, secondWindow)

      expect(runningOf(worker)).toBe('in-a-window')
      expect(host.unclaimedSessions()).toEqual([])
      expect(await refusalOf(() => host.claimSession(worker, window))).toBe(
        describeUnavailable('already-open-elsewhere'),
      )
      // 🔴 **661 · this half moved** (`656` F2). ⛔ It asserted `startedWithoutAWindow: false` and
      // that the window's departure ENDED an agent's child — which was the defect: closing a window
      // killed a conversation its parent still commands. ⚑ An agent asked for it, so it is born
      // without a surface whoever reopens it, and a departure RELEASES it.
      expect(opened).toMatchObject({ startedWithoutAWindow: true, mayHandItBack: true })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      expect(runningOf(worker)).toBe('unwatched')
    })

    it('⚑ §1.2b …and a conversation a PERSON started still ends with the window that reopened it', async () => {
      // ⛔ **The half §1.2's comment was really guarding**, on the population it is true of: a
      // person's own Reopen of their own conversation still ends with their window (`523` Q3).
      const mine = await personOpens('alpha')
      await relaunch()

      const opened = await host.resumeSession(mine, secondWindow)

      expect(opened).toMatchObject({ startedWithoutAWindow: false, mayHandItBack: false })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      expect(runningOf(mine)).toBe('not-running')
    })

    it("🔴 §1.3 a claim hands the woken conversation's FULL current state — the sign-in latch included", async () => {
      // ⛔ **`643` §4 said a claim hands the latch, citing a test that goes through
      // `attachOpenSessions`.** ⚑ Claim and attach share `attachHeldSession`, so it was a sound
      // reading — and it was a READING. This measures it, on the door, on a conversation nobody
      // was watching when its credential moved.
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      await host.resumeSession(worker, null)
      const handle = handed.handles.at(-1)
      if (handle?.checkSignIn === undefined) throw new Error('the woken handle has no latch')

      credentialGeneration++
      expect(await handle.checkSignIn()).toBe(true)

      const claimed = host.claimSession(worker, window)
      expect(claimed.liveness.signInSuperseded).toBe(true)
      expect(claimed).toMatchObject({
        handover: 'attached',
        startedWithoutAWindow: true,
        // ⚑ The one hand-over where this is `true`: a person took over a conversation nobody asked
        // them to hold, so they may give it back.
        mayHandItBack: true,
        hasACommander: true,
      })

      // ⚑ …and the claimer's departure RELEASES it: it was born, this life, with no window.
      await host.closeSessionsForOwner(window.ownerId)
      expect(runningOf(worker)).toBe('unwatched')
    })

    it('⚑ §1.4 THE CONTROL — an unmoved credential hands over `false`, so §1.3 is not reading a constant', async () => {
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      await host.resumeSession(worker, null)
      const handle = handed.handles.at(-1)
      if (handle?.checkSignIn === undefined) throw new Error('the woken handle has no latch')

      expect(await handle.checkSignIn()).toBe(false)
      expect(host.claimSession(worker, window).liveness.signInSuperseded).toBe(false)
    })

    it('⛔ §1.5 a null resume of a conversation already running is REFUSED — it never becomes a claim', async () => {
      // ⚠️ **`attachHeldSession` hands a session back to the surface that owns it and lost sight of
      // it.** A caller with no surface owns nothing, so there is nothing to hand back: the running
      // conversation goes on to `reserve` and is refused there, and it is still nobody's afterwards.
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      await host.resumeSession(worker, null)

      await waitFor(
        () =>
          store
            .reconciliationReceiptsForOwner(worker)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the existing holder ladder to finish its giver delivery',
      )
      const unclaimedBefore = host.unclaimedSessions().map((entry) => entry.sessionId)
      expect(unclaimedBefore).toContain(worker)
      expect(await refusalOf(() => host.resumeSession(worker, null))).toBe(
        describeUnavailable('held-by-nobody'),
      )
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual(unclaimedBefore)

      // ⚑ **The control: the surface that DOES own it re-attaches**, which is the path the null
      // caller skips.
      host.claimSession(worker, window)
      const again = await host.resumeSession(worker, window)
      expect(again.handover).toBe('attached')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a reopen must still do when nobody is watching it — the brief's §2, one test each
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · everything a reopen does, it still does with no surface', () => {
    it('⛔ §2.1 a conversation the provider cannot find is REFUSED — nothing new is started in its place', async () => {
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      // ⚑ The provider no longer knows the thread — the state a real provider is in when its
      // transcript has gone.
      issued.forgetAll()
      const startsBefore = handed.starts
      const resumesBefore = handed.resumes.length
      const recordedBefore = host.resumableSessions().length

      // ⚠️ **The PROVIDER's refusal, by its words** — found by this dispatch's own review: a bare
      // `rejects.toThrow()` also passes on the pre-652 host, whose null sink threw a `TypeError` on
      // its first line before anything was asked, and on any future guard that refused a null reopen
      // up front. ⚑ So: the provider WAS asked, and it was the provider that said no.
      await expect(host.resumeSession(worker, null)).rejects.toThrow(/unknown session/)
      expect(handed.resumes).toHaveLength(resumesBefore + 1)

      // ⛔ **Refused, and nothing quietly took its place** — no provider STARTED, no slot kept, no
      // row minted, and the id is not left reserved for a second attempt to trip over.
      expect(handed.starts).toBe(startsBefore)
      expect(host.sessionIds).not.toContain(worker)
      expect(host.unclaimedSessions()).toEqual([])
      expect(runningOf(worker)).toBe('not-running')
      expect(host.resumableSessions()).toHaveLength(recordedBefore)
    })

    it('🔴 §2.2 the commander is RE-DERIVED from the provenance row — the parent commands the child it woke nobody for', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // ⚑ A second person-opened conversation, to be the caller the derivation must NOT admit.
      const stranger = await personOpens('stranger')
      await relaunch()

      await host.resumeSession(worker, null)
      await host.resumeSession(stranger, secondWindow)
      const strangerTools = theToolsetJustHandedOut()
      await host.resumeSession(pm, window)
      const pmTools = theToolsetJustHandedOut()

      expect((await callOn(pmTools, 'get_agent_status', { agent: worker })).outcome).toBe('ok')
      // ⛔ **The interrupt reads no reach grant** — it admits the commander and the chain above it,
      // both derived from the provenance row — so it is the verb that proves the derivation rather
      // than a reach grant. ⚑ **D-017 — it was the ending**, and `end_agent` is gone; the stranger
      // is refused `not-below-you`, since `no-such-agent` is said only about an id no conversation
      // has.
      const refused = await callOn(strangerTools, 'interrupt_agent', {
        agent: worker,
        reason: 'not mine to stop',
      })
      expect(refused).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      const admitted = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'the work is done',
      })
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
      expect(admitted.agent).toBe(worker)
    })

    it('🔴 §2.3 the RECORDED approval mode is the one resumed — never the default a person set since, in EITHER direction', async () => {
      // ⛔ **The security half of this dispatch.** A conversation recorded `ask` must not come back
      // running without prompts because somebody later made `auto` the default for NEW
      // conversations — and the reverse must hold too, or a test of one direction would pass over a
      // resume that simply always said `ask`.
      const asked = await personOpens('asked', 'ask')
      const trusted = await personOpens('trusted', 'auto')
      await relaunch()

      host.setDefaultApprovalMode('auto')
      await host.resumeSession(asked, null)
      expect(handed.resumes.at(-1)?.approvalMode).toBe('ask')

      host.setDefaultApprovalMode('ask')
      await host.resumeSession(trusted, null)
      expect(handed.resumes.at(-1)?.approvalMode).toBe('auto')
    })

    it('⚑ §2.4 the instructions are READ AGAIN for the reopen, from the recorded folder — `told.ts` promises the person as much', async () => {
      const { worker } = await aPmAndItsWorker()
      await relaunch()
      const readsBefore = reads.length

      await host.resumeSession(worker, null)

      expect(reads.length).toBe(readsBefore + 1)
      expect(reads.at(-1)).toEqual({ provider: 'claude', cwd: root })
      expect(handed.resumes.at(-1)?.systemHint).toBe(
        `the instructions as read at launch #${reads.length}`,
      )
    })

    it("⛔ §2.5 a woken conversation says NOBODY is behind it — what it sends is not on a person's behalf", async () => {
      // 🔴 **`?? false` on the reservation, and this is the reader that sees it.** A slot nobody
      // owns can never pass `mayAnswerAsAHuman`, so the answer door cannot tell `?? true` from
      // `?? false` here — but `message_sent` records the SLOT's flag as `onBehalfOfAPerson`, and a
      // woken conversation's own message would then claim a person sent it.
      const { pm, worker } = await aPmAndItsWorker()
      await relaunch()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, null)
      const workerTools = theToolsetJustHandedOut()

      // ⚑ **D-016 · a `note`**: a follow-up names a piece the sender gave, and the worker gave none.
      const said = await callOn(workerTools, 'message_agent', {
        agent: pm,
        kind: 'note',
        text: 'is this still wanted?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const sent = ledger(worker).filter((event) => event.type === 'message_sent')
      expect(sent.at(-1)).toMatchObject({ type: 'message_sent', onBehalfOfAPerson: false })
    })

    it("⚑ §2.6 THE CONTROL — the same message from a conversation a WINDOW reopened is on a person's behalf", async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await relaunch()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, secondWindow)
      const workerTools = theToolsetJustHandedOut()

      // ⚑ **D-016 · a `note`**: a follow-up names a piece the sender gave, and the worker gave none.
      const said = await callOn(workerTools, 'message_agent', {
        agent: pm,
        kind: 'note',
        text: 'is this still wanted?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const sent = ledger(worker).filter((event) => event.type === 'message_sent')
      expect(sent.at(-1)).toMatchObject({ type: 'message_sent', onBehalfOfAPerson: true })
    })

    it('⚑ §2.7 what a reopen does to a piece does not depend on who reopened — with no surface it moves nothing too', async () => {
      // ⚠️ **D-016c · a stop and a reopen move no piece**, whoever reopens: a reopen whose events
      // go to `NO_SURFACE` leaves its piece where a window's reopen does, on the cause its own turn
      // wrote. ⚑ **D-016 · the give IS the work**: its brief was the worker's first turn, and in
      // `auto` that turn ends on its own with the piece still open — `turn_ended`, the cause the
      // close and the reopen below both leave standing.
      const { worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      const theOnlyTask = (): { state: string; because: string | null } => {
        const row = store.piecesOwnedBy(worker)[0]
        if (row === undefined) throw new Error(`no piece on ${worker}`)
        return { state: row.state, because: row.stalledBecause }
      }
      await waitFor(
        () => theOnlyTask().state === 'stalled' && theOnlyTask().because === 'turn_ended',
        'the brief to be picked up and its turn to end',
      )
      await host.close(worker, window)
      expect(theOnlyTask()).toEqual({ state: 'stalled', because: 'turn_ended' })

      await host.resumeSession(worker, null)

      expect(theOnlyTask()).toEqual({ state: 'stalled', because: 'turn_ended' })
      expect(runningOf(worker)).toBe('unwatched')
    })
  })
})
