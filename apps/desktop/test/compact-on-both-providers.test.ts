import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CodexRuntime,
  FakeProviderSessions,
  FakeRuntime,
  capabilitiesFor,
  type AgentRuntime,
  type AgentToolset,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import {
  A_PERSON_SENT_IT,
  theDirectionLine,
  THE_PERSON_AT_A_WINDOW,
  type TurnOrigin,
} from '../src/main/runtime/turn-origin'
import { theOwnerOf } from '../src/shared/piece-called'
import {
  aCommandTakesNoAttachments,
  aCompactionTakesNoInstructions,
  aPersonsCompaction,
} from '../src/main/runtime/a-command-goes-as-typed'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  agentName,
  type HandedPath,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **713 · compact, on both providers** — `R59` and `R60`'s runtime half.
 *
 * ## ⛔ The defect (`708` H-2), measured
 *
 * ⚠️ **A person's `/compact` on Codex did nothing, before `708` and after it.** Codex's app-server has
 * no slash commands (`279`), so the words reached the model and the model answered them
 * (`probe:codex-command-as-typed`). Its compaction is a request of its own, `thread/compact/start`.
 *
 * ## ⚑ What this file holds
 *
 * - **§1 · the host over the REAL Codex adapter**, on a transport scripted from the wire that probe
 *   measured — so the decision, the adapter's request and the turn it runs are one path here, and
 *   what crossed it is read off the transport. 🔴 RED on `main`: a person's `/compact` went out on
 *   `turn/start`, inside its frame.
 * - **§2 · every door**, on a double that compacts on request: a held message's flush,
 *   interrupt-and-send, and the refusals that must come before either.
 * - **§3 · `R60`**: both providers declare the capability, and Claude's road is `R42`'s.
 *
 * ⚠️ **What this cannot say**: whether hosted Codex summarizes well. The probe's loopback model
 * answers every request with `ok` — *"This captures what the provider put in its model-bound
 * request, not a hosted model's obedience to the text."*
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** An async queue the scripted app-server pushes into. */
class Wire<T> implements AsyncIterable<T> {
  private readonly waiting: T[] = []
  private settle: ((result: IteratorResult<T>) => void) | null = null
  private closed = false
  push(item: T): void {
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: item, done: false })
      return
    }
    this.waiting.push(item)
  }
  close(): void {
    this.closed = true
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: undefined as never, done: true })
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.waiting.length > 0) {
          return Promise.resolve({ value: this.waiting.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.settle = resolve
        })
      },
    }
  }
}

/**
 * ⚑ **The app-server, scripted from what `probe:codex-command-as-typed` measured on 0.146.0.**
 *
 * - `turn/start` → its id, then (after the answer, as Codex writes it) `turn/started`, one agent
 *   message and `turn/completed` — an ordinary turn.
 * - `thread/compact/start` → `{}`, then `turn/started` under a NEW id, the `contextCompaction` item
 *   opening and closing, Codex's own warning, and `turn/completed`.
 *
 * ⚠️ Every request is kept, so a test reads what the adapter ASKED rather than what it emitted.
 */
