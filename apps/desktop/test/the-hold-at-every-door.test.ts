import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  ClaudeRuntime,
  FakeProviderSessions,
  FakeRuntime,
  FakeSessionHandle,
  TURN_REFUSED,
  type AgentRuntime,
  type AgentToolset,
  type SessionHandle,
  type StartOptions,
  type TurnProvenance,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  NULL_SESSION_STORE,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { Caller, RuntimeEventSink } from './helpers/giver-notice-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { HandedPath, RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # 🔴 670 · the hold, at every door
 *
 * ⛔ **`657` made a lost race HOLD at `queueMessage`, so every agent and app door held — and the
 * PERSON's own doors did not.** A person who read a conversation idle and lost the handover to an
 * agent's turn was shown the adapter's raw sentence (`657` F-b). ⚑ This file drives each door into
 * that race and follows the words until they reach the provider, or end.
 *
 * ## ⚑ What each section holds to
 *
 *  - §1 · the composer's send, racing an agent's `message_agent` to one idle conversation: held,
 *    and stamped `human` at the SDK when it flushes — through the REAL Claude adapter.
 *  - §2 · the interrupt-and-send: an arrival in the gap waits behind the replacement (the latch),
 *    and the residual race — a door that asks no latch — is held, or refused by the queue's rule.
 *    ⚑ D-027 · with something already waiting, the replacement joins it, and an arrival in the gap
 *    goes in that same turn, in ledger order.
 *  - §3 · `657` F-c, corrected: a turn a person STOPPED is not a lost race, and its words are never
 *    sent afterwards. The brief's fix — type that stop so the hold takes it — is `670 M9`.
 *  - §4 · `657` F-d: a hold behind a head that ended without a turn goes at once.
 *    ⚑ D-027 · a flush now takes everything up to a person's command, so the follower goes in the
 *    head's own take.
 *  - §5 · `657` F-e: no identity read runs after the interrupt-and-send's handover.
 *  - §6 · the plan go-ahead: a lost race is held as BroBot's words; a real failure says so.
 *
 * ## ⛔ Every hold ends exactly once
 *
 * ⚑ {@link everyHoldEndedOnce} is asked at the end of every section that holds something: each
 * `message_queued` in the conversation has ONE `message_unqueued`, which is the pairing
 * `UnqueuedMessageEvent` states in its own first line.
 *
 * ⛔ ***"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."*** The Claude rows record the `SDKUserMessage` the adapter pushes, which
 * the SDK writes to the CLI with `JSON.stringify` and nothing else.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A latch a test opens by hand. */
const latch = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
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
}

/**
 * ⚑ **A `query()` that hears every pushed turn and answers it** — `662`'s double, with two knobs
 * more.
 *
 * - `holding` parks the answer, so a turn stays OPEN and the next sender loses to it.
 * - ⚑ **Each answer is some CONTENT, then the `result`**, the order a CLI answers in. ⚠️ It matters
 *   after a Stop: the adapter ends the turn itself and then expects the provider's own terminal
 *   for it, and only the next turn's first content retires that debt (`SessionMachine`'s
 *   `absorbsForeignTerminal`). A bare `result` would be absorbed and the turn would never end.
 * - ⚑ **`interrupt()` answers a parked turn with its `result` alone** — the terminal the adapter
 *   is owed for a turn it has already ended.
 * - `settingsHeld` parks `setModel`, so `send` suspends between opening its turn and pushing.
 */
/** ⚑ F080: as the CLI does, a `result` names the message it answers (`probe:claude-provider-burst`). */
const answering = (message: SDKUserMessage) => ({
  user_message_uuid: message.uuid,
  user_message_uuids: message.uuid === undefined ? [] : [message.uuid],
})

class AnsweringQuery {
  readonly heard: SDKUserMessage[] = []
  readonly calls: string[] = []
  holding = false
  settingsHeld: Promise<void> | null = null
  private parked: (() => void) | null = null
  private interruptedWhileParked = false
  private readonly out: SDKMessage[] = []
  private wake: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private done = false

  constructor(prompt: AsyncIterable<SDKUserMessage>, providerId: string, cwd: string) {
    void (async () => {
      let first = true
      for await (const message of prompt) {
        this.heard.push(message)
        if (first) {
          first = false
          this.emit({ type: 'system', subtype: 'init', session_id: providerId, cwd } as never)
        }
        if (this.holding) await new Promise<void>((resolve) => (this.parked = resolve))
        if (this.interruptedWhileParked) {
          this.interruptedWhileParked = false
          this.emit({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            ...answering(message),
          } as never)
          continue
        }
        this.emit({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        } as never)
        this.emit({
          type: 'result',
          subtype: 'success',
          is_error: false,
          ...answering(message),
        } as never)
      }
    })()
  }

  release(): void {
    this.holding = false
    const parked = this.parked
    this.parked = null
    parked?.()
  }

  async setModel(model?: string): Promise<void> {
    this.calls.push(`setModel:${String(model)}`)
    if (this.settingsHeld !== null) await this.settingsHeld
  }

  private emit(message: SDKMessage): void {
    if (this.wake) {
      const wake = this.wake
      this.wake = null
      wake({ value: message, done: false })
      return
    }
    this.out.push(message)
  }

