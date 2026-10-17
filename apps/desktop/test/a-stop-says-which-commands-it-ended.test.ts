import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, SessionMachine } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { undrivenWorkText } from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { Exchange } from '../src/shared/last-exchange'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 F084 · a stop says which commands it ended, and what still runs
 *
 * ⚑ A turn's ending names the commands its stop ended (`endedCommands`, the adapters' — see
 * `a-codex-stop-ends-the-commands-its-turn-started` and `a-claude-stop-names-the-bash-it-waited-on`).
 * The host reads it, names each by the words of the call that started it, and says it:
 *
 *  - **`interrupt_agent`'s answer** — `ended` and `still_running`, and "The stop ended …" / "It still
 *    has … running in the background", once the stopped turn ended within the wait; unknown (it did
 *    not end in time) is never said as "none";
 *  - **the `message_agent` receipt** with `interrupt` — the same facts, or, when the ending is not in
 *    yet, the receiver's provider's rule for a stop that makes way for words;
 *  - **the `answer_question` receipt** with `interrupt`, to an asker whose turn runs — the same;
 *  - **the giver's stall notice** — "The stop ended …" when a stop stalled the piece, and
 *    "X still has … running in the background";
 *  - **the stopped agent's next words** — they open with "When your turn was stopped, the stop ended
 *    …", said once, and again after a turn this app ended `failed`.
 *
 * ⚑ And `interrupt_agent` and a person's Stop are EXPLICIT stops (`endEverythingTheTurnStarted`);
 * a stop that makes way for words is not.
 *
 * ⚑ Every arm runs the real host over the fake runtime, with a worker whose turn stays `working`
 * until it is stopped; its stop ends what the adapters now report it ends: of the two commands each
 * turn starts — `/bin/sleep 81.n` (moved on from) and `/bin/sleep 82.n` (waited on) — the waited one
 * for a stop that makes way for words, both for an explicit one.
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

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly decorate: (handle: FakeSessionHandle) => FakeSessionHandle,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = this.decorate(await super.start(options))
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** What a decorated worker was handed, and asked, so a test can read it and end its turns. */
interface TheWorker {
  readonly machine: SessionMachine
  /** The words each turn was handed, in order. */
  readonly words: string[]
  /** How many stops the host asked for. */
  stops: number
  /** How many of them the host made explicit (`endEverythingTheTurnStarted`). */
  widened: number
}

const workers = new Map<FakeSessionHandle, TheWorker>()

/** The level a worker's provider publishes when an earlier turn left a command running. */
const AN_EARLIER_COMMAND: RuntimeEvent = {
  type: 'background_work',
  running: [{ id: '35912', toolCallId: 'exec-earlier', description: '/bin/sleep 91.2' }],
  source: 'thread/backgroundTerminals/list',
}

interface HowItStops {
  /** Every stop after the first ends nothing (the commands are gone). */
  readonly quietAfterTheFirst?: boolean
  /** `false`: the turn does not end on the stop — its ending is not in within the host's wait. */
  readonly endsTheTurn?: boolean
  /** The provider lists a command an earlier turn left running. */
  readonly anEarlierCommand?: boolean
}

/**
 * ⚑ **A worker whose turn stays `working` until it is stopped**, each turn starting two commands —
 * `exec-moved-n` (`/bin/sleep 81.n`) and `exec-waited-n` (`/bin/sleep 82.n`) — and whose stop ends
 * them as the adapters report it: the waited one, and the moved-on one too when the host made the
 * stop explicit at once after asking it.
 */