class ScriptedCodex implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  constructor(readonly home: string) {}
  request(method: string, params?: unknown): Promise<unknown> {
    const given = (params ?? {}) as Record<string, unknown>
    this.requests.push({ method, params: given })
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.home,
      })
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = (given as { cwd?: string }).cwd ?? '/tmp/x'
      // ⚑ A conformant app-server applies the profile it was asked for — `auto` is `never` with no
      // sandbox — and the adapter fails a handshake that echoes anything else (013).
      const unattended = given['approvalPolicy'] === 'never'
      return Promise.resolve(
        threadStartResponse(
          'th_1',
          cwd,
          unattended ? { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } } : {},
        ) as unknown as Record<string, unknown>,
      )
    }
    if (method === 'turn/start') {
      const id = `tn_${String(++this.turns)}`
      setTimeout(() => this.anOrdinaryTurn(id), 0)
      return Promise.resolve(turnStartResponse(id))
    }
    if (method === 'thread/compact/start') {
      const id = `tc_${String(++this.turns)}`
      setTimeout(() => this.aCompaction(id), 0)
      return Promise.resolve({})
    }
    if (method === 'model/list') {
      // ⚑ **D-042 · R1 moved a fact here: every start NAMES its model and effort**, and a Codex start
      // naming nothing reads `model/list` and names the row it marks `isDefault`, at that row's
      // `defaultReasoningEffort` — the `{}` every other request is answered with now refuses the
      // launch (`nothing-names-a-model`, F2) before any conversation opens. One row, in the shape
      // 058 measured on 0.146.0 (`codex-runtime.ts`' `listModels`). ⚠️ The probe's app-server is
      // built BEFORE the session's, so `transports.at(-1)` is still the conversation's own.
      return Promise.resolve({
        data: [
          {
            id: 'm',
            model: 'm',
            displayName: 'm',
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'medium' }],
            defaultReasoningEffort: 'medium',
          },
        ],
        nextCursor: null,
      })
    }
    return Promise.resolve({})
  }
  private push(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  private anOrdinaryTurn(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    this.push('item/completed', {
      threadId: 'th_1',
      turnId: id,
      item: { type: 'agentMessage', id: `m_${id}`, text: 'ok' },
      completedAtMs: 1,
    })
    this.push('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
  }
  private aCompaction(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    const item = { type: 'contextCompaction', id: `cc_${id}` }
    this.push('item/started', { threadId: 'th_1', turnId: id, item, startedAtMs: 1 })
    this.push('item/completed', { threadId: 'th_1', turnId: id, item, completedAtMs: 2 })
    this.push('warning', {
      threadId: null,
      message:
        'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
    })
    this.push('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  exited: Promise<void> | undefined
  /** The text of every `turn/start` this app-server was sent, in order. */
  turnTexts(): string[] {
    return this.requests
      .filter((one) => one.method === 'turn/start')
      .map((one) => {
        const input = one.params['input'] as { text?: string }[] | undefined
        return input?.[0]?.text ?? ''
      })
  }
  asked(method: string): number {
    return this.requests.filter((one) => one.method === method).length
  }
}

/** A FakeRuntime that keeps its handles, and makes a Codex one compact on request (§2). */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    if (handle.ref.provider === 'codex') handle.compactsOnRequest()
    this.handles.push(handle)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const THE_WARNING_OPENS = 'Heads up: Long threads'

interface Harness {
  host: RuntimeHost
  store: SessionStore
  window: RecordingSink
  root: string
  ledger: (sessionId: string) => TranscriptEvent[]
}

/** ⚑ One app: its own store and folders, and the runtime a test chooses for each provider. */
function anApp(
  createRuntime: (provider: Provider) => AgentRuntime,
  cleanup: (() => Promise<void> | void)[],
): Harness {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-713-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-713-root-'))
  const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const store = createSessionStore(db)
  let counter = 0
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime,
    prepareProviderHome: (provider: Provider, profileId?: string) => {
      const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${String(++counter)}`,
    commandListWaitMs: 60,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
  cleanup.push(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })
  return {
    host,
    store,
    window: new RecordingSink(sinkOwnerId({ id: 1 })),
    root,
    ledger: (sessionId) => store.events(sessionId).map((entry) => entry.event),
  }
}

const userTurns = (events: TranscriptEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

const compactionsIn = (events: TranscriptEvent[]) =>
  events.filter(
    (event): event is Extract<TranscriptEvent, { type: 'compaction' }> =>
      event.type === 'compaction',
  )

const turnsEnded = (events: TranscriptEvent[], state: string): number =>
  events.filter((event) => event.type === 'turn' && event.state === state).length

const callOn = async (
  toolset: AgentToolset,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return (await tool.call(args)).structured as Record<string, unknown>
}

describe('713 §1 · R59 — the host, over the REAL Codex adapter', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let app: Harness
  let transports: ScriptedCodex[]
  let claudes: FakeSessionHandle[]

  beforeEach(() => {
    transports = []
    claudes = []
    const sessions = new FakeProviderSessions()
    app = anApp((provider) => {
      if (provider === 'claude') return new ProviderDouble('claude', claudes, sessions)
      return new CodexRuntime((context: CodexLaunchContext) => {
        const transport = new ScriptedCodex(context.providerHome)
        transports.push(transport)
        return transport
      })
    }, cleanup)
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  /** A person opens a Codex conversation; its transport is the newest one. */
  const aPersonOpensCodex = async (): Promise<{ id: string; codex: ScriptedCodex }> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const codex = transports.at(-1)
    if (codex === undefined) throw new Error('no Codex transport')
    return { id: sessionId, codex }
  }

  it('🔴 a person’s `/compact` runs Codex’s compaction — never a turn of words — and the transcript shows it', async () => {
    const { id, codex } = await aPersonOpensCodex()
    await app.host.send(id, '/compact', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'the compaction to end')

    // ⛔ The words reached no model: nothing went out on `turn/start` at all.
    expect(codex.turnTexts()).toEqual([])
    // ⚑ Codex's own request did, once, for this thread.
    expect(codex.requests.filter((one) => one.method === 'thread/compact/start')).toEqual([
      { method: 'thread/compact/start', params: { threadId: 'th_1' } },
    ])
    // ⚑ The transcript: the person's `/compact`, as they typed it, then the compaction row —
    // `manual`, the word Claude's own `/compact` boundary carries.
    const events = app.ledger(id)
    expect(userTurns(events)).toEqual(['/compact'])
    expect(compactionsIn(events)).toEqual([
      {
        type: 'compaction',
        compactionId: 'cc_tc_1',
        trigger: 'manual',
        source: 'contextCompaction',
      },
    ])
    const order = events.map((event) => event.type)
    expect(order.indexOf('user_turn')).toBeLessThan(order.indexOf('compaction'))
    // ⚠️ …and Codex's own warning, which it sends with every compaction — drawn as the non-fatal
    // notice every Codex warning is (065), because it is the provider's word and not ours to drop.
    expect(
      events.some(
        (event) =>
          event.type === 'error' && !event.fatal && event.message.includes(THE_WARNING_OPENS),
      ),
    ).toBe(true)
  })

  it('⚑ the control: a person’s ordinary message on Codex is still words, framed', async () => {
    const { id, codex } = await aPersonOpensCodex()
    await app.host.send(id, 'compact this for me please', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'the turn to end')
    expect(codex.asked('thread/compact/start')).toBe(0)
    const [heard] = codex.turnTexts()
    expect(heard?.startsWith(A_PERSON_SENT_IT), heard).toBe(true)
    expect(
      withoutWhatThisAppAdds(heard ?? '').endsWith('\n\ncompact this for me please'),
      heard,
    ).toBe(true)
  })

  it('⛔ the control: an AGENT’s `/compact` to a Codex worker is framed words — an agent compacts nobody', async () => {
    const workerProfile = 'worker-713'
    // ⚑ An identity whose OWN provider is Codex — what a spawn launches it on.
    app.store.createAgentIdentity(
      { slug: workerProfile, displayName: null, provider: 'codex' },
      { by: 'a-person' },
    )
    // ⚠️ `ask`: a parent in `auto` may not start a Codex child, whose `auto` would also drop the
    // sandbox (`wider-than-its-parent`) — so the worker runs the prompting profile it inherits.
    const { sessionId: pm } = await app.host.createSession(
      { provider: 'claude', profileId: 'pm-713', approvalMode: 'ask', cwd: app.root },
      app.window,
    )
    // ⚑ D-014 · the default grants start any agent this app holds and give it work.
    // ⚑ **D-016** — the give starts the worker, and its brief — the agent's `/compact` — is the
    // worker's first turn.
    const tools = agentToolsFor(app.host, pm)
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work 713 is about',
      brief: '/compact',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const codex = transports.at(-1)
    if (codex === undefined) throw new Error('no worker transport')
    await waitFor(
      () => codex.turnTexts().some((text) => text.includes('/compact')),
      'the agent’s words to reach Codex',
    )
    await waitFor(() => turnsEnded(app.ledger(worker), 'completed') >= 1, 'the agent’s turn to end')
    expect(codex.asked('thread/compact/start')).toBe(0)
    const heard = codex.turnTexts().find((text) => text.includes('/compact')) ?? ''
    // ⚑ D-011 — named, with its conversation's address in the direction line: ⚑ D-016 · commit 7 ·
    // R3 — the piece the pm owns, composed from the product's own parts.
    const pmNamed = app.store.workThatNames(pm)
    if (pmNamed === null) throw new Error('the pm holds no piece, so no piece addresses it')
    // ⚑ W4.178 · the agent's `/compact` is the brief of a give: a brief says nothing of a note.
    const answering = theDirectionLine(
      `${agentName('pm-713', app.store.agentIdentities())}, ${theOwnerOf(pmNamed)}`,
      'caller',
      true,
    )
    expect(heard.startsWith('Sent by ') && heard.includes(answering), heard).toBe(true)
    expect(heard).toContain('/compact')
    expect(heard).not.toBe('/compact')
  })

  it('⛔ `/compact <instructions>` is refused at the door, in words — nothing is sent and nothing is dropped', async () => {
    const { id, codex } = await aPersonOpensCodex()
    const before = codex.requests.length
    await expect(app.host.send(id, '/compact keep the test plan', app.window)).rejects.toThrow(
      aCompactionTakesNoInstructions('codex'),
    )
    expect(aCompactionTakesNoInstructions('codex')).toBe(
      'Codex compacts without instructions, so they would be dropped — send /compact on its own ' +
        'to compact now. Nothing has been sent.',
    )
    // ⛔ Not a request of EITHER kind: not the compaction without them, not the words to the model.
    expect(codex.requests.slice(before).map((one) => one.method)).toEqual([])
    expect(userTurns(app.ledger(id))).toEqual([])
  })
})

describe('713 §2 · R59 at every door, on a double that compacts on request', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let app: Harness
  let handles: FakeSessionHandle[]

  beforeEach(() => {
    handles = []
    const sessions = new FakeProviderSessions()
    app = anApp((provider) => new ProviderDouble(provider, handles, sessions), cleanup)
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  /** What the provider heard as WORDS — the double's echo. */
  const heardAsWords = (sessionId: string): string[] =>
    app
      .ledger(sessionId)
      .flatMap((event) =>
        event.type === 'assistant_message' ? [event.text.replace(/^echo: /, '')] : [],
      )

  /** A conversation whose first turn is held on its card — something running to wait behind. */
  const busyCodex = async (): Promise<{ id: string; handle: FakeSessionHandle }> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: app.root },
      app.window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no double')
    await app.host.send(sessionId, 'first', app.window)
    await waitFor(
      () => app.ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the first turn to hold on its card',
    )
    return { id: sessionId, handle }
  }

  const attachment = async (): Promise<HandedPath> => {
    const path = join(app.root, 'notes.md')
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, app.root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  const aPendingCard = (sessionId: string): string => {
    const card = app
      .ledger(sessionId)
      .flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))
      .at(-1)
    if (card === undefined) throw new Error('no card')
    return card
  }

  it('🔴 a held `/compact` compacts when its turn comes — the flush reaches the same door', async () => {
    const { id, handle } = await busyCodex()
    const outcome = await app.host.queueMessage(id, '/compact', app.window)
    expect(outcome.outcome).toBe('queued')
    expect(handle.compactions).toBe(0)
    await app.host.respondPermission(id, aPendingCard(id), { outcome: 'allow' }, app.window)
    await waitFor(() => handle.compactions === 1, 'the held /compact to compact')
    // ⛔ …and it never went to the model as words.
    expect(heardAsWords(id).some((words) => words.includes('/compact'))).toBe(false)
  })

  it('🔴 interrupt-and-send `/compact` stops the turn, then compacts', async () => {
    const { id, handle } = await busyCodex()
    await app.host.sendInterrupting(id, '/compact', app.window)
    await waitFor(() => handle.compactions === 1, 'the replacement to compact')
    expect(turnsEnded(app.ledger(id), 'interrupted')).toBe(1)
    expect(heardAsWords(id).some((words) => words.includes('/compact'))).toBe(false)
  })

  it('⛔ with a file it is refused at EVERY door, before anything moves — `R42`’s sentence, one command over', async () => {
    const { id, handle } = await busyCodex()
    const file = await attachment()
    const sentence = aCommandTakesNoAttachments('/compact', true)
    await expect(app.host.send(id, '/compact', app.window, [file])).rejects.toThrow(sentence)
    await expect(app.host.queueMessage(id, '/compact', app.window, [file])).rejects.toThrow(
      sentence,
    )
    await expect(app.host.sendInterrupting(id, '/compact', app.window, [file])).rejects.toThrow(
      sentence,
    )
    // ⛔ Refused BEFORE the stop: the turn it would have replaced is still waiting on its card.
    expect(turnsEnded(app.ledger(id), 'interrupted')).toBe(0)
    expect(handle.compactions).toBe(0)
  })

  it('⛔ with instructions it is refused at every door too — before the stop, and before the hold', async () => {
    const { id, handle } = await busyCodex()
    const sentence = aCompactionTakesNoInstructions('codex')
    await expect(app.host.queueMessage(id, '/compact keep it short', app.window)).rejects.toThrow(
      sentence,
    )
    await expect(
      app.host.sendInterrupting(id, '/compact keep it short', app.window),
    ).rejects.toThrow(sentence)
    expect(turnsEnded(app.ledger(id), 'interrupted')).toBe(0)
    expect(handle.compactions).toBe(0)
  })

  it('⚑ the control: on Claude — no such door — `/compact` and its instructions go as typed (`R42`, `R58`)', async () => {
    const { sessionId: id } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const claude = handles.at(-1)
    expect(claude?.compact, 'Claude compacts on its own /compact').toBeUndefined()
    await app.host.send(id, '/compact keep the test plan', app.window)
    await waitFor(() => heardAsWords(id).length === 1, 'the CLI to hear it')
    expect(heardAsWords(id)).toEqual(['/compact keep the test plan'])
  })
})

describe('713 §3 · R60 — "Compact now…" has a road on both providers', () => {
  it('⚑ both declare it `available`, and each note names its own road', () => {
    const claude = capabilitiesFor('claude').requestCompaction
    const codex = capabilitiesFor('codex').requestCompaction
    if (claude.state !== 'available' || codex.state !== 'available') {
      throw new Error(`both compact now: ${claude.state} / ${codex.state}`)
    }
    // ⚑ The two roads differ, and the notes are what say how — the Dropped tab draws them.
    expect(claude.note).toContain('/compact')
    expect(claude.note).toContain('exactly as you type it')
    expect(codex.note).toContain('Codex’s own compaction request')
    expect(codex.note).toContain('no instructions')
  })

  it('⛔ "a person’s /compact" is the whole road — an agent’s and the app’s own words are not one', () => {
    const person = THE_PERSON_AT_A_WINDOW
    expect(aPersonsCompaction('/compact', person)).toEqual({ word: '/compact', instructions: null })
    expect(aPersonsCompaction('  /compact  focus on tests ', person)).toEqual({
      word: '/compact',
      instructions: 'focus on tests',
    })
    expect(aPersonsCompaction('/compact', null)).toBeNull()
    // ⛔ …and an AGENT's — even one a person stands behind, which is the arm that most looks like one.
    const anAgent: TurnOrigin = {
      who: 'a-caller-with-an-id',
      caller: 'sess_pm',
      profile: 'pm',
      aPersonIsBehindIt: true,
    }
    expect(aPersonsCompaction('/compact', anAgent)).toBeNull()
    expect(aPersonsCompaction('/compactor', person)).toBeNull()
    expect(aPersonsCompaction('please /compact', person)).toBeNull()
  })
})
