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
  UserInputQuestion,
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
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { PersonsQuestion } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-046 · each question waiting on a person carries the question as it was asked
 *
 * ⚑ `RuntimeHost.questionsForAPerson()` — the list *Waiting on you* reads — carries `asked` on
 * every row: the words, what the LAST conversation that passed it up added, whether it was passed
 * up, and every part whole (its id, header, wording, choices with their descriptions, and the rules
 * `allowOther`, `secret`, `multiSelect`). ⚑ Read off the SAME raised row `raisedBy`, `about` and
 * `offered` read; ⛔ `null` where no row was found, beside `raisedBy: 'nothing-says'`.
 *
 * ⚑ **§1 plants the ledger** (`scope-the-panes-claim`'s idiom), so every field is a known value and
 * a part's `false` flag can be told from an absent one. **§2 goes through the real verbs**:
 * `ask_question` to a person, and a PM's `pass_question_up` with words of its own.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const FROM = 1_760_000_000_000

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

/**
 * ⚑ **A turn that stays `working` until something ends it** — `state-a-supervisor-can-trust`'s
 * instrument: the worker asks while it works, and nobody is asked anything else meanwhile.
 */
function holdingAWorkingTurn(handle: FakeSessionHandle): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  return new Proxy(handle, {
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
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
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
}

describe('D-046 · the person’s list carries each question as it was asked', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  let decorateNextHandle: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const ordinals = new Map<string, number>()
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d046-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d046-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = FROM + 60_000
    counter = 0
    handles = []
    decorateNextHandle = null
    ordinals.clear()
    store = createSessionStore(db, tick)
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ─────────────────────────────────────────────────────────── §1 · planted, every field known

  const conversation = (id: string, parentSessionId?: string): void => {
    store.create({
      id,
      provider: 'codex',
      cwd: join(root, id),
      approvalMode: 'ask',
      profileId: `profile-${id}`,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
  }

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  /** ⚑ A routing that makes the request a person's — the shape `scope-the-panes-claim` plants. */
  const routedToAPerson = (id: string, requestId: string, when: number): void => {
    at(id, when, { type: 'request_routed', requestId, to: 'the-parent', parent: 'sess_lead' })
    at(id, when + 1, { type: 'request_escalated', requestId })
  }

  const listed = (): ReadonlyMap<string, PersonsQuestion> =>
    new Map(host.questionsForAPerson().rows.map((row) => [row.request.requestId, row]))

  /** ⚑ Two parts, with every rule and a `false` flag a reader could drop. */
  const PROVIDER_PARTS: UserInputQuestion[] = [
    {
      id: 'q1',
      header: 'Region',
      prompt: 'which region?',
      options: [{ label: 'eu', description: 'Frankfurt' }, { label: 'us' }],
      multiSelect: true,
      allowOther: false,
    },
    { id: 'q2', prompt: 'and the key for it?', options: [], secret: true },
  ]

  describe('§1 · read off the row that raised it, whole', () => {
    it('🔴 a question this app asked carries its words and its part, not passed up, nothing added', () => {
      conversation('sess_worker')
      const parts: UserInputQuestion[] = [
        {
          id: 'answer',
          prompt: 'which hotel?',
          options: [{ label: 'the Ritz' }, { label: 'the Savoy' }],
          allowOther: true,
        },
      ]
      at('sess_worker', FROM + 1, {
        type: 'question_asked',
        requestId: 'req_app',
        prompt: 'which hotel?',
        questions: parts,
      })
      routedToAPerson('sess_worker', 'req_app', FROM + 2)

      const row = listed().get('req_app')
      expect(row?.raisedBy).toBe('this-app')
      expect(row?.asked).toEqual({
        prompt: 'which hotel?',
        context: null,
        passedUp: false,
        parts,
      })
    })

    it('🔴 a question PASSED UP says so, carries what the passer added, and the parts it carries', () => {
      conversation('sess_pm')
      const carried: UserInputQuestion[] = [
        {
          id: 'answer',
          prompt: 'May I drop the old table?',
          options: [{ label: 'yes' }, { label: 'no' }],
        },
        { id: 'q2', prompt: 'and archive it first?', options: [{ label: 'yes' }] },
      ]
      at('sess_pm', FROM + 1, {
        type: 'question_asked',
        requestId: 'req_passed',
        passedUpFrom: 'req_original',
        context: 'It holds last year’s invoices.',
        prompt: 'May I drop the old table?',
        questions: carried,
      })
      routedToAPerson('sess_pm', 'req_passed', FROM + 2)
      // ⚑ **The control beside it, in the same list**: a question asked direct, not passed up.
      at('sess_pm', FROM + 4, {
        type: 'question_asked',
        requestId: 'req_direct',
        prompt: 'which colour?',
        questions: [{ id: 'answer', prompt: 'which colour?', options: [] }],
      })
      routedToAPerson('sess_pm', 'req_direct', FROM + 5)

      const rows = listed()
      const passed = rows.get('req_passed')?.asked
      expect(passed?.passedUp).toBe(true)
      expect(passed?.context).toBe('It holds last year’s invoices.')
      expect(passed?.prompt).toBe('May I drop the old table?')
      // ⚑ Every part, in the order asked — not only the first, and not the host's one-part offer.
      expect(passed?.parts).toEqual(carried)
      const direct = rows.get('req_direct')?.asked
      expect(direct?.passedUp).toBe(false)
      expect(direct?.context).toBeNull()
    })

    it('🔴 a question the PROVIDER raised carries its words and every part, rules and all', () => {
      conversation('sess_worker')
      at('sess_worker', FROM + 1, {
        type: 'user_input_request',
        id: 'req_provider',
        prompt: 'which region?',
        questions: PROVIDER_PARTS,
      })
      routedToAPerson('sess_worker', 'req_provider', FROM + 2)

      const row = listed().get('req_provider')
      expect(row?.raisedBy).toBe('the-provider')
      // ⛔ For drawing only — the asker's card stays the one surface that answers it.
      expect(row?.offered).toBeNull()
      expect(row?.asked).toEqual({
        prompt: 'which region?',
        context: null,
        passedUp: false,
        parts: PROVIDER_PARTS,
      })
      // ⚑ A `false` rule crosses as `false`, never dropped into *not said*.
      expect(row?.asked?.parts[0]?.allowOther).toBe(false)
      expect(row?.asked?.parts[1]?.secret).toBe(true)
    })

    it('⛔ a routing whose raising row is not in the ledger carries NO words, beside `nothing-says`', () => {
      conversation('sess_orphan')
      routedToAPerson('sess_orphan', 'req_orphan', FROM + 1)
      // ⚑ **The control in the same list**: a found row carries words.
      conversation('sess_worker')
      at('sess_worker', FROM + 4, {
        type: 'user_input_request',
        id: 'req_found',
        prompt: 'which region?',
        questions: PROVIDER_PARTS,
      })
      routedToAPerson('sess_worker', 'req_found', FROM + 5)

      const rows = listed()
      expect(rows.get('req_orphan')?.raisedBy).toBe('nothing-says')
      expect(rows.get('req_orphan')?.asked).toBeNull()
      expect(rows.get('req_found')?.asked).not.toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────── §2 · through the real verbs

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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  describe('§2 · what the verbs write is what the list carries', () => {
    it('🔴 a worker asks a person with choices; its PM passes another up with words of its own', async () => {
      const bring = await personOpens('worker')
      await host.close(bring, window)
      const pm = await personOpens('pm')
      const pmTools = agentToolsFor(host, pm)
      decorateNextHandle = holdingAWorkingTurn
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the work',
        brief: 'the work',
      })
      decorateNextHandle = null
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      const label = given.label as string
      const workerHandle = handles.at(-1) as FakeSessionHandle
      await waitFor(() => workerHandle.status() === 'working', 'the worker to be working')
      const workerTools = agentToolsFor(host, worker)

      const direct = await callOn(workerTools, 'ask_question', {
        who_answers: 'a-person',
        piece: label,
        question: 'Which colour for the button?',
        options: ['red', 'blue'],
      })
      expect(direct.outcome, JSON.stringify(direct)).toBe('ok')
      const toPm = await callOn(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: label,
        question: 'May I drop the old table?',
        options: ['yes', 'no'],
      })
      expect(toPm.outcome, JSON.stringify(toPm)).toBe('ok')
      const passed = await callOn(pmTools, 'pass_question_up', {
        question: toPm.question,
        who_answers: 'a-person',
        context: 'It holds last year’s invoices.',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')

      const rows = host.questionsForAPerson().rows
      const fromWorker = rows.find((one) => one.request.askedBy === worker)
      expect(fromWorker?.raisedBy).toBe('this-app')
      expect(fromWorker?.asked?.prompt).toBe('Which colour for the button?')
      expect(fromWorker?.asked?.passedUp).toBe(false)
      expect(fromWorker?.asked?.context).toBeNull()
      expect(fromWorker?.asked?.parts.map((part) => part.options.map((one) => one.label))).toEqual([
        ['red', 'blue'],
      ])

      const fromPm = rows.find((one) => one.request.askedBy === pm)
      expect(fromPm?.asked?.passedUp).toBe(true)
      expect(fromPm?.asked?.context).toBe('It holds last year’s invoices.')
      expect(fromPm?.asked?.prompt).toContain('May I drop the old table?')
      // ⚑ The worker's own part travelled with it.
      expect(fromPm?.asked?.parts[0]?.options.map((one) => one.label)).toEqual(['yes', 'no'])
      // ⛔ And the worker's ORIGINAL question is not on the person's list — it was asked of its PM.
      expect(rows.filter((one) => one.asked?.prompt === 'May I drop the old table?')).toHaveLength(
        1,
      )
    })
  })
})