function aWorkerWhoseStopEndsItsCommands(how: HowItStops = {}) {
  return (handle: FakeSessionHandle): FakeSessionHandle => {
    const queue = new AsyncQueue<RuntimeEvent>()
    let status = handle.status()
    const machine = new SessionMachine((event) => {
      if (event.type === 'status') status = event.state
      queue.push(event)
    })
    machine.markStarting()
    machine.sessionStarted(handle.ref, 'started')
    if (how.anEarlierCommand === true) queue.push(AN_EARLIER_COMMAND)
    let closing: Promise<void> | null = null
    let explicit = false
    const worker: TheWorker = { machine, words: [], stops: 0, widened: 0 }
    const proxy = new Proxy(handle, {
      get(target, property) {
        if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
        if (property === 'status') return () => status
        if (property === 'waitForAPerson') {
          return (): (() => void) => {
            machine.beginWait()
            let held = true
            return () => {
              if (!held) return
              held = false
              machine.endWait()
            }
          }
        }
        if (property === 'send') {
          return async (said: unknown): Promise<void> => {
            worker.words.push(typeof said === 'string' ? said : JSON.stringify(said))
            if (machine.beginTurn() === null) {
              throw new Error('cannot send: session is not active or a turn is in progress')
            }
            const n = String(worker.words.length)
            queue.push({
              type: 'tool_call',
              id: `exec-moved-${n}`,
              name: 'shell',
              summary: `/bin/sleep 81.${n}`,
              backgroundId: `81${n}`,
            })
            queue.push({
              type: 'tool_call',
              id: `exec-waited-${n}`,
              name: 'shell',
              summary: `/bin/sleep 82.${n}`,
              backgroundId: `82${n}`,
            })
          }
        }
        if (property === 'endEverythingTheTurnStarted') {
          return (): void => {
            explicit = true
            worker.widened += 1
          }
        }
        if (property === 'interrupt') {
          return async (): Promise<void> => {
            worker.stops += 1
            machine.requestInterrupt()
            if (how.endsTheTurn === false) return
            const n = String(worker.words.length)
            const open = machine.openTurnId
            const quiet = how.quietAfterTheFirst === true && worker.stops > 1
            if (open !== null && !quiet) machine.noteWhatTheStopEnded(open, [`exec-waited-${n}`])
            // ⚑ The host widens a stop at once after asking it, before anything is awaited — as
            // Codex's pass reads the widening only once its list answers.
            await new Promise((resolve) => setTimeout(resolve, 5))
            if (open !== null && explicit && !quiet) {
              machine.noteWhatTheStopEnded(open, [`exec-moved-${n}`])
            }
            explicit = false
            machine.completeTurn('interrupted')
          }
        }
        if (property === 'close') {
          return (): Promise<void> =>
            (closing ??= (async () => {
              if (machine.beginClose()) {
                if (machine.hasProviderWork) machine.forceEnd(false)
                machine.closeSession(handle.ref)
                queue.close()
              }
              await target.close()
            })())
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
    workers.set(proxy, worker)
    return proxy
  }
}

const BOTH = 'The stop ended “/bin/sleep 82.1” and “/bin/sleep 81.1”.'
const THE_WAITED_ONE = 'The stop ended “/bin/sleep 82.1”.'
const STILL_RUNS = 'still has “/bin/sleep 91.2” running in the background'
const TOLD_BOTH =
  'When your turn was stopped, the stop ended “/bin/sleep 82.1” and “/bin/sleep 81.1”, which no longer run.'
const TOLD_THE_WAITED_ONE =
  'When your turn was stopped, the stop ended “/bin/sleep 82.1”, which no longer runs.'
const TOLD = 'When your turn was stopped'

describe('F084 · a stop says which commands it ended, and what still runs', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pairs: number
  let decorateNextHandle: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, (handle) => {
          const decorate = decorateNextHandle
          decorateNextHandle = null
          return decorate?.(handle) ?? handle
        }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ Bounded: the double's stop ends its turn in ~5 ms; one that does not is waited 40 ms.
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f084-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f084-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
    decorateNextHandle = null
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return { structured: answered.structured as Record<string, unknown>, text: answered.text }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * ⚑ A pm a person opened, and a worker it gave one piece to, on `provider`; the worker's first
   * turn (its brief) is running, with its two commands recorded.
   */
  const aPmAndItsWorker = async (
    how: HowItStops = {},
    provider: Provider = 'codex',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    handle: FakeSessionHandle
    its: TheWorker
    label: string
    /** ⚑ The piece's id, which `ask_question` takes. */
    piece: string
    profile: string
  }> => {
    const nth = ++pairs
    const profile = `worker-${String(nth)}`
    const bring = await personOpens(profile, provider)
    await host.close(bring, window)
    const pm = await personOpens(`pm-${String(nth)}`, provider)
    const pmTools = agentToolsFor(host, pm)
    decorateNextHandle = aWorkerWhoseStopEndsItsCommands(how)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: 'the work',
      brief: 'the work',
    })
    decorateNextHandle = null
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const worker = given.structured.agent as string
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    const its = workers.get(handle)
    if (its === undefined) throw new Error('the worker was not decorated')
    expect(handle.ref?.provider).toBe(provider)
    await waitFor(() => handle.status() === 'working', 'the worker to be working')
    await waitFor(
      () => ledger(worker).filter((e) => e.type === 'tool_call').length >= 2,
      'the two calls',
    )
    if (how.anEarlierCommand === true) {
      await waitFor(
        () => ledger(worker).some((e) => e.type === 'background_work'),
        'the earlier command’s level',
      )
    }
    return {
      pm,
      worker,
      pmTools,
      handle,
      its,
      label: given.structured.label as string,
      piece: given.structured.piece as string,
      profile,
    }
  }

  /**
   * ⚑ **The worker asks its giver a question, and its turn goes on running** — the routed request's
   * id, which the giver's `answer_question` quotes.
   */
  const theWorkerAsks = async (worker: string, piece: string): Promise<string> => {
    const asked = await callOn(agentToolsFor(host, worker), 'ask_question', {
      who_answers: 'the-parent',
      piece,
      question: 'which schema?',
      options: ['a', 'b'],
    })
    expect(asked.structured.outcome, JSON.stringify(asked.structured)).toBe('ok')
    const row = store
      .routedRequestsOf(worker)
      .filter((one) => one.went.is === 'the-parent')
      .at(-1)
    if (row === undefined) throw new Error('the question was not routed')
    return row.requestId
  }

  /** What the giver was told about a piece that is not being worked on, since `from`. */
  const noticeAbout = (pm: string, label: string, from: number): string =>
    ledger(pm)
      .slice(from)
      .flatMap((event) =>
        'text' in event &&
        typeof event.text === 'string' &&
        event.text.includes(label) &&
        event.text.includes('not being worked on')
          ? [event.text]
          : [],
      )
      .join('\n---\n')

  const toldAbout = (pm: string, from: number): boolean =>
    ledger(pm)
      .slice(from)
      .some((event) => (event.type as string) === 'work_stall_told')

  describe('§1 · interrupt_agent — an explicit stop', () => {
    it('🔴 the answer names every command the stop ended; the notice says it; the next words open with it, once', async () => {
      const { pm, pmTools, handle, its, label } = await aPmAndItsWorker()
      const from = ledger(pm).length
      const stopped = await callOn(pmTools, 'interrupt_agent', {
        agent: label,
        reason: 'free the machine',
      })
      // ⚑ An explicit stop: the host made it one, at once.
      expect(its.widened).toBe(1)
      expect(stopped.structured.ended).toEqual(['/bin/sleep 82.1', '/bin/sleep 81.1'])
      expect(stopped.structured.still_running).toEqual([])
      expect(stopped.text).toContain(BOTH)
      expect(stopped.text).not.toContain('running in the background')

      await waitFor(() => handle.status() === 'idle', 'the worker to be idle')
      await waitFor(() => toldAbout(pm, from), 'the giver’s notice')
      await waitFor(() => noticeAbout(pm, label, from) !== '', 'the notice’s words')
      const notice = noticeAbout(pm, label, from)
      expect(notice).toContain(BOTH)
      expect(notice).not.toContain('running in the background')

      // ⚑ The next words open with it…
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'carry on' })
      await waitFor(() => its.words.length >= 2, 'the next turn')
      expect(its.words[1]).toContain(TOLD_BOTH)
      // ⛔ …once.
      its.machine.completeTurn('completed')
      await waitFor(() => handle.status() === 'idle', 'the worker idle again')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'and one more' })
      await waitFor(() => its.words.length >= 3, 'the turn after')
      expect(its.words[2]).not.toContain(TOLD)
    })

    it('🔴 a command an earlier turn left running is named as still running — in the answer and in the notice', async () => {
      const { pm, pmTools, handle, label } = await aPmAndItsWorker({ anEarlierCommand: true })
      const from = ledger(pm).length
      const stopped = await callOn(pmTools, 'interrupt_agent', { agent: label, reason: 'stop' })
      expect(stopped.structured.ended).toEqual(['/bin/sleep 82.1', '/bin/sleep 81.1'])
      expect(stopped.structured.still_running).toEqual(['/bin/sleep 91.2'])
      expect(stopped.text).toContain(BOTH)
      expect(stopped.text).toContain(
        'It still has “/bin/sleep 91.2” running in the background, which a stop does not end; to end that, ask it with message_agent.',
      )
      await waitFor(() => handle.status() === 'idle', 'the worker to be idle')
      await waitFor(() => noticeAbout(pm, label, from) !== '', 'the giver’s notice')
      const notice = noticeAbout(pm, label, from)
      expect(notice).toContain(BOTH)
      expect(notice).toContain(`${STILL_RUNS}.`)
    })

    it('⛔ a stopped turn that has not ended within the wait is UNKNOWN — never said as “none”', async () => {
      const { pmTools, its, label } = await aPmAndItsWorker({ endsTheTurn: false })
      const stopped = await callOn(pmTools, 'interrupt_agent', { agent: label, reason: 'stop' })
      // ⚑ The stop was asked (the premise), and the turn is still running.
      expect(stopped.structured.asked).toBe(true)
      expect(its.stops).toBe(1)
      expect(stopped.structured).not.toHaveProperty('ended')
      expect(stopped.text).not.toContain('The stop ended')
    })

    it('⛔ a later stop that ended nothing never names an earlier stop’s commands', async () => {
      const { pm, worker, pmTools, handle, its, label, profile } = await aPmAndItsWorker({
        quietAfterTheFirst: true,
      })
      const first = await callOn(pmTools, 'interrupt_agent', { agent: label, reason: 'one' })
      expect(first.structured.ended).toEqual(['/bin/sleep 82.1', '/bin/sleep 81.1'])
      await waitFor(() => handle.status() === 'idle', 'idle after the first stop')
      await callOn(pmTools, 'withdraw_task', { piece: label })
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'the second',
        brief: 'the second',
      })
      const label2 = given.structured.label as string
      await waitFor(
        () => its.words.length >= 2 && handle.status() === 'working',
        'the turn carrying the withdrawal',
      )
      // ⚑ That turn says the first stop's commands — the positive this test is paired with.
      expect(its.words[1]).toContain(TOLD_BOTH)
      await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'the withdrawal turn' })
      await waitFor(
        () => its.words.length >= 3 && handle.status() === 'working',
        'the second piece’s own turn',
      )
      const from = ledger(pm).length
      const second = await callOn(pmTools, 'interrupt_agent', { agent: label2, reason: 'two' })
      expect(second.structured.ended ?? []).toEqual([])
      expect(second.text).not.toContain('The stop ended')
      await waitFor(() => handle.status() === 'idle', 'idle after the second stop')
      await waitFor(() => noticeAbout(pm, label2, from) !== '', 'the second piece’s notice')
      expect(noticeAbout(pm, label2, from)).not.toContain('The stop ended')
    })
  })

  describe('§2 · message_agent with interrupt — a stop that makes way for words', () => {
    it('🔴 the receipt names only the command the turn waited on, and the receiver reads it in front of the words', async () => {
      const { pmTools, handle, its, label } = await aPmAndItsWorker()
      const said = await callOn(pmTools, 'message_agent', {
        agent: label,
        kind: 'note',
        text: 'pause and write down where you are',
        interrupt: true,
      })
      // ⛔ Not an explicit stop: the host never widened it.
      expect(its.widened).toBe(0)
      expect(said.structured.asked_to_stop).toBe(true)
      expect(said.structured.ended).toEqual(['/bin/sleep 82.1'])
      expect(said.structured).not.toHaveProperty('still_running')
      expect(said.text).toContain(THE_WAITED_ONE)
      expect(said.text).not.toContain('81.1')
      // ⛔ Facts, so the provider's rule is not said.
      expect(said.text).not.toContain('unless it has used another tool since')

      await waitFor(() => its.words.length >= 2, 'the message to reach the worker')
      expect(its.words[1]).toContain(TOLD_THE_WAITED_ONE)
      expect(its.words[1]).not.toContain('81.1')
      expect(its.words[1]).toContain(
        'any of your commands the stop ended are named above, anything not named there still runs, and your open questions are still open.',
      )
      expect(handle.status()).toBe('working')
    })

    it('⚑ …and what the receiver still has running in the background', async () => {
      const { pmTools, label } = await aPmAndItsWorker({ anEarlierCommand: true })
      const said = await callOn(pmTools, 'message_agent', {
        agent: label,
        kind: 'note',
        text: 'pause',
        interrupt: true,
      })
      expect(said.structured.ended).toEqual(['/bin/sleep 82.1'])
      expect(said.structured.still_running).toEqual(['/bin/sleep 91.2'])
      expect(said.text).toContain(`The stop ended “/bin/sleep 82.1”; `)
      expect(said.text).toContain(`${STILL_RUNS}.`)
    })

    it('🔴 when the stopped turn’s ending is not in yet, the receipt states the Codex rule — and claims nothing ended', async () => {
      const { pmTools, its, label } = await aPmAndItsWorker({ endsTheTurn: false }, 'codex')
      const said = await callOn(pmTools, 'message_agent', {
        agent: label,
        kind: 'note',
        text: 'pause',
        interrupt: true,
      })
      expect(its.stops).toBe(1)
      expect(said.structured.asked_to_stop).toBe(true)
      expect(said.structured).not.toHaveProperty('ended')
      expect(said.text).toContain(
        'ran last in that turn ends with it unless it has used another tool since, and its other commands keep running.',
      )
      expect(said.text).not.toContain('The stop ended')
    })

    it('⚑ …and on Claude, Claude’s rule', async () => {
      const { pmTools, label } = await aPmAndItsWorker({ endsTheTurn: false }, 'claude')
      const said = await callOn(pmTools, 'message_agent', {
        agent: label,
        kind: 'note',
        text: 'pause',
        interrupt: true,
      })
      expect(said.structured).not.toHaveProperty('ended')
      expect(said.text).toContain('The command that turn is waiting on ends with it, and anything')
      expect(said.text).toContain('sent to the background keeps running.')
      expect(said.text).not.toContain('unless it has used another tool since')
    })
  })

  /**
   * ⚑ **`answer_question`'s receipt arm** — an answer delivered with `interrupt` to an asker whose turn
   * runs is held behind that turn, which is asked to stop for it (a stop that makes way for words,
   * as `message_agent`'s is), and the answerer's receipt says what the stop ended and what still runs
   * — the same facts, through the host's `answerQuestion` rather than `messageAgentNow`.
   */
  describe('§2b · answer_question with interrupt — the answer’s receipt', () => {
    it('🔴 the receipt names only the command the asker’s turn waited on', async () => {
      const { worker, pmTools, handle, its, piece } = await aPmAndItsWorker()
      const question = await theWorkerAsks(worker, piece)
      // ⚑ The premise: the asker's turn still runs, so the answer is held behind it.
      expect(handle.status()).toBe('working')

      const said = await callOn(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: true,
      })
      expect(said.structured.outcome, JSON.stringify(said.structured)).toBe('ok')
      expect(its.stops).toBe(1)
      // ⛔ Not an explicit stop: an answer makes way for words, so the host never widened it.
      expect(its.widened).toBe(0)
      expect(said.structured.asked_to_stop).toBe(true)
      expect(said.structured.ended).toEqual(['/bin/sleep 82.1'])
      expect(said.structured).not.toHaveProperty('still_running')
      // ⚑ The answer's own arm, which says "your answer" where a message's says "this message".
      expect(said.text).toContain('so that your answer need not wait for that work to finish')
      expect(said.text).toContain(THE_WAITED_ONE)
      expect(said.text).not.toContain('81.1')
      // ⛔ Facts, so the provider's rule is not said.
      expect(said.text).not.toContain('unless it has used another tool since')
    })

    it('⚑ …and what the asker still has running in the background', async () => {
      const { worker, pmTools, piece } = await aPmAndItsWorker({ anEarlierCommand: true })
      const question = await theWorkerAsks(worker, piece)
      const said = await callOn(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: true,
      })
      expect(said.structured.asked_to_stop).toBe(true)
      expect(said.structured.ended).toEqual(['/bin/sleep 82.1'])
      expect(said.structured.still_running).toEqual(['/bin/sleep 91.2'])
      expect(said.text).toContain(`The stop ended “/bin/sleep 82.1”; `)
      expect(said.text).toContain(`${STILL_RUNS}.`)
    })

    it('⛔ the paired negative: when the asker’s ending is not in yet, the receipt states the Codex rule and claims nothing ended', async () => {
      const { worker, pmTools, its, piece } = await aPmAndItsWorker({ endsTheTurn: false })
      const question = await theWorkerAsks(worker, piece)
      const said = await callOn(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['b'] }],
        interrupt: true,
      })
      // ⚑ The stop was asked (the premise) — only its ending is missing.
      expect(its.stops).toBe(1)
      expect(said.structured.asked_to_stop).toBe(true)
      expect(said.structured).not.toHaveProperty('ended')
      expect(said.structured).not.toHaveProperty('still_running')
      expect(said.text).toContain(
        'ran last in that turn ends with it unless it has used another tool since, and its other commands keep running.',
      )
      expect(said.text).not.toContain('The stop ended')
    })
  })

  describe('§3 · the stopped agent is told — and told again after a turn this app failed', () => {
    it('🔴 said once; said again when the turn that said it is one this app ended `failed`', async () => {
      const { pmTools, handle, its, label } = await aPmAndItsWorker()
      await callOn(pmTools, 'interrupt_agent', { agent: label, reason: 'one' })
      await waitFor(() => handle.status() === 'idle', 'idle after the stop')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'first try' })
      await waitFor(() => its.words.length >= 2, 'the turn that says it')
      expect(its.words[1]).toContain(TOLD_BOTH)

      // ⚑ This app could not run that turn: what it said is owed again.
      its.machine.failTurn('this app could not start it')
      await waitFor(() => handle.status() === 'idle', 'idle after the failed turn')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'second try' })
      await waitFor(() => its.words.length >= 3, 'the next turn')
      expect(its.words[2]).toContain(TOLD_BOTH)

      // ⛔ A turn that ran said it: never again.
      its.machine.completeTurn('completed')
      await waitFor(() => handle.status() === 'idle', 'idle again')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'third' })
      await waitFor(() => its.words.length >= 4, 'the turn after')
      expect(its.words[3]).not.toContain(TOLD)
    })

    it('⛔ a turn that was never stopped opens with no such line', async () => {
      const { pmTools, handle, its, label } = await aPmAndItsWorker()
      its.machine.completeTurn('completed')
      await waitFor(() => handle.status() === 'idle', 'the brief’s turn to end')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'go on' })
      await waitFor(() => its.words.length >= 2, 'the next turn')
      expect(its.words[1]).not.toContain(TOLD)
    })
  })

  describe('§4 · what each description says a stop ends, per provider', () => {
    const FOR_WORDS =
      'On Claude, the command that turn is waiting on ends with it, and work it sent to the background keeps running; on Codex, the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running.'
    const FOR_YOUR_ANSWER =
      'On Claude, the command that turn is waiting on ends with it, and work you sent to the background keeps running; on Codex, the command you ran last in that turn ends with it unless you have used another tool since, and your other commands keep running.'
    const EXPLICIT =
      'on Codex, every command that turn started, even one it left running. A command an earlier turn left running keeps running.'

    it('🔴 a stop for words says the waited-command rule; interrupt_agent says the explicit one', async () => {
      const pm = await personOpens('pm-descriptions', 'claude')
      const tools = agentToolsFor(host, pm).tools
      const described = (name: ToolName): string =>
        tools.find((one) => one.name === name)?.description ?? `(no ${name})`
      expect(described('message_agent')).toContain(FOR_WORDS)
      expect(described('answer_question')).toContain(FOR_WORDS)
      expect(described('ask_question')).toContain(FOR_YOUR_ANSWER)
      expect(described('interrupt_agent')).toContain(EXPLICIT)
      // ⛔ …and never the other way round: a stop for words does not end every command.
      expect(described('message_agent')).not.toContain('every command that turn started')
      expect(described('interrupt_agent')).not.toContain('unless it has used another tool since')
    })
  })

  describe('§5 · a person’s Stop is an explicit one', () => {
    it('🔴 it widens the stop at once, and the worker is told both commands ended', async () => {
      const { pmTools, worker, handle, its, label } = await aPmAndItsWorker()
      // ⚑ A person stops what their window holds: the window takes the worker first.
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      expect(its.stops).toBe(1)
      expect(its.widened).toBe(1)
      await waitFor(() => handle.status() === 'idle', 'idle after the Stop')
      await callOn(pmTools, 'message_agent', { agent: label, kind: 'note', text: 'go on' })
      await waitFor(() => its.words.length >= 2, 'the next turn')
      expect(its.words[1]).toContain(TOLD_BOTH)
    })
  })
})

