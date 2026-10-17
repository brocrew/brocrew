import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import {
  HELD_ELSEWHERE,
  type ResumedSession,
  type RuntimeBridge,
  type RuntimeCommand,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { asTheWireWouldCarry, everythingOverTheWire } from './lib/the-wire'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * D-017b · a look takes what a press may take, and nothing else.
 *
 * ## The property
 *
 * The `look` door draws ONE conversation for a person's window, whatever its process is doing, and
 * starts nothing. What it may TAKE is narrow and it is the whole of what this file measures:
 *
 *  - a conversation this window already owns is attached, press or no press;
 *  - a conversation running with no window is taken only when the caller PRESSED (`claim` is
 *    exactly `true` on the wire), and by the claim's own rule (nobody owns it);
 *  - every other conversation is drawn from its ledger, `recorded`: nothing running it, one another
 *    window has open, one still settling a stop, and one whose provider has said it is over.
 *
 * ## What is measured, and where
 *
 *  - Section 1 drives the host's `look` directly, through a real ledger, real migrations and a
 *    `FakeRuntime` that counts every start and every resume, so "started nothing" is a count and
 *    not an absence.
 *  - Section 2 drives the wire (`executeRuntimeCommand`) for the flag's exact spelling, and the
 *    real renderer store over the real dispatcher for the release, so the `claim: false` of the
 *    look again is measured where the host reads it.
 *  - Section 3 scripts the bridge so the answer to a look can be held while events arrive: the one
 *    look again, the bound on it, and what a refused look leaves. The scripted bridge parses every
 *    look through `runtimeCommandSchema` and the clone of `the-wire.ts`, so it cannot record a
 *    payload the wire would refuse.
 *
 * Every negative assertion is paired with the positive that shows the sample could have gone the
 * other way, in the same test.
 */

/**
 * A `FakeRuntime` that keeps the handles it issues and COUNTS every launch, start or resume, so a
 * test can say a look started nothing.
 */
class CapturingRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  readonly launches: ('start' | 'resume')[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.launches.push('start')
    this.issued.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, opts: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, opts)
    this.launches.push('resume')
    this.issued.push(handle)
    return handle
  }
  latest(): FakeSessionHandle {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/** A window as the app builds one: a sink, and a bridge that reaches the host over the wire. */
class AWindow {
  readonly sink: RuntimeEventSink
  /** Every command kind this window sent, in order. */
  readonly commands: string[] = []
  /** Every look this window sent, exactly as the host's dispatcher received it. */
  readonly looks: { sessionId: string; claim: boolean | undefined }[] = []
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []

  constructor(
    private readonly host: RuntimeHost,
    ownerId = 'webContents:1',
  ) {
    const events = this.events
    const liveness = this.liveness
    this.sink = {
      ownerId,
      aPersonIsBehindIt: true,
      get alive() {
        return true
      },
      send: (message) => events.forEach((listener) => listener(message)),
      sendLiveness: (message) => liveness.forEach((listener) => listener(message)),
    }
  }

  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> => {
      this.commands.push(command.kind)
      if (command.kind === 'look') {
        this.looks.push({ sessionId: command.sessionId, claim: command.claim })
      }
      return (await executeRuntimeCommand(this.host, this.sink, command)) as T
    }
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      resume: (input) => run({ kind: 'resume', ...input }),
      startAndSend: (input) => run({ kind: 'startAndSend', ...input }),
      cancelLaunch: (input) => run({ kind: 'cancelLaunch', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      send: (input) => run({ kind: 'send', ...input }),
      close: (input) => run({ kind: 'close', ...input }),
      look: (input) => run({ kind: 'look', ...input }),
      release: (input) => run({ kind: 'release', ...input }),
      listResumable: () => run({ kind: 'listResumable' }),
      listUnresumable: () => run({ kind: 'listUnresumable' }),
      onEvent: (fn) => {
        this.events.push(fn)
        return () => void this.events.splice(this.events.indexOf(fn), 1)
      },
      onLiveness: (fn) => {
        this.liveness.push(fn)
        return () => void this.liveness.splice(this.liveness.indexOf(fn), 1)
      },
      onChanged: () => () => {},
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

const NOT_RECORDED = describeUnavailable('not-recorded')

describe('D-017b · a look takes what a press may take, and nothing else', () => {
  describe('section 1 · the host door, through a real ledger', () => {
    let userData: string
    let db: AppDatabase
    let host: RuntimeHost
    let ledgerStore: SessionStore
    let runtimes: Map<Provider, CapturingRuntime>
    let one: RecordingSink
    let two: RecordingSink
    let wins: AWindow[]
    let stops: (() => void)[]
    /** The caller an agent-born conversation is spawned FOR: it owns nothing and watches nothing. */
    const PLANNER = { ownerId: 'mcp:planner' }
    const handles = new Map<string, FakeSessionHandle>()

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-a-look-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      runtimes = new Map()
      handles.clear()
      wins = []
      stops = []
      ledgerStore = createLedger(db)
      let counter = 0
      host = new RuntimeHost({
        store: ledgerStore,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => {
          const held = runtimes.get(provider) ?? new CapturingRuntime(provider)
          runtimes.set(provider, held)
          return held
        },
        prepareProviderHome: (provider) => {
          const home = join(userData, 'provider-homes', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
        newSessionId: () => `sess_${++counter}`,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      one = new RecordingSink('webContents:1')
      two = new RecordingSink('webContents:2')
    })

    afterEach(async () => {
      for (const stop of stops.splice(0)) stop()
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    const provider = (): CapturingRuntime => {
      const held = runtimes.get('claude')
      if (held === undefined) throw new Error('no claude runtime was built')
      return held
    }

    const ledger = (sessionId: string): TranscriptEvent[] =>
      ledgerStore.events(sessionId).map((entry) => entry.event)

    /** Provider starts and resumes so far: the count a look must leave alone. */
    const launches = (): number => provider().launches.length

    /** A conversation nobody asked for, running with no window, that one agent may drive. */
    const openAgentBorn = async (): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', cwd: userData },
        null,
        PLANNER,
      )
      handles.set(sessionId, provider().latest())
      return sessionId
    }

    /** The control one fact over: the same launch, asked for by a window, so that window owns it. */
    const openFor = async (sink: RuntimeEventSink): Promise<string> => {
      const { sessionId } = await host.createSession({ provider: 'claude', cwd: userData }, sink)
      handles.set(sessionId, provider().latest())
      return sessionId
    }

    const handleOf = (sessionId: string): FakeSessionHandle => {
      const handle = handles.get(sessionId)
      if (handle === undefined) throw new Error(`no provider handle held for ${sessionId}`)
      return handle
    }

    async function agentSays(sessionId: string, text: string): Promise<void> {
      handleOf(sessionId).simulateActivity('thinking', text)
      await waitFor(
        () => ledger(sessionId).some((e) => e.type === 'activity' && e.detail === text),
        `the ledger to hold ${text}`,
      )
    }

    const said = (events: readonly TranscriptEvent[], text: string): boolean =>
      events.some((e) => e.type === 'activity' && e.detail === text)

    const isUnclaimed = (sessionId: string): boolean =>
      host.unclaimedSessions().some((row) => row.sessionId === sessionId)

    const reaches = (sessionId: string, sink: RuntimeEventSink): boolean =>
      host.agentCard(sessionId, sink, null) !== null

    /** Something a person can end in one act: a conversation started for a window, then stopped. */
    const openThenEnded = async (): Promise<string> => {
      const sessionId = await openFor(one)
      await agentSays(sessionId, 'said before it stopped')
      await host.close(sessionId, one)
      await waitFor(() => !host.sessionIds.includes(sessionId), 'the conversation to stop')
      return sessionId
    }

    it('a look that is not a press takes nothing from a conversation running with no window, and a press takes it', async () => {
      const sessionId = await openAgentBorn()
      await agentSays(sessionId, 'before anybody looked')
      expect(isUnclaimed(sessionId)).toBe(true)

      // The look nobody pressed: drawn from the ledger, and the conversation is still nobody's.
      const plain = await host.look(sessionId, one, false)
      expect(plain.handover).toBe('recorded')
      expect(
        said(
          plain.history.entries.map((entry) => entry.event),
          'before anybody looked',
        ),
      ).toBe(true)
      expect(isUnclaimed(sessionId)).toBe(true)
      expect(reaches(sessionId, one)).toBe(false)

      // The press, on the same conversation with the same sink: this is what makes the sample a
      // measurement, because a look that could never take it would leave the pair above vacuous.
      const pressed = await host.look(sessionId, one, true)
      expect(pressed.handover).toBe('attached')
      expect(isUnclaimed(sessionId)).toBe(false)
      expect(reaches(sessionId, one)).toBe(true)
      expect(launches()).toBe(1)
    })

    it('the owner of a conversation is handed it live, and a stranger who presses is handed the record and told who holds it', async () => {
      const sessionId = await openFor(one)
      await agentSays(sessionId, 'said while owned')

      // The owner, press or not: attached, never demoted to a record by the look.
      const owner = await host.look(sessionId, one, true)
      expect(owner.handover).toBe('attached')
      const ownerNoPress = await host.look(sessionId, one, false)
      expect(ownerNoPress.handover).toBe('attached')

      // A second window presses: the press cannot take what somebody owns.
      const stranger = await host.look(sessionId, two, true)
      expect(stranger.handover).toBe('recorded')
      expect(stranger.cannotTakeAMessage).toBe(HELD_ELSEWHERE)
      // Something runs it, so the record has no seam to settle at.
      expect(stranger.liveFrom).toBeUndefined()

      // Ownership did not move, and the stream still goes to its owner and not to the stranger.
      expect(reaches(sessionId, one)).toBe(true)
      expect(reaches(sessionId, two)).toBe(false)
      const before = one.messages.length
      await agentSays(sessionId, 'said after the stranger pressed')
      await waitFor(() => one.messages.length > before, 'the owner to be sent the event')
      expect(said(one.events(), 'said after the stranger pressed')).toBe(true)
      expect(two.messages).toEqual([])
    })

    it('a look at a conversation nothing runs starts nothing and reports where the page stopped, and a running one reports none', async () => {
      const stopped = await openThenEnded()
      const running = await openAgentBorn()
      await agentSays(running, 'said while running')
      const startedSoFar = launches()

      const recordedOnly = await host.look(stopped, one, false)
      expect(recordedOnly.handover).toBe('recorded')
      expect(recordedOnly.liveFrom).toBe(ledgerStore.nextOrdinal(stopped))
      expect(recordedOnly.liveFrom).toBeGreaterThan(0)

      // A press is no start either: the look never asks the provider for anything.
      const pressed = await host.look(stopped, one, true)
      expect(pressed.handover).toBe('recorded')
      expect(pressed.liveFrom).toBe(ledgerStore.nextOrdinal(stopped))
      expect(launches()).toBe(startedSoFar)
      expect(host.sessionIds).not.toContain(stopped)

      // The same non-press look at one that IS running: no seam, because nothing has stopped.
      const runningRecord = await host.look(running, one, false)
      expect(runningRecord.handover).toBe('recorded')
      expect(runningRecord.liveFrom).toBeUndefined()
      expect(launches()).toBe(startedSoFar)
    })

    it('a recorded hand-over feeds the window no events, and the press that attaches one does', async () => {
      const sessionId = await openAgentBorn()

      const recorded = await host.look(sessionId, one, false)
      expect(recorded.handover).toBe('recorded')
      await agentSays(sessionId, 'said while only recorded')
      await letItSettle()
      // The ledger holds it (agentSays waited for that); the window was sent none of it.
      expect(one.messages).toEqual([])

      const attached = await host.look(sessionId, one, true)
      expect(attached.handover).toBe('attached')
      // What came before the press is in the page it is handed, not sent again as events.
      expect(
        said(
          attached.history.entries.map((entry) => entry.event),
          'said while only recorded',
        ),
      ).toBe(true)
      expect(one.messages).toEqual([])

      await agentSays(sessionId, 'said after the press')
      await waitFor(() => said(one.events(), 'said after the press'), 'the window to be fed')
      expect(said(one.events(), 'said while only recorded')).toBe(false)
    })

    it('a look after the stream FAILED waits out the teardown and hands over the record, not the life that died', async () => {
      const failing = await openAgentBorn()
      await agentSays(failing, 'said before the stream failed')
      const healthy = await openAgentBorn()
      const startedSoFar = launches()

      // The failure and the look in the same tick: the slot is still registered, its handle says
      // `errored`, and the pump has not reached the finalizer.
      handleOf(failing).simulateError('the provider fell over', true)
      const handed = await host.look(failing, one, true)

      expect(handed.handover).toBe('recorded')
      expect(handed.liveness.state).toBe('ended')
      expect(handed.liveFrom).toBe(ledgerStore.nextOrdinal(failing))
      expect(
        said(
          handed.history.entries.map((entry) => entry.event),
          'said before the stream failed',
        ),
      ).toBe(true)
      // The teardown was waited out, so nothing is left registered, owned or listed as unclaimed.
      expect(host.sessionIds).not.toContain(failing)
      expect(isUnclaimed(failing)).toBe(false)
      expect(reaches(failing, one)).toBe(false)
      expect(launches()).toBe(startedSoFar)

      // The control: the same press on a healthy windowless conversation IS attached, so the
      // record above came from the failure and not from a press that could never take anything.
      const attached = await host.look(healthy, one, true)
      expect(attached.handover).toBe('attached')
    })

    it('a look after the provider ENDED on its own waits out the teardown and hands over the record', async () => {
      const ending = await openAgentBorn()
      await agentSays(ending, 'said before the provider ended')
      const healthy = await openAgentBorn()
      const startedSoFar = launches()

      // The provider stops itself and the look lands in the same tick.
      void handleOf(ending).close()
      const handed = await host.look(ending, one, true)

      expect(handed.handover).toBe('recorded')
      expect(handed.liveness.state).toBe('ended')
      expect(handed.liveFrom).toBe(ledgerStore.nextOrdinal(ending))
      expect(
        said(
          handed.history.entries.map((entry) => entry.event),
          'said before the provider ended',
        ),
      ).toBe(true)
      expect(host.sessionIds).not.toContain(ending)
      expect(isUnclaimed(ending)).toBe(false)
      expect(reaches(ending, one)).toBe(false)
      expect(launches()).toBe(startedSoFar)

      const attached = await host.look(healthy, one, true)
      expect(attached.handover).toBe('attached')
    })

    it('a look at an id nothing recorded is refused in the not-recorded words, and a recorded id resolves', async () => {
      const recorded = await openAgentBorn()

      const refusal = await host.look('sess_nobody_recorded_this', one, true).then(
        () => null,
        (error: Error) => error.message,
      )
      expect(refusal).not.toBeNull()
      expect(refusal).toContain(NOT_RECORDED)
      expect(reaches('sess_nobody_recorded_this', one)).toBe(false)

      const resolved = await host.look(recorded, one, false)
      expect(resolved.sessionId).toBe(recorded)
    })

    describe('section 2 · the wire, and the window over it', () => {
      const overTheWire = (
        sink: RuntimeEventSink,
        input: Record<string, unknown>,
      ): Promise<unknown> => executeRuntimeCommand(host, sink, { kind: 'look', ...input })

      it('the wire treats the claim flag as a press only when it is exactly true', async () => {
        const omitted = await openAgentBorn()
        const denied = await openAgentBorn()
        const pressed = await openAgentBorn()
        const spelledOut = await openAgentBorn()
        const numeric = await openAgentBorn()

        const noFlag = (await overTheWire(one, { sessionId: omitted })) as ResumedSession
        const falseFlag = (await overTheWire(one, {
          sessionId: denied,
          claim: false,
        })) as ResumedSession
        expect(noFlag.handover).toBe('recorded')
        expect(falseFlag.handover).toBe('recorded')
        expect(isUnclaimed(omitted)).toBe(true)
        expect(isUnclaimed(denied)).toBe(true)

        // Anything that is not the boolean is refused at the schema, and takes nothing.
        for (const [sessionId, claim] of [
          [spelledOut, 'true'],
          [numeric, 1],
        ] as const) {
          await expect(overTheWire(one, { sessionId, claim })).rejects.toThrow(
            /invalid runtime command/,
          )
          expect(isUnclaimed(sessionId)).toBe(true)
        }

        // The control: the boolean itself is a press, and takes the conversation.
        const trueFlag = (await overTheWire(one, {
          sessionId: pressed,
          claim: true,
        })) as ResumedSession
        expect(trueFlag.handover).toBe('attached')
        expect(isUnclaimed(pressed)).toBe(false)
        expect(reaches(pressed, one)).toBe(true)
      })

      it('after a release the look again is claim false, and the conversation stays nobody’s', async () => {
        const win = new AWindow(host)
        wins.push(win)
        const windowStore = createSessionStore(win.bridge())
        stops.push(() => windowStore.dispose())
        const sessionId = await openAgentBorn()

        // The press: this window is fed the conversation and owns it.
        expect(await windowStore.look(sessionId)).toBe(sessionId)
        expect(win.looks).toEqual([{ sessionId, claim: true }])
        expect(windowStore.isLive(sessionId)).toBe(true)
        expect(reaches(sessionId, win.sink)).toBe(true)
        expect(isUnclaimed(sessionId)).toBe(false)

        // The release hands it back, and the store looks again: not as a press.
        await windowStore.release(sessionId)
        await waitFor(() => win.looks.length === 2, 'the look again to reach the host')
        expect(win.looks[1]).toEqual({ sessionId, claim: false })
        await waitFor(
          () => windowStore.get(sessionId)?.handover === 0,
          'the look again to be answered',
        )
        await letItSettle()

        // One look again and no more; the conversation is nobody's, not taken back by its own
        // look, and the record stays in the window as a recorded view.
        expect(win.looks).toHaveLength(2)
        expect(isUnclaimed(sessionId)).toBe(true)
        expect(reaches(sessionId, win.sink)).toBe(false)
        expect(windowStore.get(sessionId)?.phase).toBe('recorded')
        expect(windowStore.isLive(sessionId)).toBe(false)
      })

      it('a conversation this window already feeds sends no look at all, and one it does not feed sends one', async () => {
        const win = new AWindow(host)
        wins.push(win)
        const windowStore = createSessionStore(win.bridge())
        stops.push(() => windowStore.dispose())

        const fed = await windowStore.create({ provider: 'claude', cwd: userData })
        if (fed === null) throw new Error('the conversation did not start')
        expect(windowStore.isLive(fed)).toBe(true)
        const before = win.commands.length

        expect(await windowStore.look(fed)).toBe(fed)
        expect(await windowStore.look(fed, 'again')).toBe(fed)
        expect(win.commands.slice(before)).not.toContain('look')
        expect(win.looks).toEqual([])
        expect(windowStore.lookError.value).toBeNull()

        // The control: a conversation this window does not hold is asked about, once.
        const notFed = await openAgentBorn()
        expect(await windowStore.look(notFed)).toBe(notFed)
        expect(win.looks).toEqual([{ sessionId: notFed, claim: true }])
      })
    })
  })

  describe('section 3 · the window, with the host’s answers held', () => {
    const hello = (text: string): TranscriptEvent => ({ type: 'user_turn', text })

    /** The page a look draws a recorded conversation from: ordinals 0, 1 and 2, so it stops at 3. */
    const recordedPage = (sessionId: string): ResumedSession =>
      ({
        hasACommander: false,
        startedWithoutAWindow: false,
        mayHandItBack: false,
        sessionId,
        provider: 'claude',
        cwd: `/work/${sessionId}`,
        providerHome: '/homes/claude',
        profileId: 'default',
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
        ref: {
          provider: 'claude',
          sessionId: `${sessionId}-ref`,
          cwd: `/work/${sessionId}`,
          rotation: 0,
        },
        config: { home: '/homes/claude', homeEnv: 'X', model: 'm', authNote: null, files: [] },
        approvalMode: 'ask',
        pendingApprovalMode: null,
        approvalNote: 'approvals: ask',
        blanketGrants: [],
        planNeedsGoAhead: false,
        settings: {
          model: null,
          pendingModel: null,
          reasoningEffort: null,
          pendingReasoningEffort: null,
          planMode: false,
          pendingPlanMode: null,
        },
        queued: [],
        liveness: { state: 'ended', since: 0 },
        history: {
          entries: [0, 1, 2].map((ordinal) => ({
            ordinal,
            at: 1_000 + ordinal,
            event: hello(`said ${ordinal}`),
          })),
          from: 0,
          hasOlder: false,
          turnAligned: true,
        },
        handover: 'recorded',
        liveFrom: 3,
        cannotTakeAMessage: null,
        settingsFixed: false,
      }) satisfies ResumedSession

    const eventFor = (sessionId: string, ordinal: number): RuntimeEventMessage => ({
      sessionId,
      ordinal,
      at: 2_000 + ordinal,
      event: hello(`arrived as ${ordinal}`),
    })

    /**
     * A bridge that answers nothing until told to. Every look is parsed by `runtimeCommandSchema`
     * after the clone the wire performs, so a payload the wire would refuse is refused here, and
     * what is recorded is what the host's dispatcher would have read.
     */
    function scriptedWindow() {
      let listener: ((message: RuntimeEventMessage) => void) | null = null
      const looks: { sessionId: string; claim: boolean | undefined }[] = []
      const gates: { answer: (handed: ResumedSession) => void; refuse: (why: Error) => void }[] = []
      const bridge = {
        attachOpen: async () => [],
        listResumable: async () => [],
        listUnresumable: async () => [],
        onEvent: (fn: (message: RuntimeEventMessage) => void) => {
          listener = fn
          return () => {
            listener = null
          }
        },
        onLiveness: () => () => {},
        onChanged: () => () => {},
        look: (input: { sessionId: string; claim?: boolean }) =>
          new Promise<ResumedSession>((resolve, reject) => {
            let parsed
            try {
              parsed = runtimeCommandSchema.parse({
                kind: 'look',
                ...asTheWireWouldCarry('api.runtime.look', input),
              })
            } catch (refusal) {
              reject(refusal as Error)
              return
            }
            if (parsed.kind !== 'look') throw new Error('the schema read a look as something else')
            looks.push({ sessionId: parsed.sessionId, claim: parsed.claim })
            gates.push({ answer: resolve, refuse: reject })
          }),
      }
      const store = createSessionStore(bridge as unknown as RuntimeBridge)
      return {
        store,
        looks,
        /** The n-th look's gate, once that look has reached the bridge. */
        async gate(n: number) {
          await waitFor(() => gates.length > n, `look ${n + 1} to reach the bridge`)
          const gate = gates[n]
          if (gate === undefined) throw new Error(`look ${n + 1} has no gate`)
          return gate
        },
        emit(message: RuntimeEventMessage): void {
          if (listener === null) throw new Error('the store never subscribed to events')
          listener(message)
        },
      }
    }

    const stops: (() => void)[] = []
    afterEach(() => {
      for (const stop of stops.splice(0)) stop()
    })
    const aWindow = (): ReturnType<typeof scriptedWindow> => {
      const built = scriptedWindow()
      stops.push(() => built.store.dispose())
      return built
    }

    it('a press whose page a held event reaches past looks again once, and that look asks as no press and never chains', async () => {
      const win = aWindow()
      const pressing = win.store.look('sess_a')
      const first = await win.gate(0)
      expect(win.looks).toEqual([{ sessionId: 'sess_a', claim: true }])

      // An event past the page arrives while the hand-over is in the air: held.
      win.emit(eventFor('sess_a', 10))
      first.answer(recordedPage('sess_a'))
      expect(await pressing).toBe('sess_a')
      expect(win.store.get('sess_a')?.nextOrdinal).toBe(3)

      // The one look again: not a press.
      const second = await win.gate(1)
      expect(win.looks[1]).toEqual({ sessionId: 'sess_a', claim: false })
      // Another event arrives while THAT look is in the air, and it must not earn a third.
      win.emit(eventFor('sess_a', 11))
      second.answer(recordedPage('sess_a'))
      await waitFor(() => win.store.get('sess_a')?.handover === 0, 'the look again to settle')
      await letItSettle()
      expect(win.looks).toEqual([
        { sessionId: 'sess_a', claim: true },
        { sessionId: 'sess_a', claim: false },
      ])
      expect(win.store.get('sess_a')?.earlyEvents).toEqual([])

      // The control: an event the page already carries earns no look again at all.
      const covered = win.store.look('sess_b')
      const gateB = await win.gate(2)
      win.emit(eventFor('sess_b', 2))
      gateB.answer(recordedPage('sess_b'))
      expect(await covered).toBe('sess_b')
      await letItSettle()
      expect(win.looks).toHaveLength(3)
    })

    it('a refused look drops what it held, says why, does not ask again, and the next look clears the sentence', async () => {
      const win = aWindow()

      // A recorded record to press on: the first press is answered.
      const first = win.store.look('sess_a')
      ;(await win.gate(0)).answer(recordedPage('sess_a'))
      expect(await first).toBe('sess_a')
      expect(win.store.get('sess_a')?.phase).toBe('recorded')
      expect(win.store.lookError.value).toBeNull()

      // The second press is refused, with an event past the page held meanwhile.
      const refused = win.store.look('sess_a')
      const gate = await win.gate(1)
      win.emit(eventFor('sess_a', 50))
      expect(win.store.get('sess_a')?.earlyEvents).toHaveLength(1)
      gate.refuse(new Error('the host refused this look'))
      expect(await refused).toBeNull()

      expect(win.store.lookError.value).toContain('the host refused this look')
      // Dropped, and nothing asked again: the ledger keeps the event and the next look reads it.
      expect(win.store.get('sess_a')?.earlyEvents).toEqual([])
      await letItSettle()
      expect(win.looks).toEqual([
        { sessionId: 'sess_a', claim: true },
        { sessionId: 'sess_a', claim: true },
      ])

      // The next look clears the sentence, whether or not it is answered yet.
      const third = win.store.look('sess_a')
      expect(win.store.lookError.value).toBeNull()
      ;(await win.gate(2)).answer(recordedPage('sess_a'))
      expect(await third).toBe('sess_a')
      expect(win.store.lookError.value).toBeNull()
      expect(win.looks.filter((asked) => asked.claim === false)).toEqual([])
    })
  })
})
