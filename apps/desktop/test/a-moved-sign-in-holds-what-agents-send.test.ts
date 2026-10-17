import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type FakeSessionHandle,
  type SessionHandle,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { ACommandTakesNoAttachments } from '../src/main/runtime/a-command-goes-as-typed'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { PROVIDER_NAME } from '../src/shared/runtime-ipc'

/**
 * # ⚑ A moved Claude sign-in holds what agents send, and says why it waits
 *
 * Landing coverage for "hold, then reopen by itself". Words from an agent are HELD, never refused,
 * for a Claude conversation whose sign-in the Mac has moved on from; this app reopens it on the
 * current sign-in as soon as that would lose nothing. **What it waits for is the thing to pin**: a
 * running turn, a card a person answers, work in the background, planning — each a state in which a
 * reopen would cost something — and the sender's receipt says which, in words that promise only what
 * the app will do. ⛔ An idle conversation is reopened at once, and nothing held is ever ended.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }

  types(): string[] {
    return this.events().map((event) => event.type)
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stand-in for the adapter's own credential watch, with the same two properties that matter: it
 * LATCHES, and looking costs something (so the count tells us where the host looks).
 *
 * ⚠️ **`check` is asynchronous, like the thing it stands in for** (149). The real one shells out to
 * `security`, and 148 H4 is that it used to do so on the calling thread; a synchronous double could
 * not catch a host that awaited it in the wrong place — or failed to await it at all.
 */
class Watch {
  moved = false
  latched = false
  looks = 0
  /** Set to have the credential move DURING an interrupt — the 148 M1 window, on demand. */
  movesOnInterrupt = false
  /** Set to have every life after the move hold a moved sign-in too, as one renewed again would. */
  movesAgainAtEachStart = false

  async check(): Promise<boolean> {
    this.looks++
    if (this.moved) this.latched = true
    return this.latched
  }
}

/** One life's view of the watch: a life started after the move holds the current sign-in. */
class LifeWatch {
  private readonly startedAfterTheMove: boolean
  constructor(private readonly watch: Watch) {
    this.startedAfterTheMove = watch.moved && !watch.movesAgainAtEachStart
  }
  get latched(): boolean {
    return !this.startedAfterTheMove && this.watch.latched
  }
  async check(): Promise<boolean> {
    if (this.startedAfterTheMove) return false
    return this.watch.check()
  }
}

/** `FakeRuntime`, with every handle it hands out wired to `watch`, whichever provider it plays. */
class WatchedRuntime extends FakeRuntime {
  constructor(
    provider: Parameters<typeof FakeRuntime.prototype.start> extends never
      ? never
      : ConstructorParameters<typeof FakeRuntime>[0],
    private readonly watch: Watch,
    /** ⚑ What the provider issued, shared by every runtime of a test, so a reopen can resume. */
    sessions: FakeProviderSessions,
    private readonly handles: FakeSessionHandle[],
  ) {
    super(provider, { sessions })
  }

  private wire<T extends SessionHandle>(handle: T): T {
    const life = new LifeWatch(this.watch)
    Object.defineProperty(handle, 'signInSuperseded', {
      get: () => life.latched,
      configurable: true,
    })
    Object.defineProperty(handle, 'checkSignIn', {
      value: async () => life.check(),
      configurable: true,
    })
    // The 148 M1 fixture: `sendInterrupting` checks, then awaits an interrupt — for at most the
    // host's interrupt wait since 709 — and up to five seconds of `waitForIdle` before it sends. This is what puts a credential move inside that window.
    const interrupt = handle.interrupt.bind(handle)
    Object.defineProperty(handle, 'interrupt', {
      value: async () => {
        if (this.watch.movesOnInterrupt) this.watch.moved = true
        return interrupt()
      },
      configurable: true,
    })
    return handle
  }

  override async start(
    ...args: Parameters<FakeRuntime['start']>
  ): ReturnType<FakeRuntime['start']> {
    const handle = this.wire(await super.start(...args))
    this.handles.push(handle)
    return handle
  }

  override async resume(
    ...args: Parameters<FakeRuntime['resume']>
  ): ReturnType<FakeRuntime['resume']> {
    const handle = this.wire(await super.resume(...args))
    this.handles.push(handle)
    return handle
  }
}

/**
 * ⚑ The same rules on both providers: Claude's sign-in moves when the machine's login changes, and
 * Codex's when its profile is signed in to another account. One path, provider-named words.
 */