  async interrupt(): Promise<void> {
    if (this.parked === null) return
    this.interruptedWhileParked = true
    const parked = this.parked
    this.parked = null
    parked()
  }
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.done = true
    const wake = this.wake
    this.wake = null
    wake?.({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.out.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => (this.wake = resolve))
      },
    }
  }
}

/** ⚑ Every `message_queued` has exactly one `message_unqueued` — the pairing, asked of the ledger. */
function everyHoldEndedOnce(events: readonly TranscriptEvent[]): Map<string, string[]> {
  const endings = new Map<string, string[]>()
  for (const event of events) {
    if (event.type === 'message_queued' && event.messageId !== undefined) {
      endings.set(event.messageId, endings.get(event.messageId) ?? [])
    }
  }
  for (const event of events) {
    if (event.type !== 'message_unqueued') continue
    if (event.messageId === undefined) throw new Error('an ending that names no message')
    const seen = endings.get(event.messageId)
    if (seen === undefined)
      throw new Error(`an ending for a message never held: ${event.messageId}`)
    seen.push(event.reason)
  }
  for (const [id, reasons] of endings) {
    expect(reasons, `message ${id} must end exactly once`).toHaveLength(1)
  }
  return endings
}

describe('670 · the hold at every door — the real Claude adapter', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: RecordingSink
  let queries: Map<string, AnsweringQuery[]>
  /** ⛔ Every text a handle was ASKED to send, recorded before the call — so a refused one shows. */
  let attempts: { text: string; origin: TurnProvenance | undefined }[]
  /** ⚑ Parks the sign-in check of the `skip + 1`th turn gate asked from now, once. */
  let signIn: { skip: number; gate: { promise: Promise<void>; open: () => void } } | null
  /** ⚑ Every gate a test made, so a failing test cannot leave a send parked past its teardown. */
  let parkedSignIns: (() => void)[]
  /** ⚑ Opened when a parked sign-in check is reached. */
  let signInReached: { promise: Promise<void>; open: () => void }
  /** ⚑ When set, every handle reports its machine sign-in as moved on — `648`'s latch. */
  let superseded: boolean
  /** ⚑ When set, every sign-in check fails outright — a read that did not answer, not a refusal. */
  let signInFails: boolean
  /** ⚑ How many sign-in checks the turn gates have asked. */
  let signInChecks: number
  /** ⚑ Set the moment any handover is attempted — §5's trap arms on it. */
  let handedOver: boolean
  const tick = (): number => clock++

  const homeOf = (profileId: string): string =>
    join(userData, 'provider-homes', profileId, 'claude')

  /**
   * ⚑ **The real handle, seen through a proxy that changes three things and forwards the rest.**
   * ⛔ `send` is forwarded NOT `async`: an async wrapper resolves later than the adapter's own
   * promise, which is the reordering `662`'s gate caught.
   */
  const watched = (handle: SessionHandle): SessionHandle =>
    new Proxy(handle, {
      get(target, prop) {
        if (prop === 'send') {
          return (text: string, origin?: TurnProvenance) => {
            attempts.push({ text, origin })
            handedOver = true
            return target.send(text, origin)
          }
        }
        if (prop === 'checkSignIn') {
          return async (): Promise<boolean> => {
            if (signIn !== null) {
              if (signIn.skip > 0) signIn.skip -= 1
              else {
                const { gate } = signIn
                signIn = null
                parkedSignIns.push(gate.open)
                signInReached.open()
                await gate.promise
              }
            }
            signInChecks += 1
            // ⚠️ **Capped, so a spin is a COUNT and not a hang.** A repeat with no bound asks here in
            // a loop of microtasks that never yields, so no timer — and no test timeout — would ever
            // fire. After a hundred asks the double answers, and the test reads the count.
            if (signInFails && signInChecks > 100) signInFails = false
            if (signInFails) throw new Error('the keychain did not answer')
            return superseded
          }
        }
        if (prop === 'signInSuperseded') return superseded
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value
      },
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-670-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-670-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    queries = new Map()
    attempts = []
    signIn = null
    parkedSignIns = []
    signInReached = latch()
    superseded = false
    signInFails = false
    signInChecks = 0
    handedOver = false
    let launched = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (): AgentRuntime => {
        const inner = new ClaudeRuntime(
          (params) => {
            const home = String(params.options.env?.CLAUDE_CONFIG_DIR ?? '')
            const query = new AnsweringQuery(
              params.prompt,
              `prov_${String(++launched)}`,
              params.options.cwd ?? root,
            )
            queries.set(home, [...(queries.get(home) ?? []), query])
            return query as never
          },
          async () => true,
        )
        return new Proxy(inner, {
          get(target, prop) {
            if (prop === 'start') {
              return async (opts: StartOptions) => watched(await target.start(opts))
            }
            if (prop === 'resume') {
              return async (...args: Parameters<AgentRuntime['resume']>) =>
                watched(await target.resume(...args))
            }
            const value = Reflect.get(target, prop) as unknown
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(target)
              : value
          },
        }) as AgentRuntime
      },
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const open of parkedSignIns) open()
    for (const built of queries.values()) for (const query of built) query.release()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const queryOf = (profileId: string): AnsweringQuery => {
    const built = queries.get(homeOf(profileId))?.at(-1)
    if (built === undefined) throw new Error(`no query was built for ${profileId}`)
    return built
  }
  const heardTexts = (profileId: string): string[] =>
    queryOf(profileId).heard.map((one) => JSON.stringify(one.message.content))
  const heardCarrying = (profileId: string, words: string): SDKUserMessage | undefined =>
    queryOf(profileId).heard.find((one) => JSON.stringify(one.message.content).includes(words))

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const idle = (sessionId: string): boolean =>
    ledger(sessionId)
      .filter((event) => event.type === 'status')
      .at(-1)?.state === 'idle'
  const held = (sessionId: string, words: string): TranscriptEvent[] =>
    ledger(sessionId).filter(
      (event) => event.type === 'message_queued' && event.text.includes(words),
    )
  const turnsCarrying = (sessionId: string, words: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'user_turn' && event.text.includes(words))

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * A PM a person opened, and one worker it gave a piece to, whose first turn has finished.
   *
   * ⚑ **D-016 · the give starts the worker, and its brief is that first turn** — where a spawn
   * started it with nothing sent. ⚠️ The brief's turn ends with the piece still open, so its giver is
   * told it stalled, and the PM takes that notice as a turn of its own: both turns are waited out
   * here, so every sign-in check a test parks from now on is the one it means to park.
   */
  const aPmAndItsIdleWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
  }> => {
    const warmUp = await personOpens('worker-a')
    await host.close(warmUp, window)
    const pm = await personOpens('pm')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker-a',
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => queryOf('worker-a').heard.length === 1 && idle(worker),
      'the brief’s turn to end',
    )
    await waitFor(() => giverStallReceipts(store, pm).length > 0, 'the giver to be told')
    await waitFor(() => queryOf('pm').heard.length === 1 && idle(pm), 'the notice’s turn to end')
    return { pm, worker, pmTools }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the composer's send
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the composer’s send loses to an agent, and is held — still the person’s', () => {
    it('🔴 both reach the provider, the person’s is HELD, and it flushes stamped `human`', async () => {
      const { worker, pmTools } = await aPmAndItsIdleWorker()
      // ⚑ The person takes the worker over; its parent still commands it, so both may write to it.
      host.claimSession(worker, window)
      queryOf('worker-a').holding = true
      const gate = latch()
      signIn = { skip: 0, gate }
      // ⛔ **The premise: both start against an IDLE conversation.** Nothing has been pushed to it
      // but the brief (D-016), whose turn has ended.
      expect(queryOf('worker-a').heard).toHaveLength(1)
      expect(idle(worker)).toBe(true)
      const persons = host.send(worker, 'ultracode: the person’s own words', window)
      let answered: 'resolved' | 'rejected' | null = null
      persons.then(
        () => (answered = 'resolved'),
        () => (answered = 'rejected'),
      )
      await signInReached.promise
      // ⚑ The person's send is parked inside its sign-in check; the agent's goes through.
      // ⚑ D-016 · a `note`: the work was the give's, and this is an agent's words, racing.
      const agents = await callOn(pmTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'the agent’s words',
      })
      expect(agents).toMatchObject({ outcome: 'ok', delivery: 'sent' })
      await waitFor(() => heardCarrying('worker-a', 'the agent’s words') !== undefined, 'the agent')
      gate.open()
      // 🔴 **Resolved, never rejected** — the person is shown a queued message, not an error.
      await persons
      expect(answered).toBe('resolved')
      expect(held(worker, 'the person’s own words')).toHaveLength(1)
      expect(turnsCarrying(worker, 'the person’s own words')).toHaveLength(0)
      // ⛔ **The race really happened**: the person's words were HANDED to the adapter once, and
      // refused, while the agent's turn held the conversation.
      expect(attempts.filter((one) => one.text.includes('the person’s own words'))).toHaveLength(1)

      queryOf('worker-a').release()
      await waitFor(
        () => heardCarrying('worker-a', 'the person’s own words') !== undefined,
        'the held words to flush',
      )
      // 🔴 **Still the person's when they go**: stamped `human`, at the SDK.
      expect(heardCarrying('worker-a', 'the person’s own words')?.origin).toStrictEqual({
        kind: 'human',
      })
      // ⚑ And the agent's words, one conversation over in time, were never the person's.
      expect(heardCarrying('worker-a', 'the agent’s words')?.origin?.kind).toBe('peer')
      await waitFor(() => idle(worker), 'the flushed turn to end')
      const endings = everyHoldEndedOnce(ledger(worker))
      expect([...endings.values()].flat()).toEqual(['sent'])
      // ⚑ The ledger's turn is the person's own — no attribution key at all.
      expect(turnsCarrying(worker, 'the person’s own words')[0]).not.toHaveProperty('attribution')
    })

    // Windows forbids quotes in a filename, so this quotation-break fixture is POSIX-only.
    it.skipIf(process.platform === 'win32')(
      '⚑ …and the attachment rule is asked again at the flush: a name that ends its own quotation gets no stamp',
      async () => {
        const planted = join(realpathSync(root), 'notes" ultracode "x.md')
        writeFileSync(planted, 'the notes')
        const attached: HandedPath[] = [{ path: planted, kind: 'file', outsideCwd: false }]
        const pm = await personOpens('pm')
        // ⚑ Busy first, so the person's send meets a turn another sender holds.
        queryOf('pm').holding = true
        await host.queueMessage(pm, 'the app is saying something', THE_APP_ITSELF, [], 'notice')
        await waitFor(() => queryOf('pm').heard.length === 1, 'the app’s turn to open')
        await host.send(pm, 'summarise this', window, attached)
        expect(held(pm, 'summarise this')).toHaveLength(1)
        queryOf('pm').release()
        await waitFor(() => heardCarrying('pm', 'summarise this') !== undefined, 'the flush')
        const heard = heardCarrying('pm', 'summarise this')
        expect(JSON.stringify(heard?.message.content)).toContain('ultracode')
        expect(Object.keys(heard ?? {}), 'no stamp, exactly as the direct send').not.toContain(
          'origin',
        )
        await waitFor(() => idle(pm), 'the flushed turn to end')
        everyHoldEndedOnce(ledger(pm))
      },
    )

    it('⚑ a held send is still the person’s to take back — and then it never reaches the provider', async () => {
      const pm = await personOpens('pm')
      queryOf('pm').holding = true
      await host.queueMessage(pm, 'the app is saying something', THE_APP_ITSELF, [], 'notice')
      await waitFor(() => queryOf('pm').heard.length === 1, 'the app’s turn to open')
      await host.send(pm, 'on second thoughts', window)
      const [queued] = held(pm, 'on second thoughts')
      if (queued?.type !== 'message_queued' || queued.messageId === undefined) {
        throw new Error('the send was not held')
      }
      await host.cancelQueuedMessage(pm, queued.messageId, window)
      queryOf('pm').release()
      await waitFor(() => idle(pm), 'the app’s turn to end')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(heardTexts('pm').join('\n')).not.toContain('on second thoughts')
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual(['cancelled'])
    })

    it('⚑ control: a send that meets an idle conversation is SENT, with no hold and no second attempt', async () => {
      const pm = await personOpens('pm')
      await host.send(pm, 'nothing in the way', window)
      await waitFor(() => heardCarrying('pm', 'nothing in the way') !== undefined, 'the turn')
      expect(held(pm, 'nothing in the way')).toHaveLength(0)
      expect(attempts.filter((one) => one.text.includes('nothing in the way'))).toHaveLength(1)
      expect(heardCarrying('pm', 'nothing in the way')?.origin).toStrictEqual({ kind: 'human' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the interrupt-and-send
  // ───────────────────────────────────────────────────────────────────────────────────────────

  // ⚑ D-027 · "wait behind the replacement" was this title: with work already waiting, an arrival
  // now goes in the replacement's one turn, ahead of it in ledger order.
  describe('§2 · the interrupt-and-send — arrivals are held until the press lets go (and, with work waiting, go in its one turn), and a residual race is held', () => {
    /** ⚑ Busy on a parked turn, and — when asked — with the person's own message queued behind it. */
    const busyWith = async (queuedFirst: boolean): Promise<string> => {
      const pm = await personOpens('pm')
      queryOf('pm').holding = true
      await host.send(pm, 'the first thing', window)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the first turn to open')
      if (queuedFirst) {
        expect(await host.queueMessage(pm, 'queued before it', window)).toMatchObject({
          outcome: 'queued',
        })
      }
      return pm
    }
    /**
     * ⚑ The SECOND sign-in check is the one after the interrupt: `sendInterrupting` asks once at its
     * top. ⚑ D-027 · it is the replacement's own gate — or, when the words join what waits, the
     * queue's gate on them.
     */
    const parkTheReplacement = (): { open: () => void } => {
      const gate = latch()
      signIn = { skip: 1, gate }
      return gate
    }
    /**
     * ⚑ Each turn the SDK heard, as the words below it carries, in the order it carries them —
     * ⚑ D-027 · a list per turn, since one turn now carries everything that was held.
     */
    const heardOrder = (): string[][] =>
      heardTexts('pm').map((one) =>
        [
          'the first thing',
          'no, do this instead',
          'queued before it',
          'a child replied',
          'typed meanwhile',
        ]
          .filter((words) => one.includes(words))
          .sort((a, b) => one.indexOf(a) - one.indexOf(b)),
      )

    it('🔴 a reply arriving in the gap is HELD, and goes in the one turn with the replacement — with the person’s own message already queued', async () => {
      // ⛔ **The review's case**: before the latch held arrivals, the reply took the turn, the
      // replacement lost, met the one-work-message rule over `queued before it`, and was REFUSED —
      // after the turn it replaced was already gone.
      //
      // 🔴 **D-027 · R2 moved where the replacement goes**: with `queued before it` waiting, the
      // person's words JOIN what waits (`itJoinsWhatWaits`) — so the second sign-in check this
      // parks is now the QUEUE's gate on those words, and they are held in the order they reach
      // the mailbox: after the reply that arrived while the gate was parked.
      const pm = await busyWith(true)
      const gate = parkTheReplacement()
      const replacing = host.sendInterrupting(pm, 'no, do this instead', window)
      await signInReached.promise
      const arrived = await host.queueMessage(pm, 'a child replied', THE_APP_ITSELF, [], 'notice')
      // ⚑ **Held, on a conversation that is idle this instant** — the latch is what says busy.
      expect(arrived).toMatchObject({ outcome: 'queued' })
      expect(heardCarrying('pm', 'a child replied')).toBeUndefined()
      gate.open()
      await expect(replacing).resolves.toBeUndefined()
      // 🔴 **The replacement was HELD too — last — and nothing went before the press let go.**
      expect(held(pm, 'no, do this instead')).toHaveLength(1)
      await waitFor(
        () => heardCarrying('pm', 'no, do this instead') !== undefined,
        'the replacement',
      )
      // ⚑ **ONE turn after the one it replaced**, carrying everything, in ledger order.
      expect(heardOrder()).toEqual([
        ['the first thing'],
        ['queued before it', 'a child replied', 'no, do this instead'],
      ])
      // ⛔ **A turn with the app's words in it is not the person's** (D-027 · R2, the stamp that
      // claims less): mixed, so no stamp at all — where the replacement alone went `human`.
      expect(heardCarrying('pm', 'no, do this instead')?.origin).toBeUndefined()
      queryOf('pm').release()
      await waitFor(() => idle(pm), 'the last turn to end')
      // ⚑ Nothing followed it, and the ledger's one turn has each message as a part, in that order.
      expect(heardTexts('pm')).toHaveLength(2)
      expect(
        turnsCarrying(pm, 'no, do this instead').map((turn) =>
          turn.type === 'user_turn' ? turn.parts?.map((part) => part.text) : undefined,
        ),
      ).toEqual([['queued before it', 'a child replied', 'no, do this instead']])
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual(['sent', 'sent', 'sent'])
    })

    it('🔴 the residual race — a door that does not ask the queue first wins: the replacement is HELD, and flushes `human`', async () => {
      const pm = await busyWith(false)
      const gate = parkTheReplacement()
      const replacing = host.sendInterrupting(pm, 'no, do this instead', window)
      await signInReached.promise
      // ⚑ The person's own plain send asks no latch, so it can still take the turn in this gap.
      await host.send(pm, 'typed meanwhile', window)
      await waitFor(() => heardCarrying('pm', 'typed meanwhile') !== undefined, 'the plain send')
      gate.open()
      await expect(replacing).resolves.toBeUndefined()
      expect(held(pm, 'no, do this instead')).toHaveLength(1)
      expect(attempts.filter((one) => one.text.includes('no, do this instead'))).toHaveLength(1)
      // ⛔ **Held is not sent**: no `user_turn` until the flush writes one.
      expect(turnsCarrying(pm, 'no, do this instead')).toHaveLength(0)
      queryOf('pm').release()
      await waitFor(
        () => heardCarrying('pm', 'no, do this instead') !== undefined,
        'the replacement to flush',
      )
      expect(heardCarrying('pm', 'no, do this instead')?.origin).toStrictEqual({ kind: 'human' })
      await waitFor(() => idle(pm), 'the replacement’s turn to end')
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual(['sent'])
    })

    it('⚑ …and with the person’s own work already waiting, that residual race is HELD behind it (D-010) — nothing lost, each sent in order', async () => {
      const pm = await busyWith(true)
      const gate = parkTheReplacement()
      const replacing = host.sendInterrupting(pm, 'no, do this instead', window)
      replacing.catch(() => {})
      await signInReached.promise
      await host.send(pm, 'typed meanwhile', window)
      await waitFor(() => heardCarrying('pm', 'typed meanwhile') !== undefined, 'the plain send')
      gate.open()
      // ⚑ **Refused until D-010** (one work message at a time); held behind the person's own now.
      await expect(replacing).resolves.toBeUndefined()
      expect(held(pm, 'no, do this instead')).toHaveLength(1)
      queryOf('pm').release()
      await waitFor(() => heardCarrying('pm', 'queued before it') !== undefined, 'the queued one')
      await waitFor(
        () => heardCarrying('pm', 'no, do this instead') !== undefined,
        'the replacement, after it',
      )
      await waitFor(() => idle(pm), 'its turn to end')
      const heard = heardTexts('pm').join('\n')
      expect(heard.indexOf('queued before it')).toBeLessThan(heard.indexOf('no, do this instead'))
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual(['sent', 'sent'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · `657` F-c, corrected
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a turn a person STOPPED is not a lost race — its words are never sent later', () => {
    /**
     * ⛔ **The brief asked for the opposite, and this is why it is not done.** Claude's *"the turn
     * was stopped before its message could be sent"* is raised when `interrupt()` force-ended the
     * turn this send had opened. ⚠️ **`657` F-c called that a second lost-race shape, and it is not
     * one**: the send did not lose a handover, a person ENDED its turn. Typing it as
     * `TurnInProgress` makes every hold take it, and the words go out after the person's next
     * message — the message they gave up on. `claude-runtime.test.ts`' `H5 · …and it is THIS turn`
     * pins the adapter's half; this is the host's half.
     */
    it('⛔ Stop, then type the next thing: the stopped words never reach the provider', async () => {
      const pm = await personOpens('pm')
      await host.setSessionSetting(pm, { kind: 'model', model: 'opus' }, window)
      const settings = latch()
      queryOf('pm').settingsHeld = settings.promise
      const stopped = host.send(pm, 'the message I gave up on', window)
      stopped.catch(() => {})
      await waitFor(() => queryOf('pm').calls.includes('setModel:opus'), 'the send to suspend')
      await host.interrupt(pm, window)
      queryOf('pm').settingsHeld = null
      // ⛔ **The next turn is kept OPEN while the stopped send resumes** — the shape the brief's fix
      // turns on: a turn other than the stopped one holds the conversation at that moment.
      queryOf('pm').holding = true
      await host.send(pm, 'what I actually meant', window)
      await waitFor(() => heardCarrying('pm', 'what I actually meant') !== undefined, 'the next')
      settings.open()
      // ⚑ **The person is told what happened to it**, which is the adapter's sentence.
      await expect(stopped).rejects.toThrow(/stopped before its message could be sent/)
      queryOf('pm').release()
      await waitFor(() => idle(pm), 'the next turn to end')
      await new Promise((resolve) => setTimeout(resolve, 30))
      // 🔴 **Never held, never sent** — not before the next turn and not after it.
      expect(heardTexts('pm').join('\n')).not.toContain('the message I gave up on')
      expect(held(pm, 'the message I gave up on')).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · `657` F-d
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a hold behind a head that ended without a turn goes at once', () => {
    const attachedFile = (name: string): HandedPath[] => {
      const path = join(realpathSync(root), name)
      writeFileSync(path, 'x')
      return [{ path, kind: 'file', outsideCwd: false }]
    }

    const busyWithTwoHeld = async (
      firstAttached: HandedPath[],
    ): Promise<{ pm: string; first: HandedPath[] }> => {
      const pm = await personOpens('pm')
      queryOf('pm').holding = true
      await host.send(pm, 'the running turn', window)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the running turn to open')
      await host.queueMessage(pm, 'the head', window, firstAttached)
      await host.queueMessage(pm, 'held behind it', THE_APP_ITSELF, [], 'notice')
      expect(held(pm, 'the head')).toHaveLength(1)
      expect(held(pm, 'held behind it')).toHaveLength(1)
      return { pm, first: firstAttached }
    }

    it('🔴 the head’s file is gone: it is abandoned, and the message behind it is SENT on the idle receiver', async () => {
      // ⚑ **D-027 moved how the one behind gets there**: it is in the head's own take now
      // (`theTurnItTakes`), which ends the head on its own (`readyToGo`) and sends the rest in the
      // same flush — so this case no longer reaches the repeat.
      const { pm, first } = await busyWithTwoHeld(attachedFile('gone.md'))
      unlinkSync(first[0]!.path)
      queryOf('pm').release()
      await waitFor(
        () => heardCarrying('pm', 'held behind it') !== undefined,
        'the message behind the abandoned head',
      )
      await waitFor(() => idle(pm), 'its turn to end')
      const endings = everyHoldEndedOnce(ledger(pm))
      expect([...endings.values()].flat().sort()).toEqual(['abandoned', 'sent'])
      expect(heardTexts('pm').join('\n')).not.toContain('the head')
    })

    it('⚑ control: the head’s file is there, so the head starts a turn — and the one behind goes IN it, with nothing left for the next', async () => {
      // 🔴 **D-027 moved this control's fact**: the one behind no longer WAITS for the head's turn to
      // end — both go as ONE turn, oldest first, and that turn's end has nothing left to send. ⚑ It
      // still tells the head that starts a turn from the head that ended without one (above): here
      // the head is IN the turn, with its file.
      const { pm } = await busyWithTwoHeld(attachedFile('here.md'))
      queryOf('pm').release()
      queryOf('pm').holding = true
      await waitFor(() => heardCarrying('pm', 'the head') !== undefined, 'the head to be sent')
      // ⚑ The same turn carries both, the head first — the one boundary's worth.
      expect(heardCarrying('pm', 'held behind it')).toBe(heardCarrying('pm', 'the head'))
      const together = heardTexts('pm').at(-1) ?? ''
      expect(together.indexOf('the head')).toBeLessThan(together.indexOf('held behind it'))
      expect(together).toContain('here.md')
      queryOf('pm').release()
      await waitFor(() => idle(pm), 'its turn to end')
      await new Promise((resolve) => setTimeout(resolve, 30))
      // ⚑ …and its end sent nothing more: the running turn, then the one turn of both.
      expect(queryOf('pm').heard).toHaveLength(2)
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual(['sent', 'sent'])
    })

    it('⚑ bounded: three heads whose files are gone are each abandoned once, and the loop stops on an idle receiver', async () => {
      const pm = await personOpens('pm')
      queryOf('pm').holding = true
      await host.send(pm, 'the running turn', window)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the running turn to open')
      const files = [attachedFile('a.md'), attachedFile('b.md'), attachedFile('c.md')]
      await host.queueMessage(pm, 'one', window, files[0])
      await host.queueMessage(pm, 'two', THE_APP_ITSELF, files[1], 'notice')
      await host.queueMessage(pm, 'three', THE_APP_ITSELF, files[2], 'question')
      for (const each of files) unlinkSync(each[0]!.path)
      queryOf('pm').release()
      await waitFor(
        () => ledger(pm).filter((event) => event.type === 'message_unqueued').length === 3,
        'all three to end',
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect([...everyHoldEndedOnce(ledger(pm)).values()].flat()).toEqual([
        'abandoned',
        'abandoned',
        'abandoned',
      ])
      expect(queryOf('pm').heard).toHaveLength(1)
      expect(idle(pm)).toBe(true)
    })

    it('⚑ bounded the other way: a head LEFT waiting is retried at the next boundary, not in a loop', async () => {
      const { pm } = await busyWithTwoHeld([])
      signInFails = true
      const before = signInChecks
      queryOf('pm').release()
      await waitFor(() => idle(pm), 'the running turn to end')
      await new Promise((resolve) => setTimeout(resolve, 60))
      // ⚑ One flush asked once, and left both waiting — the ending it owes is a later one.
      expect(signInChecks - before).toBe(1)
      expect(ledger(pm).filter((event) => event.type === 'message_unqueued')).toHaveLength(0)
    })

    it('🔴 the sign-in moved on: no held message is ended — this app reopens it on the current one, and once only', async () => {
      const { pm } = await busyWithTwoHeld([])
      const before = signInChecks
      superseded = true
      queryOf('pm').release()
      const reopened = (): number =>
        ledger(pm).filter(
          (event) => event.type === 'reopened' && event.because === 'the-sign-in-moved-on',
        ).length
      await waitFor(() => reopened() === 1, 'this app to reopen it on the current sign-in')
      // ⛔ **The loop guard**: every handle here holds a moved sign-in, so the life it reopened
      // finds its own moved on before anything went in — and is left for a person, not reopened.
      // ⚑ Two asks: the first life's flush, then the reopened one's.
      await waitFor(
        () => signInChecks >= before + 2,
        'the reopened life’s flush to ask its sign-in',
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(reopened()).toBe(1)
      expect(ledger(pm).filter((event) => event.type === 'message_unqueued')).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · `657` F-e
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the interrupt-and-send reads who is sending BEFORE it hands the words over', () => {
    /**
     * ⛔ **Armed at the handover**, and only for the read inside `whoseWordsTheseAre` — that read
     * has a twin before the handover once this is fixed, so a trap armed from the start would fire
     * before the send both before and after the fix and measure nothing.
     */
    const aReadThatFails = (id: string): void => {
      const real = store.identityOf.bind(store)
      vi.spyOn(store, 'identityOf').mockImplementation((asked: string) => {
        const theRead = (new Error().stack ?? '').includes('whoseWordsTheseAre')
        if (handedOver && theRead && asked === id)
          throw new Error('SQLITE_BUSY: database is locked')
        return real(asked)
      })
    }

    it('🔴 a read failing after the handover no longer reports a delivered interruption as failed', async () => {
      const { pm, worker } = await aPmAndItsIdleWorker()
      const asThePm: Caller = { ownerId: agentCallerId(pm) }
      aReadThatFails(pm)
      handedOver = false
      await expect(
        host.sendInterrupting(worker, 'stop and do this instead', asThePm),
      ).resolves.toBeUndefined()
      await waitFor(
        () => heardCarrying('worker-a', 'stop and do this instead') !== undefined,
        'the words to arrive',
      )
      expect(turnsCarrying(worker, 'stop and do this instead')).toHaveLength(1)
    })

    it('⚑ control: the same read failing BEFORE the handover refuses, and nothing was sent', async () => {
      const { pm, worker } = await aPmAndItsIdleWorker()
      const asThePm: Caller = { ownerId: agentCallerId(pm) }
      aReadThatFails(pm)
      handedOver = true
      const before = attempts.length
      await expect(
        host.sendInterrupting(worker, 'stop and do this instead', asThePm),
      ).rejects.toThrow('SQLITE_BUSY')
      expect(
        attempts
          .slice(before)
          .map((one) => one.text)
          .join('\n'),
      ).not.toContain('stop and do this instead')
    })
  })
})

/**
 * ## §6 · the plan go-ahead — a lost race is held as BroBot's words
 *
 * ⚑ **On the Fake Codex adapter, because the go-ahead is a Codex door**: Claude refuses
 * `setPlanMode(false)` before anything is sent (`662`). The Fake refuses an overlapping send with
 * the same typed `TurnInProgress` the real adapters raise.
 */
describe('670 §6 · the plan go-ahead tells its two cases apart', () => {
  let userData: string
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let planGate: { promise: Promise<void>; open: () => void } | null
  let planReached: { promise: Promise<void>; open: () => void }
  let parkedPlans: (() => void)[]
  let failTheGoAhead: boolean
  let received: string[]
  let window: RecordingSink

  class Recording extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions: new FakeProviderSessions() })
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      const handle = await super.start(options)
      handles.push(handle)
      return new Proxy(handle, {
        get(target, prop) {
          if (prop === 'setPlanMode') {
            return async (on: boolean): Promise<void> => {
              if (!on && planGate !== null) {
                const gate = planGate
                planGate = null
                parkedPlans.push(gate.open)
                planReached.open()
                await gate.promise
              }
              return target.setPlanMode(on)
            }
          }
          if (prop === 'send') {
            return (text: string, origin?: TurnProvenance): Promise<void> => {
              // The message, without the block this app adds at its end.
              const said = withoutWhatThisAppAdds(text)
              received.push(said)
              if (failTheGoAhead && said === GO_AHEAD_MESSAGE) {
                return Promise.reject(new Error(TURN_REFUSED))
              }
              return target.send(text, origin)
            }
          }
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value
        },
      })
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-670-go-ahead-'))
    handles = []
    planGate = null
    parkedPlans = []
    planReached = latch()
    failTheGoAhead = false
    received = []
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Recording(provider),
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    for (const open of parkedPlans) open()
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  const eventsOf = (): TranscriptEvent[] => window.messages.map((message) => message.event)
  const cardsOf = (): string[] =>
    eventsOf()
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event.type === 'permission_request' ? event.id : ''))
  const answerEveryCard = async (sessionId: string): Promise<void> => {
    for (const id of cardsOf()) {
      await host.respondPermission(sessionId, id, { outcome: 'allow' }, window).catch(() => {})
    }
  }

  /** A Codex conversation that has planned, and is idle with the plan in front of the person. */
  const aPlanWaitingForItsGoAhead = async (): Promise<{
    sessionId: string
    handle: FakeSessionHandle
  }> => {
    const { sessionId } = await host.createSession(
      { provider: 'codex', planMode: true, approvalMode: 'ask' },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    await host.send(sessionId, 'plan it', window)
    await waitFor(() => cardsOf().length === 1, 'the planning turn to park on its card')
    await answerEveryCard(sessionId)
    await waitFor(() => handle.status() === 'idle', 'the planning turn to end')
    return { sessionId, handle }
  }

  it('🔴 a lost race: the go-ahead is HELD, and flushes as BroBot’s words — no frame, no stamp, `app_authored`', async () => {
    const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
    const gate = latch()
    planGate = gate
    const going = host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)
    await planReached.promise
    // ⚑ BroBot delivers something into the gap between the release and the go-ahead, and wins.
    await host.queueMessage(sessionId, 'a child replied', THE_APP_ITSELF, [], 'notice')
    await waitFor(() => handle.status() !== 'idle', 'the notice’s turn to open')
    gate.open()
    // 🔴 **Resolved, and the release is not reported as a failure.**
    await expect(going).resolves.toBeUndefined()
    const queued = eventsOf().filter(
      (event) => event.type === 'message_queued' && event.text === GO_AHEAD_MESSAGE,
    )
    expect(queued).toHaveLength(1)
    // ⚑ Tried once at the adapter and refused, and no `user_turn` for it yet.
    expect(received.filter((text) => text === GO_AHEAD_MESSAGE)).toHaveLength(1)
    await answerEveryCard(sessionId)
    await waitFor(
      () => received.filter((text) => text === GO_AHEAD_MESSAGE).length === 2,
      'the go-ahead to flush',
    )
    // ⛔ **Byte for byte what the direct go-ahead sends**: no frame in front of it.
    expect(received.at(-1)).toBe(GO_AHEAD_MESSAGE)
    // ⛔ **No stamp** — the seam gets `undefined`, as the direct go-ahead's does.
    expect(handle.origins.at(-1)).toBeUndefined()
    await waitFor(
      () =>
        eventsOf().some((event) => event.type === 'user_turn' && event.text === GO_AHEAD_MESSAGE),
      'the go-ahead’s turn to be recorded',
    )
    const turn = eventsOf().find(
      (event) => event.type === 'user_turn' && event.text === GO_AHEAD_MESSAGE,
    )
    // 🔴 **`app_authored` and nothing else** — the row the direct go-ahead writes by hand.
    // ⚑ **F093 · R2 — and the whole text it was handed**, which for the go-ahead is its words.
    // ⚑ …which ends with the block this app adds to every turn, cut here.
    expect(
      turn?.type === 'user_turn'
        ? { ...turn, sent: withoutWhatThisAppAdds(turn.sent ?? '') }
        : turn,
    ).toStrictEqual({
      type: 'user_turn',
      text: GO_AHEAD_MESSAGE,
      attribution: 'app_authored',
      sent: GO_AHEAD_MESSAGE,
    })
    await answerEveryCard(sessionId)
    await waitFor(() => handle.status() === 'idle', 'the go-ahead’s turn to end')
    everyHoldEndedOnce(eventsOf())
  })

  it('⚑ control: a failure that is not a race still says the go-ahead was not sent, and holds nothing', async () => {
    const { sessionId } = await aPlanWaitingForItsGoAhead()
    failTheGoAhead = true
    await expect(host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)).rejects.toThrow(
      /the plan was released but the go-ahead was not sent/,
    )
    expect(
      eventsOf().filter(
        (event) => event.type === 'message_queued' && event.text === GO_AHEAD_MESSAGE,
      ),
    ).toHaveLength(0)
  })
})