describe('F084 · the giver’s stall notice, line by line', () => {
  const piece = { label: 'W1.2', title: 'build the page', questionLostAtRestart: false }
  const nothingSaid: Exchange = { received: null, answer: null }
  const notice = (
    cause: 'turn_interrupted' | 'turn_ended',
    stillRunning: readonly string[],
    endedByTheStop: readonly string[],
  ): string[] =>
    undrivenWorkText(
      piece,
      cause,
      nothingSaid,
      'Ali',
      null,
      () => 'W1',
      false,
      false,
      stillRunning,
      endedByTheStop,
    ).split('\n\n')

  it('🔴 a stop that stalled it: what the stop ended, and what still runs — each its own paragraph, before the instruction', () => {
    const plain = notice('turn_interrupted', [], [])
    const said = notice('turn_interrupted', ['npm run dev'], ['/bin/sleep 82.1', '/bin/sleep 81.1'])
    expect(said).toHaveLength(plain.length + 2)
    const ended = said.indexOf('The stop ended “/bin/sleep 82.1” and “/bin/sleep 81.1”.')
    const runs = said.indexOf('Ali still has “npm run dev” running in the background.')
    const answer = said.findIndex((line) => line.startsWith('It has not been answered.'))
    expect(ended).toBeGreaterThan(0)
    expect(runs).toBeGreaterThan(ended)
    expect(answer).toBeGreaterThan(runs)
  })

  it('⛔ no stop stalled it: what a stop ended is not said — what still runs still is', () => {
    const plain = notice('turn_ended', [], [])
    const said = notice('turn_ended', ['npm run dev'], ['/bin/sleep 82.1'])
    expect(said).toHaveLength(plain.length + 1)
    expect(said.join('\n\n')).not.toContain('The stop ended')
    expect(said).toContain('Ali still has “npm run dev” running in the background.')
  })

  it('⛔ a stop that ended nothing, with nothing running, adds no line at all', () => {
    const plain = notice('turn_interrupted', [], [])
    expect(plain.join('\n\n')).not.toContain('The stop ended')
    expect(plain.join('\n\n')).not.toContain('running in the background')
    // ⚑ The paired positive: one name is enough to add its line.
    expect(notice('turn_interrupted', [], ['/bin/sleep 82.1'])).toHaveLength(plain.length + 1)
  })
})