describe.each(['claude', 'codex'] as const)(
  '%s · a moved sign-in: what agents send is held, and the sender is told what it waits for',
  (provider) => {
    const THE_SIGN_IN_CHANGED = `Its ${PROVIDER_NAME[provider]} sign-in changed after it started.`
    let userData: string
    let db: AppDatabase
    let host: RuntimeHost
    let window: RecordingSink
    let watch: Watch
    let handles: FakeSessionHandle[]

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-signin-held-'))
      watch = new Watch()
      handles = []
      const sessions = new FakeProviderSessions()
      let counter = 0
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      host = new RuntimeHost({
        store: createSessionStore(db),
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider) => new WatchedRuntime(provider, watch, sessions, handles),
        prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
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
      window = new RecordingSink()
    })

    afterEach(async () => {
      const began = performance.now()
      const closing = host.closeAll()
      const report = setTimeout(() => {
        const live = host as unknown as {
          launches: { size: number }
          startsInFlight: Map<string, unknown>
          slots: Map<
            string,
            {
              phase: string
              session: null | {
                handle: SessionHandle
                closing: Promise<unknown> | null
                finalizing: Promise<unknown> | null
              }
            }
          >
        }
        console.warn('sign-in fixture teardown is still pending', {
          provider,
          elapsedMs: performance.now() - began,
          launches: live.launches.size,
          starts: live.startsInFlight.size,
          slots: [...live.slots.values()].map((slot) => ({
            phase: slot.phase,
            status: slot.session?.handle.status(),
            closing: slot.session?.closing != null,
            finalizing: slot.session?.finalizing != null,
          })),
        })
      }, 1_000)
      try {
        await closing
      } finally {
        clearTimeout(report)
      }
      expect([...host.workInFlight()]).toEqual([])
      expect(host.providerProcessesInFlight()).toBe(false)
      expect(handles.every((handle) => handle.status() === 'ended')).toBe(true)
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    const open = async (
      over: { planMode?: boolean; approvalMode?: 'ask' | 'auto' } = {},
    ): Promise<{ id: string; handle: FakeSessionHandle }> => {
      const created = await host.createSession({ provider, ...over }, window)
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      return { id: created.sessionId, handle }
    }

    const ledger = (id: string): TranscriptEvent[] =>
      window.messages.filter((m) => m.sessionId === id).map((m) => m.event)

    /** ⚑ What the receipt SAYS, from an agent that is not the receiver. */
    async function send(from: string, to: string, text: string) {
      const tool = agentToolsFor(host, from).tools.find((one) => one.name === 'message_agent')!
      return await tool.call({ agent: to, text, kind: 'note' })
    }

    const reopenedFor = (id: string): TranscriptEvent[] =>
      ledger(id).filter((event) => event.type === 'reopened')

    const quiet = async (ms = 150): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    it('🔴 an idle conversation is reopened at once, on the current sign-in, and the words are not ended', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open({ approvalMode: 'auto' })
      watch.moved = true

      const said = await send(sender.id, receiver.id, 'a note that must not be lost')
      expect(said.structured).toMatchObject({ outcome: 'ok' })
      await waitFor(() => reopenedFor(receiver.id).length > 0, 'the app to reopen it')
      expect(reopenedFor(receiver.id)).toEqual([
        { type: 'reopened', because: 'the-sign-in-moved-on' },
      ])
      expect(
        ledger(receiver.id).filter((event) => event.type === 'message_unqueued'),
      ).not.toContainEqual(expect.objectContaining({ reason: 'abandoned' }))
      // The sender is told the app is reopening it, not that it is waiting for something.
      expect(said.text).toContain(THE_SIGN_IN_CHANGED)
      expect(said.text).toContain('reopening it on the current one')
    })

    it('⚑ …and the control: with the sign-in unchanged the same note goes the ordinary way, and nothing reopens', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open({ approvalMode: 'auto' })
      const said = await send(sender.id, receiver.id, 'an ordinary note')
      expect(said.structured).toMatchObject({ outcome: 'ok' })
      expect(said.text).not.toContain(THE_SIGN_IN_CHANGED)
      await quiet()
      expect(reopenedFor(receiver.id)).toEqual([])
    })

    it('🔴 a turn in progress is not cut: the words are held, the receipt says the reopen comes when the turn ends', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open({ approvalMode: 'auto' })
      await host.send(receiver.id, 'work on something long', window)
      receiver.handle.simulateThinking({ text: 'long work', redacted: false })
      await waitFor(() => receiver.handle.status() === 'working', 'the receiver to be working')
      watch.moved = true

      const said = await send(sender.id, receiver.id, 'a note for after the turn')
      expect(said.text).toContain(THE_SIGN_IN_CHANGED)
      expect(said.text).toContain('once its turn ends')
      // ⚑ Private since dev's 34a00442; read as the agent tools read it.
      expect(
        (
          host as unknown as { whyItWaitsForItsSignIn(id: string): string | null }
        ).whyItWaitsForItsSignIn(receiver.id),
      ).toContain('once its turn ends')
      await quiet()
      expect(reopenedFor(receiver.id), 'a running turn was cut for a reopen').toEqual([])
      expect(ledger(receiver.id).some((event) => event.type === 'message_queued')).toBe(true)
    })

    it('🔴 a card waiting on a person holds the reopen until it is answered', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open()
      await host.send(receiver.id, 'the first thing', window)
      await waitFor(
        () => ledger(receiver.id).some((event) => event.type === 'permission_request'),
        'the card the turn parks on',
      )
      watch.moved = true
      const said = await send(sender.id, receiver.id, 'a note behind the card')
      expect(said.text).toContain(THE_SIGN_IN_CHANGED)
      expect(said.text).toContain('once the question or permission it is waiting on is answered')
      await quiet()
      expect(reopenedFor(receiver.id)).toEqual([])
    })

    it('⛔ work in the background holds the reopen, because a reopen would stop it — and its end releases it', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open({ approvalMode: 'auto' })
      receiver.handle.simulateBackgroundWork()
      await quiet(50)
      watch.moved = true

      const said = await send(sender.id, receiver.id, 'a note for when the background work is done')
      expect(said.text).toContain(THE_SIGN_IN_CHANGED)
      expect(said.text).toContain('once the work it runs in the background has finished')
      await quiet()
      expect(reopenedFor(receiver.id), 'a reopen stopped the background work').toEqual([])

      receiver.handle.simulateBackgroundWork({ running: [] })
      await waitFor(() => reopenedFor(receiver.id).length > 0, 'the reopen once the work has ended')
    })

    it('⛔ planning holds the reopen, because a reopen would end the plan', async () => {
      const sender = await open({ approvalMode: 'auto' })
      const receiver = await open({ planMode: true, approvalMode: 'auto' })
      watch.moved = true
      const said = await send(sender.id, receiver.id, 'a note for a planner')
      expect(said.text).toContain(THE_SIGN_IN_CHANGED)
      expect(said.text).toContain('once a person ends its planning')
      await quiet()
      expect(reopenedFor(receiver.id)).toEqual([])
    })

    /**
     * ⚑ A person's own message after a change of sign-in is the one press its reopen asks for: it
     * goes in on the current sign-in, at once where nothing would be lost, and with the reopen where
     * something would. ⚑ From a window, so the words are a person's own.
     */
    describe('a person’s own message is the one press', () => {
      let person: RecordingSink
      beforeEach(() => {
        person = new RecordingSink('webContents:9')
      })
      const opened = async (
        over: { planMode?: boolean; approvalMode?: 'ask' | 'auto' } = {},
      ): Promise<{ id: string; handle: FakeSessionHandle }> => {
        const created = await host.createSession({ provider, ...over }, person)
        return { id: created.sessionId, handle: handles.at(-1)! }
      }
      const rows = (id: string): TranscriptEvent[] =>
        person.messages.filter((m) => m.sessionId === id).map((m) => m.event)
      const reopens = (id: string): TranscriptEvent[] =>
        rows(id).filter((event) => event.type === 'reopened')
      const turnsOf = (id: string): string[] =>
        rows(id).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
      const sentOnce = (id: string, text: string): boolean =>
        turnsOf(id).filter((said) => said.includes(text)).length === 1
      /** It went in after the reopen, never on the life before it. */
      const afterTheReopen = (id: string, text: string): boolean => {
        const all = rows(id)
        const reopened = all.findIndex((event) => event.type === 'reopened')
        const turn = all.findIndex(
          (event) => event.type === 'user_turn' && event.text.includes(text),
        )
        return reopened >= 0 && turn > reopened
      }

      it('🔴 idle: it reopens at once on the current sign-in, and the message goes in there, once', async () => {
        const { id } = await opened({ approvalMode: 'auto' })
        watch.moved = true

        await host.send(id, 'carry on', person)

        await waitFor(() => sentOnce(id, 'carry on'), 'the message to go in')
        expect(reopens(id)).toEqual([{ type: 'reopened', because: 'the-sign-in-moved-on' }])
        expect(afterTheReopen(id, 'carry on')).toBe(true)
        expect(rows(id).filter((event) => event.type === 'message_unqueued')).toMatchObject([
          { reason: 'sent', text: 'carry on' },
        ])
      })

      it('⚑ …and the control: with the sign-in unchanged it goes the ordinary way, and nothing reopens', async () => {
        const { id } = await opened({ approvalMode: 'auto' })
        await host.send(id, 'carry on', person)
        await quiet()
        expect(sentOnce(id, 'carry on')).toBe(true)
        expect(reopens(id)).toEqual([])
      })

      it('⛔ a card waiting on a person holds it; answered, it reopens and the message goes in', async () => {
        const { id } = await opened()
        await host.send(id, 'the first thing', person)
        await waitFor(
          () => rows(id).some((event) => event.type === 'permission_request'),
          'the card the turn parks on',
        )
        watch.moved = true
        expect((await host.queueMessage(id, 'and then this', person)).outcome).toBe('queued')
        await quiet()
        expect(reopens(id), 'a card was settled by a reopen').toEqual([])

        const card = rows(id).find((event) => event.type === 'permission_request')
        await host.respondPermission(id, (card as { id: string }).id, { outcome: 'deny' }, person)
        await waitFor(() => sentOnce(id, 'and then this'), 'the message to go in')
        expect(afterTheReopen(id, 'and then this')).toBe(true)
      })

      it('⛔ work in the background holds it, because a reopen would stop it; its end releases it', async () => {
        const { id, handle } = await opened({ approvalMode: 'auto' })
        handle.simulateBackgroundWork()
        await quiet(50)
        watch.moved = true

        await host.send(id, 'when that is done', person)
        await quiet()
        expect(reopens(id), 'a reopen stopped the background work').toEqual([])
        expect(turnsOf(id)).toEqual([])

        handle.simulateBackgroundWork({ running: [] })
        await waitFor(() => sentOnce(id, 'when that is done'), 'the message to go in')
        expect(afterTheReopen(id, 'when that is done')).toBe(true)
      })

      it('⛔ planning holds it, because a reopen would end the plan; leaving planning releases it', async () => {
        const { id } = await opened({ planMode: true, approvalMode: 'auto' })
        watch.moved = true

        await host.send(id, 'a thought for the plan', person)
        await quiet()
        expect(reopens(id), 'a reopen ended the plan').toEqual([])

        await host.endPlanMode(id, person)
        await waitFor(() => sentOnce(id, 'a thought for the plan'), 'the message to go in')
        expect(afterTheReopen(id, 'a thought for the plan')).toBe(true)
      })

      it('⛔ a held message the person cancels leaves nothing to reopen for', async () => {
        const { id, handle } = await opened({ approvalMode: 'auto' })
        handle.simulateBackgroundWork()
        await quiet(50)
        watch.moved = true
        const queued = await host.queueMessage(id, 'never mind', person)
        expect(queued.outcome).toBe('queued')
        if (queued.outcome !== 'queued') throw new Error('it was not held')
        await host.cancelQueuedMessage(id, queued.messageId, person)
        const lives = handles.length

        handle.simulateBackgroundWork({ running: [] })
        await quiet()
        expect(reopens(id)).toEqual([])
        expect(turnsOf(id)).toEqual([])
        // ⚑ …and it still runs, in the person's window: nothing stopped it to reopen for nothing.
        expect(handles.length, 'no life started').toBe(lives)
        expect(host.resumableSessions().find((row) => row.sessionId === id)?.running).toBe(
          'in-a-window',
        )
      })

      it('⛔ a reopened life that holds a moved sign-in too is not reopened again, and the message is kept', async () => {
        const { id } = await opened({ approvalMode: 'auto' })
        watch.moved = true
        watch.movesAgainAtEachStart = true

        await host.send(id, 'carry on', person)
        await waitFor(() => reopens(id).length > 0, 'the reopen')
        await quiet(300)

        expect(reopens(id), 'reopened once').toHaveLength(1)
        expect(turnsOf(id), 'never sent on a moved sign-in').toEqual([])
        expect(
          rows(id).filter((event) => event.type === 'message_unqueued'),
          'and never ended',
        ).toEqual([])
      })

      it('⚑ what was held before the person wrote goes first, and each once', async () => {
        const sender = await open({ approvalMode: 'auto' })
        const { id, handle } = await opened({ approvalMode: 'auto' })
        handle.simulateBackgroundWork()
        await quiet(50)
        watch.moved = true
        expect((await send(sender.id, id, 'an earlier note')).structured).toMatchObject({
          outcome: 'ok',
        })
        await host.send(id, 'my own words', person)

        handle.simulateBackgroundWork({ running: [] })
        await waitFor(
          () => rows(id).filter((event) => event.type === 'message_unqueued').length === 2,
          'both to go in',
        )
        expect(
          rows(id)
            .filter((event) => event.type === 'message_unqueued')
            .map((event) => (event as { text: string; reason: string }).reason),
        ).toEqual(['sent', 'sent'])
        const went = rows(id)
          .filter((event) => event.type === 'message_unqueued')
          .map((event) => (event as { text: string }).text)
        expect(went).toEqual(['an earlier note', 'my own words'])
      })

      it('⛔ Stop and send of a command that cannot carry its files is refused before the stop, though the sign-in moved', async () => {
        const { id, handle } = await opened()
        handle.compactsOnRequest()
        await host.send(id, 'the first thing', person)
        await waitFor(
          () => rows(id).some((event) => event.type === 'permission_request'),
          'the card the turn parks on',
        )
        watch.moved = true
        const notes = join(userData, 'notes.md')
        writeFileSync(notes, 'the notes\n')
        const endings = rows(id).filter((event) => event.type === 'turn').length

        await expect(
          host.sendInterrupting(id, '/compact', person, [
            { path: notes, kind: 'file', outsideCwd: true },
          ]),
        ).rejects.toBeInstanceOf(ACommandTakesNoAttachments)

        // Nothing was stopped and nothing was held.
        expect(rows(id).filter((event) => event.type === 'user_command')).toEqual([])
        expect(rows(id).filter((event) => event.type === 'turn')).toHaveLength(endings)
        expect(rows(id).some((event) => event.type === 'message_queued')).toBe(false)
      })

      it('⛔ a quit while it is held starts nothing', async () => {
        const { id, handle } = await opened({ approvalMode: 'auto' })
        handle.simulateBackgroundWork()
        await quiet(50)
        watch.moved = true
        await host.send(id, 'when that is done', person)
        const lives = handles.length

        await host.closeAll()
        await quiet()
        expect(handles.length, 'no reopen after the quit').toBe(lives)
        expect(reopens(id)).toEqual([])
      })

      it('⛔ a conversation the person closed while its message was held starts once, for what it held, and is not reopened again', async () => {
        const { id, handle } = await opened({ approvalMode: 'auto' })
        handle.simulateBackgroundWork()
        await quiet(50)
        watch.moved = true
        await host.send(id, 'when that is done', person)
        const lives = handles.length

        // ⚑ A stop delivers what was held: it starts again, on the current sign-in, and the message
        // goes there.
        await host.close(id, person)
        await waitFor(() => sentOnce(id, 'when that is done'), 'the message to go in')
        await quiet()
        expect(handles.length - lives, 'one start, and no reopen of this app’s on top').toBe(1)
        expect(
          reopens(id).filter(
            (event) => (event as { because?: string }).because === 'the-sign-in-moved-on',
          ),
        ).toEqual([])
      })
    })

    // ⚑ Codex's refusal arrives on the turn's own ending; Claude's as a fatal error first, a path
    // `a-conversation-reopens-on-a-renewed-sign-in.test.ts` pins.
    it.skipIf(provider === 'claude')(
      '🔴 a turn its provider refused on a login that has moved: it ends, and reopens on the current one by itself',
      async () => {
        const conversation = await open({ approvalMode: 'auto' })
        watch.moved = true
        await conversation.handle.runTurnRefusedOnItsLogin()
        await waitFor(() => reopenedFor(conversation.id).length > 0, 'the app to reopen it')
        await quiet(300)
        expect(reopenedFor(conversation.id)).toEqual([
          { type: 'reopened', because: 'the-sign-in-was-renewed' },
        ])
        expect(handles.length, 'a second life on the current sign-in').toBe(2)
      },
    )

    it.skipIf(provider === 'claude')(
      '⚑ …and the control: a refusal on a login that has not moved stands, and nothing reopens',
      async () => {
        const conversation = await open({ approvalMode: 'auto' })
        await conversation.handle.runTurnRefusedOnItsLogin()
        await quiet()
        expect(reopenedFor(conversation.id)).toEqual([])
      },
    )
  },
)
