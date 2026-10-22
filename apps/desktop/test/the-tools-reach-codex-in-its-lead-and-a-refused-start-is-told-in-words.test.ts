import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  CodexRuntime,
  FakeProviderSessions,
  FakeRuntime,
  ResumeError,
  StartFailed,
  StartRefused,
  createSpawnTransportFactory,
  spawnNoWaitClearsOf,
  startFailureOf,
  startRefusalOf,
  type AgentRuntime,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { CODEX_NAMESPACE_DESCRIPTION_LIMIT } from '../../../packages/runtime/src/codex/agent-tools'
import {
  CodexExited,
  CodexRequestRefused,
} from '../../../packages/runtime/src/codex/codex-transport'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  A_CODEX_THREAD,
  aCodexThatRefuses,
  type ResumeRefusal,
} from '../../../packages/runtime/test/fixtures/a-codex-that-refuses'
import {
  completedTurn,
  failedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { THE_MODEL_LIST } from './lib/scripted-codex-host'
import {
  profileBundleSpans,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import * as tools from '../src/main/runtime/agent-tools'
import {
  AGENT_TOOL_INSTRUCTIONS,
  AGENT_TOOL_SERVER,
  agentToolsFor,
  toolsToldInTextFor,
} from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { A_PERSON_SENT_IT } from '../src/main/runtime/turn-origin'
import { toldView } from '../src/renderer/src/lib/told'
import { whoseGroups } from '../src/renderer/src/lib/whose-groups'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import type {
  RuntimeEventMessage,
  SessionInstructions,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble as GatedDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **D-039 · the tools reach a Codex model in its lead, the namespace stays under the app-server's
 * cap, and a provider that refuses to start a conversation is told in words.**
 *
 * ## ⛔ The defect (F055), and what D-039 did
 *
 * Codex's app-server refuses a `thread/start` whose tool namespace has a description over 1,024
 * characters, and the app's tools' instructions had grown to 1,100 — so no Codex conversation could
 * start, and the person and the giver read the protocol's JSON envelope. D-039 declares the namespace
 * with ONE fixed sentence, sends the full instructions as the first section of a Codex life's
 * first-turn lead (and owes it again after a compaction or a turn this app ended as failed), and tells
 * a start its provider refused (`StartRefused`) or that failed otherwise (`StartFailed`) in words, at
 * every door.
 *
 * ## ⚑ What each group below pins, and why it was open
 *
 *  - **§1 · the wire**: what Codex is handed on `thread/start`, read off a REAL `CodexRuntime` over a
 *    scripted app-server. The existing test compares the namespace to the constant it is built from,
 *    so a constant grown past the cap would pass it.
 *  - **§2 · the composition**: which provider is told the instructions in text, the section it makes,
 *    and where the sheet files it.
 *  - **§3 · the lead**: the product's own reader composes it, the first turn carries it once, and a
 *    compaction or a turn this app failed owes it again. No test read the lead after its first turn.
 *  - **§4 · the two types**: what a refusal says of itself, and how each is found on a cause chain.
 *  - **§5 · the adapter**: which launch failure becomes which type, over the scripted app-server and
 *    over the product's own transport and a child that refuses.
 *  - **§6 to §8 · every door**: a giver's give, a wake, a reply, and a person's start, message and
 *    reopen, each saying what failed in its own words and never in the provider's envelope.
 *
 * This scripted app-server cannot establish whether a hosted Codex obeys the sent text. It
 * matches adapter input shapes and the fixture child answers the handshake as 0.146.0 does.
 * Every directory is temporary, with no Electron, port, or personal userData.
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
 * ⚑ **What the scripted app-server does next**, shared by every transport an app makes so a test can
 * move one fact between two launches.
 */
interface Script {
  /** A request of this method is refused, as the app-server refuses one: `-32600` and words. */
  refuse: { method: string; message: string } | null
  /** How many of the next `turn/start` requests the app-server refuses outright. */
  rejectTurnStarts: number
  /** The provider begins a turn and then FAILS it (`turn/completed failed`). */
  providerFailsTurns: boolean
  /** The version the handshake reports instead of the vendored one. */
  driftVersion: string | null
  /** The `codexHome` the handshake echoes instead of the one it was handed. */
  echoHome: string | null
  /** `initialize` fails with this. */
  initializeFails: (() => Error) | null
}

const aScript = (): Script => ({
  refuse: null,
  rejectTurnStarts: 0,
  providerFailsTurns: false,
  driftVersion: null,
  echoHome: null,
  initializeFails: null,
})

/**
 * ⚑ **The app-server, scripted from what the adapter reads** — the compaction file's, with the
 * failures this file needs. Every request is kept, so a test reads what the adapter ASKED.
 */
class ScriptedCodex implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  closedAt = 0
  constructor(
    readonly home: string,
    private readonly script: Script,
  ) {}
  request(method: string, params?: unknown): Promise<unknown> {
    const given = (params ?? {}) as Record<string, unknown>
    this.requests.push({ method, params: given })
    if (method === 'initialize' && this.script.initializeFails !== null) {
      return Promise.reject(this.script.initializeFails())
    }
    if (this.script.refuse?.method === method) {
      return Promise.reject(
        new CodexRequestRefused(method, { code: -32600, message: this.script.refuse.message }),
      )
    }
    // ⚑ **D-042 · R1 — a Codex launch that names no model reads `model/list` and names the row it
    // marks default**, and F2 refuses a launch whose list names none — so this app-server answers
    // the shared scripted host's one-row list (its `isDefault` row, at its own default effort) where
    // it answered `{}` before D-042.
    if (method === 'model/list') return Promise.resolve(THE_MODEL_LIST)
    if (method === 'initialize') {
      const version = this.script.driftVersion ?? CODEX_PROTOCOL_VERSION
      return Promise.resolve({
        userAgent: `brobot2/${version} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.script.echoHome ?? this.home,
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
      if (this.script.rejectTurnStarts > 0) {
        this.script.rejectTurnStarts--
        return Promise.reject(new Error('the app-server could not begin the turn'))
      }
      const id = `tn_${String(++this.turns)}`
      setTimeout(
        () => (this.script.providerFailsTurns ? this.aFailedTurn(id) : this.anOrdinaryTurn(id)),
        0,
      )
      return Promise.resolve(turnStartResponse(id))
    }
    if (method === 'thread/compact/start') {
      const id = `tc_${String(++this.turns)}`
      setTimeout(() => this.aCompaction(id), 0)
      return Promise.resolve({})
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
  /** ⚑ The provider BEGAN the turn and then failed it — its word, not this app's. */
  private aFailedTurn(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    this.push('turn/completed', turnCompletedNotification('th_1', failedTurn(id)))
  }
  private aCompaction(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    const item = { type: 'contextCompaction', id: `cc_${id}` }
    this.push('item/started', { threadId: 'th_1', turnId: id, item, startedAtMs: 1 })
    this.push('item/completed', { threadId: 'th_1', turnId: id, item, completedAtMs: 2 })
    this.push('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.closedAt++
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

/** A FakeRuntime that keeps its handles, so a test can read what a launch was handed. */
class KeptHandles extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

type HostOptions = ConstructorParameters<typeof RuntimeHost>[0]

interface Harness {
  host: RuntimeHost
  store: SessionStore
  window: RecordingSink
  root: string
  userData: string
  ledger: (sessionId: string) => TranscriptEvent[]
}

/** ⚑ One app: its own store and folders, and the runtime a test chooses for each provider. */
function anApp(
  createRuntime: (provider: Provider) => AgentRuntime,
  cleanup: (() => Promise<void> | void)[],
  more: Partial<HostOptions> = {},
): Harness {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-d039-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-d039-root-'))
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
    ...more,
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
    userData,
    ledger: (sessionId) => store.events(sessionId).map((entry) => entry.event),
  }
}

const userTurns = (events: TranscriptEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

/** The `turn` rows of a ledger, whole — their `wordOf` is what says whose word a failure is. */
const turnRows = (events: TranscriptEvent[]) =>
  events.flatMap((event) => (event.type === 'turn' ? [event] : []))

const OWED = 'OWED LEAD'

/** ⚑ A reader that owes every life one lead, as `main/index.ts`'s does and nothing else of it. */
const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}
const owesALead: HostOptions['readInstructions'] = () => ({
  instructions: NOTHING_INJECTED,
  systemHint: undefined,
  memoryLoaded: null,
  firstTurnLead: OWED,
})

/** A context with every field at its least interesting value, so a test moves exactly one thing. */
function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'ali',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: null,
    others: { shown: [], more: 0 },
    ...over,
  }
}

/** The one sentence the Codex namespace is declared with — typed out here, never imported. */
const THE_NAMESPACE_SENTENCE = 'Tools that reach the app you are running inside.'

/** The first sentence of the instructions' own clause that no namespace sentence may carry. */
const A_CLAUSE_OF_THE_INSTRUCTIONS = 'An agent is named by the piece of work it owns'

// ─────────────────────────────────────────────────────────────────────────────
// §1 · what Codex is handed on thread/start
// ─────────────────────────────────────────────────────────────────────────────

describe('§1 · the namespace Codex is handed', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let app: Harness
  let transports: ScriptedCodex[]
  let script: Script

  beforeEach(() => {
    transports = []
    script = aScript()
    app = anApp(
      () =>
        new CodexRuntime((launch: CodexLaunchContext) => {
          const transport = new ScriptedCodex(launch.providerHome, script)
          transports.push(transport)
          return transport
        }),
      cleanup,
    )
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  it('the namespace Codex is handed on thread/start is one fixed sentence under the app-server’s cap, never the instructions', async () => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const started = transports.at(-1)?.requests.find((one) => one.method === 'thread/start')
    expect(started, 'the adapter never asked the app-server to start a thread').toBeDefined()
    const dynamic = started?.params['dynamicTools'] as
      { type: string; name: string; description: string; tools: unknown[] }[] | undefined
    // ⚑ The premise: exactly one namespace, named for the server, holding tools — so what is read
    // below is the declaration and not an absence of one.
    expect(dynamic).toHaveLength(1)
    const [namespace] = dynamic ?? []
    expect(namespace).toMatchObject({ type: 'namespace', name: 'brobot' })
    expect(namespace?.tools.length).toBeGreaterThan(0)

    // ⚑ The sentence is typed out here, and the cap is the app-server's own number.
    expect(namespace?.description).toBe(THE_NAMESPACE_SENTENCE)
    expect(CODEX_NAMESPACE_DESCRIPTION_LIMIT).toBe(1024)
    expect(namespace?.description.length).toBeLessThanOrEqual(CODEX_NAMESPACE_DESCRIPTION_LIMIT)
    // ⛔ …and it is not the instructions, which Codex would have refused. The clause asked for is one
    // the instructions really carry, so its absence from the description says something.
    expect(AGENT_TOOL_INSTRUCTIONS).toContain(A_CLAUSE_OF_THE_INSTRUCTIONS)
    expect(namespace?.description).not.toBe(AGENT_TOOL_INSTRUCTIONS)
    expect(namespace?.description).not.toContain(A_CLAUSE_OF_THE_INSTRUCTIONS)

    // ⚑ The conversation's own inventory row says the same sentence: what was declared is what is shown.
    await waitFor(
      () => app.ledger(sessionId).some((event) => event.type === 'tool_inventory'),
      'the tool inventory row',
    )
    const inventory = app.ledger(sessionId).find((event) => event.type === 'tool_inventory')
    expect(inventory?.type === 'tool_inventory' && inventory.declared?.instructions).toBe(
      THE_NAMESPACE_SENTENCE,
    )

    // ⚑ The paired positive, from the same launch: the toolset the conversation holds still carries the
    // full instructions Claude is handed with its catalogue — so "one sentence" is the Codex arm's
    // choice and not a toolset with nothing to say. (Informational only: they are 1,100 characters
    // today, over the cap, which is why they ride the lead.)
    const held = agentToolsFor(app.host, sessionId)
    expect(held.instructions).toBe(AGENT_TOOL_INSTRUCTIONS)
    expect(held.instructions?.length).toBeGreaterThan(THE_NAMESPACE_SENTENCE.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 · which provider is told the instructions in text, and the section it makes
// ─────────────────────────────────────────────────────────────────────────────

describe('§2 · the tools’ words as a section of this conversation’s text', () => {
  it('toolsToldInTextFor gives the instructions to Codex and nothing to Claude', () => {
    const codex = toolsToldInTextFor('codex')
    // ⚑ Codex is given a server name and non-empty words — a presence, not a shrug.
    expect(codex).toEqual({ server: AGENT_TOOL_SERVER, instructions: AGENT_TOOL_INSTRUCTIONS })
    expect(codex?.instructions.length).toBeGreaterThan(0)
    expect(AGENT_TOOL_SERVER).toBe('brobot')
    // ⛔ Claude is handed them with its catalogue, so a second reading would be told twice.
    expect(toolsToldInTextFor('claude')).toBeUndefined()
  })

  it('this conversation’s text opens with the tools section, as the factory’s, only when it is given tools', () => {
    const told = thisConversationSpans(context(), {
      server: 'brobot',
      instructions: 'THE TOOL WORDS',
    })
    expect(
      told.text.startsWith('## The brobot tools\n\nTHE TOOL WORDS\n\n## This conversation'),
    ).toBe(true)
    expect(told.spans[0]).toMatchObject({ whose: 'factory', heading: 'The brobot tools' })
    expect(told.spans[1]?.whose).toBe('dynamic')
    // ⚑ The spans tile the text: no byte is outside a section, and none is in two.
    expect(told.spans[0]?.start).toBe(0)
    expect(told.spans.map((one) => told.text.slice(one.start, one.end)).join('')).toBe(told.text)
    for (const [index, span] of told.spans.entries()) {
      if (index > 0) expect(span.start).toBe(told.spans[index - 1]?.end)
    }
    // ⚑ The heading follows the server's name.
    const other = thisConversationSpans(context(), { server: 'other', instructions: 'X' })
    expect(other.text.startsWith('## The other tools\n\nX\n\n')).toBe(true)

    // The control, one fact over: given no tools, there is no such section and the first is the
    // conversation's own.
    const alone = thisConversationSpans(context())
    expect(alone.text.startsWith('## This conversation')).toBe(true)
    expect(alone.text).not.toContain('The brobot tools')
    expect(alone.spans[0]?.whose).toBe('dynamic')
    expect(alone.spans.every((one) => one.heading !== 'The brobot tools')).toBe(true)
  })

  it('the sheet files the tools section under the factory’s text, and a launch with no tools has none', () => {
    const instructionsOf = (
      thisConversation: SessionInstructions['thisConversation'],
    ): SessionInstructions => ({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
      thisConversation,
    })
    const grouped = (said: SessionInstructions) =>
      whoseGroups(said, toldView(said, null, false).layers)
    const namesIn = (view: ReturnType<typeof grouped>, whose: string): (string | null)[] =>
      view.groups.find((group) => group.whose === whose)?.blocks.map((block) => block.heading) ?? []

    const withTools = grouped(
      instructionsOf(thisConversationSpans(context(), { server: 'brobot', instructions: 'X' })),
    )
    expect(namesIn(withTools, 'factory')).toContain('The brobot tools')
    // ⚑ …and only there: every other group is asked, so the block is in exactly one.
    for (const group of withTools.groups.filter((one) => one.whose !== 'factory')) {
      expect(
        group.blocks.some((block) => block.heading === 'The brobot tools'),
        `the tools section is also under ${group.whose}`,
      ).toBe(false)
    }
    // The dynamic layer still holds this conversation's own sections.
    expect(namesIn(withTools, 'dynamic')).toEqual(
      expect.arrayContaining(['This conversation', 'What you may do']),
    )

    // The control: the same view from a text composed with no tools has the block in no group.
    const without = grouped(instructionsOf(thisConversationSpans(context())))
    expect(namesIn(without, 'dynamic')).toContain('This conversation')
    for (const group of without.groups) {
      expect(group.blocks.some((block) => block.heading === 'The brobot tools')).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 · the lead a Codex life carries
// ─────────────────────────────────────────────────────────────────────────────

describe('§3 · the lead a Codex life carries', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let transports: ScriptedCodex[]
  let claudes: FakeSessionHandle[]
  let script: Script

  beforeEach(() => {
    transports = []
    claudes = []
    script = aScript()
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  /** ⚑ A Codex conversation on the scripted app-server, and a Claude one on the double. */
  const anAppWith = (more: Partial<HostOptions>): Harness => {
    const sessions = new FakeProviderSessions()
    return anApp(
      (provider) =>
        provider === 'claude'
          ? new KeptHandles('claude', claudes, sessions)
          : new CodexRuntime((launch: CodexLaunchContext) => {
              const transport = new ScriptedCodex(launch.providerHome, script)
              transports.push(transport)
              return transport
            }),
      cleanup,
      more,
    )
  }

  const aCodexConversation = async (
    app: Harness,
  ): Promise<{ id: string; codex: ScriptedCodex }> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const codex = transports.at(-1)
    if (codex === undefined) throw new Error('no Codex transport')
    return { id: sessionId, codex }
  }

  /** Sends one message and waits until the conversation has ended one more turn of any word. */
  const saying = async (app: Harness, id: string, words: string): Promise<void> => {
    const before = turnRows(app.ledger(id)).length
    await app.host.send(id, words, app.window)
    await waitFor(() => turnRows(app.ledger(id)).length === before + 1, `the turn for "${words}"`)
  }

  it('a Codex life’s first turn opens with the tools words from the product’s own composition, once; a Claude life is never told them in text', async () => {
    const home = mkdtempSync(join(tmpdir(), 'brobot2-d039-home-'))
    cleanup.push(() => rmSync(home, { recursive: true, force: true }))
    // ⚑ **A copy of `main/index.ts`'s call**, with the composition root's own decision about the tools:
    // the profile's text alone is published, this conversation's rides the launch.
    const app = anAppWith({
      readInstructions: (provider, cwd, providerHome, ctx) => {
        const composed = profileBundleSpans(ctx)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(ctx, toolsToldInTextFor(provider)),
          home,
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
        }
      },
    })
    const { id, codex } = await aCodexConversation(app)
    await saying(app, id, 'hello')
    await saying(app, id, 'again')

    const [first, second] = codex.turnTexts()
    expect(codex.turnTexts()).toHaveLength(2)
    const tools = `## The brobot tools\n\n${AGENT_TOOL_INSTRUCTIONS}`
    expect(first).toContain(tools)
    // ⚑ In front of this conversation's own facts, then the person's frame, then their words.
    const at = (needle: string): number => first?.indexOf(needle) ?? -1
    expect(at(tools)).toBeGreaterThanOrEqual(0)
    expect(at('## This conversation')).toBeGreaterThan(at(tools))
    expect(at(A_PERSON_SENT_IT)).toBeGreaterThan(at('## This conversation'))
    expect(withoutWhatThisAppAdds(first ?? '').endsWith('hello')).toBe(true)
    // …and once: the second message carries none of it.
    expect(second).not.toContain('The brobot tools')
    expect(second?.startsWith(A_PERSON_SENT_IT)).toBe(true)
    // ⚑ The ledger never carries the lead: the person's words are what they typed.
    expect(userTurns(app.ledger(id))).toEqual(['hello', 'again'])

    // The control, one fact over: Claude, through the same reader. It composed this conversation's
    // text — it is in the system prompt — and the tools' words are not in it, because its catalogue
    // carries them.
    const claude = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    expect(claude.sessionId).not.toBe(id)
    const hint = claudes.at(-1)?.systemHint
    expect(hint).toContain('## This conversation')
    expect(hint).not.toContain('## The brobot tools')
    expect(hint).not.toContain(AGENT_TOOL_INSTRUCTIONS)
  })

  it('a compaction owes a Codex life its lead again; a life that was never compacted does not', async () => {
    const app = anAppWith({ readInstructions: owesALead })
    // ⚑ Conversation A: never compacted.
    const a = await aCodexConversation(app)
    await saying(app, a.id, 'hello')
    await saying(app, a.id, 'again')
    const [aFirst, aSecond] = a.codex.turnTexts()
    expect(aFirst?.startsWith(OWED)).toBe(true)
    expect(aSecond).not.toContain(OWED)

    // ⚑ Conversation B: a person's `/compact` between the two.
    const b = await aCodexConversation(app)
    expect(b.id).not.toBe(a.id)
    await saying(app, b.id, 'hello')
    await saying(app, b.id, '/compact')
    expect(app.ledger(b.id).some((event) => event.type === 'compaction')).toBe(true)
    await saying(app, b.id, 'again')

    const texts = b.codex.turnTexts()
    // The compaction went out on its own request and never as words, so two turns were sent.
    expect(b.codex.asked('thread/compact/start')).toBe(1)
    expect(texts).toHaveLength(2)
    expect(texts[0]?.startsWith(OWED)).toBe(true)
    // ⛔ The history the lead rode in was rewritten: the next ordinary turn carries it again.
    expect(texts[1]?.startsWith(`${OWED}\n\n`)).toBe(true)
    expect(withoutWhatThisAppAdds(texts[1] ?? '').endsWith('again')).toBe(true)
  })

  it('a turn this app failed (the provider never began it) owes the lead again; a turn the provider failed does not', async () => {
    const app = anAppWith({ readInstructions: owesALead })
    // ⚑ The first `turn/start` is refused: the adapter fails the turn and the word is this app's.
    script.rejectTurnStarts = 1
    const a = await aCodexConversation(app)
    await saying(app, a.id, 'hello')
    const failed = turnRows(app.ledger(a.id))
    expect(failed).toMatchObject([{ type: 'turn', state: 'failed', wordOf: 'this-app' }])
    await saying(app, a.id, 'again')

    const [first, second] = a.codex.turnTexts()
    expect(first?.startsWith(`${OWED}\n\n`)).toBe(true)
    // ⚑ The lead went to a provider that never began the turn, so the next one owes it.
    expect(second?.startsWith(`${OWED}\n\n`)).toBe(true)
    expect(withoutWhatThisAppAdds(second ?? '').endsWith('again')).toBe(true)

    // The control, one fact over: the provider BEGAN the turn and then failed it. That is its word and
    // the model took the lead with it, so nothing is owed again.
    script.providerFailsTurns = true
    const b = await aCodexConversation(app)
    await saying(app, b.id, 'hello')
    const theirs = turnRows(app.ledger(b.id))
    expect(theirs).toHaveLength(1)
    expect(theirs[0]?.state).toBe('failed')
    expect(theirs[0]?.wordOf).toBeUndefined()
    await saying(app, b.id, 'again')
    const [bFirst, bSecond] = b.codex.turnTexts()
    expect(bFirst?.startsWith(OWED)).toBe(true)
    expect(bSecond).not.toContain(OWED)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 · the two types, and how they are found
// ─────────────────────────────────────────────────────────────────────────────

describe('§4 · StartRefused and StartFailed', () => {
  const refusedWith = (words: string | null): StartRefused =>
    new StartRefused('codex', 'thread/start', words, { cause: new Error('x') })

  it('StartRefused.said is the first line of the provider’s reason, ids cut, bounded, null when it gave none; the whole text stays in the message', () => {
    // The control for every cut: a short one-line reason with no id is returned unchanged.
    expect(
      refusedWith('dynamic tool namespace description must be at most 1024 characters').said,
    ).toBe('dynamic tool namespace description must be at most 1024 characters')
    // The first non-blank line, so a leading blank line is skipped and later lines are dropped.
    const several = refusedWith('\n  \nthe first line\nthe second line\nthe third')
    expect(several.said).toBe('the first line')
    // A UUID is cut to an ellipsis, wherever it stands in the line.
    const thread = '01a0d52b-4ac7-7060-9f71-9ad6fd1088dc'
    expect(
      refusedWith(`failed to load thread history for thread ${thread}: Too many open files`).said,
    ).toBe('failed to load thread history for thread …: Too many open files')
    // The bound is 300 characters: exactly 300 is unchanged, 301 is cut to 299 and an ellipsis.
    const exact = 'a'.repeat(300)
    expect(refusedWith(exact).said).toBe(exact)
    const over = refusedWith('a'.repeat(301)).said
    expect(over).toHaveLength(300)
    expect(over?.endsWith('…')).toBe(true)
    expect(over?.slice(0, 299)).toBe('a'.repeat(299))
    // A provider that gave nothing gave nothing, however it gave it.
    for (const none of [null, '', '\n  \n']) expect(refusedWith(none).said).toBeNull()

    // ⚑ The message is the log's, whole: the id and the later lines are in it.
    const whole = refusedWith(`first ${thread}\nsecond line`)
    expect(whole.said).toBe('first …')
    expect(whole.message).toBe(`codex refused thread/start: first ${thread}\nsecond line`)
    expect(refusedWith(null).message).toBe('codex refused thread/start: it gave no reason')
  })

  it('startRefusalOf and startFailureOf find their type anywhere on a cause chain, and never the other’s', () => {
    const ref = { provider: 'codex' as const, sessionId: 't', cwd: '/x', rotation: 0 }
    const refused = refusedWith('no')
    const failed = new StartFailed('the child exited')
    const wrapped = (inner: Error): Error =>
      new Error('wrapper', { cause: new ResumeError(ref, 'resume failed', { cause: inner }) })

    // The control: read directly, at depth 0, each finds the same object.
    expect(startRefusalOf(refused)).toBe(refused)
    expect(startFailureOf(failed)).toBe(failed)
    // Wrapped twice over, each is still found.
    expect(startRefusalOf(wrapped(refused))).toBe(refused)
    expect(startFailureOf(wrapped(failed))).toBe(failed)
    // …and never the other's.
    expect(startFailureOf(wrapped(refused))).toBeNull()
    expect(startRefusalOf(wrapped(failed))).toBeNull()
    // A chain with neither, and a chain that loops, find nothing and end.
    expect(startRefusalOf(wrapped(new Error('plain')))).toBeNull()
    expect(startFailureOf(wrapped(new Error('plain')))).toBeNull()
    const loop = new Error('loop')
    ;(loop as { cause?: unknown }).cause = loop
    expect(startRefusalOf(loop)).toBeNull()
    expect(startFailureOf(loop)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5 · the adapter: which launch failure becomes which type
// ─────────────────────────────────────────────────────────────────────────────

describe('§5 · Codex’s own launch failures, as the app reads them', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-d039-adapter-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    return dir
  }

  describe('over the host, on a scripted app-server', () => {
    let app: Harness
    let transports: ScriptedCodex[]
    let script: Script

    beforeEach(() => {
      transports = []
      script = aScript()
      app = anApp(
        () =>
          new CodexRuntime((launch: CodexLaunchContext) => {
            const transport = new ScriptedCodex(launch.providerHome, script)
            transports.push(transport)
            return transport
          }),
        cleanup,
      )
    })

    const THREAD = '01a0d52b-4ac7-7060-9f71-9ad6fd1088dc'
    const SAID_AT_START = 'dynamic tool namespace description must be at most 1024 characters'
    const SAID_AT_RESUME = `failed to load thread history for thread ${THREAD}: Too many open files (os error 24)`
    const openCodex = () =>
      app.host.createSession({ provider: 'codex', approvalMode: 'auto', cwd: app.root }, app.window)

    it('Codex refusing thread/start (F055) reaches a person as the refusal in words, not as the JSON-RPC envelope; a resume refused for another reason reads as a reopen', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      script.refuse = { method: 'thread/start', message: SAID_AT_START }
      const thrown = await openCodex().then(
        () => new Error('createSession RESOLVED'),
        (error: unknown) => error as Error,
      )
      expect(thrown.message).toBe(
        `This conversation did not open: its provider refused to start it, saying “${SAID_AT_START}”. No conversation was made, and starting it again will be refused the same way until what its provider refused is changed.`,
      )
      // ⛔ Never the protocol's envelope.
      expect(thrown.message).not.toContain('-32600')
      expect(thrown.message).not.toContain('{"code"')
      // ⚑ The refusal is the cause, by type, with the provider's own sentence.
      expect(startRefusalOf(thrown)?.said).toBe(SAID_AT_START)
      // Nothing was made, and the app-server that refused was shut down.
      expect(app.host.sessionIds).toEqual([])
      expect(transports.at(-1)?.closedAt).toBeGreaterThan(0)

      // The control: with the refusal cleared the same call opens, so the refusal was the provider's.
      script.refuse = null
      const { sessionId } = await openCodex()
      expect(app.host.sessionIds).toEqual([sessionId])

      // …and the reopen, one door over: stop it, then have the provider refuse the resume.
      await app.host.close(sessionId, app.window)
      script.refuse = { method: 'thread/resume', message: SAID_AT_RESUME }
      const reopened = await app.host.resumeSession(sessionId, app.window).then(
        () => new Error('resumeSession RESOLVED'),
        (error: unknown) => error as Error,
      )
      expect(reopened.message).toBe(
        'This conversation did not continue: its provider refused to start it again, saying “failed to load thread history for thread …: Too many open files (os error 24)”. The conversation is kept, and its provider will refuse it the same way until what it refused is changed.',
      )
      expect(reopened.message).not.toContain(THREAD)
      expect(reopened.message).not.toContain('-32600')
      // The control: the same reopen works once the provider stops refusing.
      script.refuse = null
      await app.host.resumeSession(sessionId, app.window)
      expect(app.host.sessionIds).toEqual([sessionId])
    })
  })

  describe('over the product’s own transport, against a child that refuses', () => {
    /** ⚑ The product's Codex resume, over the product's factory, against a `codex` playing `scenario`. */
    const codexResume = async (scenario: ResumeRefusal): Promise<unknown> => {
      const root = scratch()
      const home = join(root, 'home')
      const cwd = join(root, 'cwd')
      mkdirSync(home, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const codex = aCodexThatRefuses(join(root, 'bin'), scenario, CODEX_PROTOCOL_VERSION, cwd)
      return new CodexRuntime(createSpawnTransportFactory(codex))
        .resume(
          { provider: 'codex', sessionId: A_CODEX_THREAD, cwd, rotation: 0 },
          { providerHome: home },
        )
        .then(
          async (handle) => {
            await handle.close()
            return handle
          },
          (error: unknown) => error,
        )
    }

    it('Codex refusing thread/resume for any reason but a lost thread is the provider refusing; a lost thread keeps its raw refusal; a dying app-server is StartFailed', async () => {
      // ⚑ A refusal for a reason that is not "it is gone": the provider refused to start it again.
      const refused = await codexResume('other-refusal')
      expect(refused).toBeInstanceOf(ResumeError)
      expect((refused as ResumeError).noSuchSession).toBe(false)
      expect(startRefusalOf(refused)?.said).toBe(
        'failed to load thread history for thread …: Too many open files (os error 24)',
      )
      expect(startFailureOf(refused)).toBeNull()

      // ⚑ The app-server's process ended before it answered: the start failed, and says it for the log.
      const died = await codexResume('died')
      expect(died).toBeInstanceOf(ResumeError)
      expect(startFailureOf(died)).not.toBeNull()
      expect(startFailureOf(died)?.message.startsWith('codex app-server exited')).toBe(true)
      expect(startRefusalOf(died)).toBeNull()

      // The paired positives: a thread it no longer has is neither type and keeps the raw refusal,
      // marked gone, so the host replaces the conversation …
      const lost = await codexResume('no-rollout')
      expect(lost).toBeInstanceOf(ResumeError)
      expect(startRefusalOf(lost)).toBeNull()
      expect(startFailureOf(lost)).toBeNull()
      expect((lost as ResumeError).noSuchSession).toBe(true)
      expect(((lost as Error).cause as { method?: unknown }).method).toBe('thread/resume')
      // … and a child that has the thread resumes it.
      const answers = await codexResume('answers')
      expect(answers).not.toBeInstanceOf(Error)
      expect((answers as { ref?: { sessionId?: string } }).ref?.sessionId).toBe(A_CODEX_THREAD)
    })
  })

  describe('over a scripted transport, at start', () => {
    const startOn = async (script: Script): Promise<unknown> => {
      const home = scratch()
      const transports: ScriptedCodex[] = []
      const outcome = await new CodexRuntime((launch: CodexLaunchContext) => {
        const transport = new ScriptedCodex(launch.providerHome, script)
        transports.push(transport)
        return transport
      })
        .start({ cwd: home, providerHome: home, approvalMode: 'auto' })
        .then(
          async (handle) => {
            await handle.close()
            return handle
          },
          (error: unknown) => error,
        )
      return outcome
    }

    it('an app-server that exits, or a handshake the adapter rejects, is StartFailed; this app’s own close and a spawn’s errno are not', async () => {
      // ⚑ The app-server's process ended: StartFailed, with the exit's own words and the exit as cause.
      const exit = new CodexExited('codex app-server exited (stderr tail: boom)')
      const exited = await startOn({
        ...aScript(),
        initializeFails: () => exit,
      })
      expect(exited).toBeInstanceOf(StartFailed)
      expect((exited as Error).message).toBe('codex app-server exited (stderr tail: boom)')
      expect((exited as Error).cause).toBe(exit)
      expect(startRefusalOf(exited)).toBeNull()

      // ⚑ A version the vendored protocol is not: StartFailed, naming both.
      const drifted = await startOn({ ...aScript(), driftVersion: '9.9.9' })
      expect(drifted).toBeInstanceOf(StartFailed)
      expect((drifted as Error).message).toContain('9.9.9')
      expect((drifted as Error).message).toContain(CODEX_PROTOCOL_VERSION)
      expect(startRefusalOf(drifted)).toBeNull()

      // ⚑ A home the app-server did not adopt: StartFailed.
      const elsewhere = await startOn({ ...aScript(), echoHome: '/somewhere/else' })
      expect(elsewhere).toBeInstanceOf(StartFailed)
      expect((elsewhere as Error).message).toContain('did not adopt the profile home')
      expect(startRefusalOf(elsewhere)).toBeNull()

      // The paired positives. This app's own close of the transport is a plain Error: neither type …
      const closed = await startOn({
        ...aScript(),
        initializeFails: () => new Error('codex transport closed'),
      })
      expect(closed).toBeInstanceOf(Error)
      expect(startFailureOf(closed)).toBeNull()
      expect(startRefusalOf(closed)).toBeNull()
      // … a spawn's errno keeps its code for the readers that take it …
      const spawn = await startOn({
        ...aScript(),
        initializeFails: () =>
          Object.assign(new Error('codex app-server failed to spawn'), {
            cause: { code: 'ENOENT', syscall: 'spawn x' },
          }),
      })
      expect(startFailureOf(spawn)).toBeNull()
      expect(startRefusalOf(spawn)).toBeNull()
      expect(spawnNoWaitClearsOf(spawn)).toBe('ENOENT')
      // … and a conformant app-server starts a handle.
      const started = await startOn(aScript())
      expect(started).not.toBeInstanceOf(Error)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §6 to §8 · every door, over a provider that fails the way a provider says so
// ─────────────────────────────────────────────────────────────────────────────

const CANNOT_BE_STARTED = 'agent-could-not-be-started'
const COULD_NOT_BE_RESUMED = 'that-conversation-could-not-be-resumed'
const THREAD_ID = '01a0d52b-4ac7-7060-9f71-9ad6fd1088dc'

describe('§6 to §8 · what a failed start says at each door', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let gate: ResumeGate

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d039-doors-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d039-doors-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new GatedDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
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
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: tools.ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const aPmThatMaySpawn = async (): Promise<string> => {
    await host.close(await personOpens('worker'), window)
    return personOpens('pm')
  }

  const giveWork = (
    pm: string,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work',
      ...over,
    })

  const aWorkerThatStopped = async (pm: string): Promise<{ worker: string; label: string }> => {
    const given = await giveWork(pm, { title: 'The schema', brief: 'migrate the schema' })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => store.piecesOwnedBy(worker).some((piece) => piece.giver === pm),
      'the give to open a piece',
    )
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be over')
    return { worker, label: given.label as string }
  }

  const wakeByMessage = (
    pm: string,
    worker: string,
    label: string,
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })

  /**
   * A provider's refusal of a start, as the Codex adapter makes one: the protocol's own refusal, with
   * its JSON envelope, is the cause.
   */
  const refusedStart = (words: string | null): StartRefused =>
    new StartRefused('codex', 'thread/start', words, {
      cause: new CodexRequestRefused('thread/start', { code: -32600, message: words }),
    })

  /** A resume the provider refused, as the adapter wraps it. */
  const aResumeRefusedWith = (cause: Error): ResumeError =>
    new ResumeError(
      { provider: 'codex', sessionId: 'th_x', cwd: root, rotation: 0 },
      'resume failed: x',
      { cause },
    )

  // ───────────────────────────────────────────────────────────────────────────
  // §6 · give_work
  // ───────────────────────────────────────────────────────────────────────────

  describe('§6 · a giver’s give', () => {
    const SAID = 'dynamic tool namespace description must be at most 1024 characters'

    it('give_work answers a provider’s refusal with the permanent word, its own sentence and the provider’s reason in the detail', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => refusedStart(SAID)
      const refused = await giveWork(pm)
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: CANNOT_BE_STARTED,
        permanence: 'until-a-person-changes-it',
        retryable: false,
        remedy: null,
        detail: { profile: 'worker', because: 'its-provider-refused-it', providerSaid: SAID },
      })
      expect(refused.reason).toBe(tools.A_PROVIDER_REFUSED_THE_START)
      // ⛔ The word's own sentence names a program, which is false of this refusal …
      expect(tools.refuseTool(CANNOT_BE_STARTED as never).reason).toContain('program')
      expect(String(refused.reason)).not.toContain('program')
      // … and the provider's words are in the detail, never in a sentence a model reads, and never
      // the protocol's envelope — which the refusal's own cause does carry.
      expect((refusedStart(SAID).cause as Error).message).toContain('-32600')
      expect(String(refused.reason)).not.toContain(SAID)
      expect(JSON.stringify(refused)).not.toContain('-32600')

      // The control: a provider that gave no reason is the same word and sentence, with no key for it.
      gate.startFails = () => refusedStart(null)
      const silent = await giveWork(pm, { title: 'Another piece' })
      expect(silent).toMatchObject({ rail: CANNOT_BE_STARTED, retryable: false })
      expect(silent.reason).toBe(tools.A_PROVIDER_REFUSED_THE_START)
      expect(silent.detail).toEqual({ profile: 'worker', because: 'its-provider-refused-it' })
      // …and with the failure cleared the same give is made.
      gate.startFails = undefined
      const given = await giveWork(pm, { title: 'A third piece' })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
    })

    it('a give with new: true says the new agent was made all the same, and one without it says nothing of the kind', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => refusedStart(SAID)

      // ⚑ The control first: a give to an existing profile, without `new`, appends nothing.
      const plain = await giveWork(pm)
      expect(plain.reason).toBe(tools.A_PROVIDER_REFUSED_THE_START)
      expect(String(plain.reason)).not.toContain(tools.THE_NEW_AGENT_WAS_MADE)

      const asked = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'Index the ledger',
        brief: 'index it',
        new: true,
      }
      const refused = await giveWork(pm, asked)
      expect(refused).toMatchObject({ rail: CANNOT_BE_STARTED, retryable: false })
      expect(refused.reason).toBe(
        `${tools.A_PROVIDER_REFUSED_THE_START} ${tools.THE_NEW_AGENT_WAS_MADE}`,
      )
      // ⚑ It is true: the agent was made, so the same give again meets the profile it made.
      expect(store.agentIdentities().some((one) => one.slug === 'archivist')).toBe(true)
      const again = await giveWork(pm, asked)
      expect(again).toMatchObject({ outcome: 'refused', rail: 'that-profile-exists' })

      // ⚑ The sentence is said after whichever sentence the launch's failure has: a sign-in too.
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      const signedOut = await giveWork(pm, { ...asked, profile: 'scribe' })
      expect(signedOut.rail).toBe('agent-did-not-start')
      expect(String(signedOut.reason).endsWith(tools.THE_NEW_AGENT_WAS_MADE)).toBe(true)
      expect(store.agentIdentities().some((one) => one.slug === 'scribe')).toBe(true)
    })

    it('a start that failed otherwise is agent-did-not-start with a closed reason, and the diagnostic reaches only the log', async () => {
      const pm = await aPmThatMaySpawn()
      const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () =>
        new StartFailed('codex app-server exited (stderr tail: /Users/x/.codex boom)')
      const refused = await giveWork(pm)
      expect(refused).toMatchObject({ outcome: 'refused', rail: 'agent-did-not-start' })
      expect(refused.detail).toEqual({
        profile: 'worker',
        because: 'its-provider-could-not-be-started',
      })
      // ⛔ A model reads the payload: neither the child's output nor a path is in it …
      expect(JSON.stringify(refused)).not.toContain('stderr tail')
      expect(JSON.stringify(refused)).not.toContain('/Users/x')
      // ⚑ … and the log has the whole of it.
      expect(logged.mock.calls.some((call) => String(call[0]).includes('stderr tail'))).toBe(true)

      // The control: an error that is none of the typed failures is still a broken tool.
      gate.startFails = () => new Error('a plain failure')
      await expect(giveWork(pm, { title: 'Another piece' })).rejects.toThrow('a plain failure')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // §7 · a message that wakes a conversation, and a reply to one
  // ───────────────────────────────────────────────────────────────────────────

  describe('§7 · a wake and a reply', () => {
    const SAID = `failed to load thread history for thread ${THREAD_ID}: Too many open files (os error 24)`

    it('a message that wakes a conversation whose provider refuses to start it answers the wake’s permanent word with the provider’s reason', async () => {
      const pm = await aPmThatMaySpawn()
      const { worker, label } = await aWorkerThatStopped(pm)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const sessionsBefore = [...host.sessionIds]
      const piecesBefore = store.piecesOwnedBy(worker)

      gate.resumeFails = () => aResumeRefusedWith(refusedStart(SAID))
      const refused = await wakeByMessage(pm, worker, label)
      expect(refused).toMatchObject({
        rail: COULD_NOT_BE_RESUMED,
        retryable: false,
        detail: {
          agent: worker,
          because: 'its-provider-refused-it',
          providerSaid:
            'failed to load thread history for thread …: Too many open files (os error 24)',
        },
      })
      expect(refused.reason).toBe(tools.A_WAKE_ITS_PROVIDER_REFUSED)
      expect(refused.reason).not.toBe(tools.A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN)
      // ⛔ The conversation was not replaced: a provider that refuses is not one that lost it.
      expect(host.sessionIds).toEqual(sessionsBefore)
      expect(store.piecesOwnedBy(worker)).toEqual(piecesBefore)

      // The controls: a provider that failed with a plain cause is the generic word with no reason
      // of the provider's …
      gate.resumeFails = () => aResumeRefusedWith(new Error('the handshake died'))
      const generic = await wakeByMessage(pm, worker, label)
      expect(generic).toMatchObject({
        rail: COULD_NOT_BE_RESUMED,
        detail: { agent: worker, because: 'the-provider-could-not-resume-it' },
      })
      expect(generic.detail).not.toHaveProperty('providerSaid')
      expect(generic.reason).not.toBe(tools.A_WAKE_ITS_PROVIDER_REFUSED)
      // … and one that failed otherwise (StartFailed) gets the same generic word, which is the arm
      // the host's person-read wrapper would otherwise hide from the `ResumeError` reader.
      gate.resumeFails = () => aResumeRefusedWith(new StartFailed('the child exited'))
      const failedOtherwise = await wakeByMessage(pm, worker, label)
      expect(failedOtherwise).toMatchObject({
        rail: COULD_NOT_BE_RESUMED,
        detail: { agent: worker, because: 'the-provider-could-not-resume-it' },
      })
      expect(failedOtherwise.reason).toBe(generic.reason)
    })

    /** ⚑ A giver and its worker, the giver then stopped, and the worker's reply to it. */
    const aReplyToAParentThatCannotStart = async (
      resumeFails: () => Error,
    ): Promise<{ landed: Record<string, unknown>; pm: string; worker: string; piece: string }> => {
      const pm = await aPmThatMaySpawn()
      const given = await giveWork(pm)
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      const piece = given.piece as string
      await waitFor(
        () => store.piecesOwnedBy(worker).some((one) => one.piece === piece),
        'the give to open a piece',
      )
      await host.close(pm, window)
      gate.resumeFails = resumeFails
      const landed = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'nobody is there',
      })
      return { landed, pm, worker, piece }
    }

    it('a reply the giver’s provider refused to start is kept for its next start, and says why in words, never in the provider’s', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { landed, pm, worker, piece } = await aReplyToAParentThatCannotStart(() =>
        aResumeRefusedWith(refusedStart(SAID)),
      )
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      // ⚑ **D-030** — the giver can still hear it, so the reply waits in its ledger for its next
      // start, and nothing records it lost.
      expect(landed.delivered).toBe('kept')
      expect(landed.why).toBe('This conversation did not start: its provider refused to start it.')
      // ⛔ The provider's words reach neither the replier nor the words kept for the giver.
      expect(JSON.stringify(landed)).not.toContain('Too many open files')
      const kept = store
        .events(pm)
        .map((entry) => entry.event)
        .filter(
          (event) => event.type === 'message_queued' && event.text.includes('nobody is there'),
        )
      expect(kept).toHaveLength(1)
      expect(kept[0]).toMatchObject({ kind: 'work', relayedFrom: worker, forItsNextStart: true })
      expect(JSON.stringify(kept)).not.toContain('Too many open files')
      expect(
        store
          .events(worker)
          .map((entry) => entry.event)
          .filter((event) => event.type === 'reply_undelivered'),
      ).toEqual([])
      // ⚑ The reply still closed the piece: the durable fact never depends on somebody being there.
      expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)).toMatchObject({
        state: 'answered',
        outcome: 'done',
      })
    })

    it('a reply whose giver’s start failed otherwise says it in the generic clause, and the piece is still answered', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { landed, worker, piece } = await aReplyToAParentThatCannotStart(() =>
        aResumeRefusedWith(new StartFailed('the child exited')),
      )
      // ⚑ **D-030** — kept for the giver's next start, as every start that fails keeps it.
      expect(landed.delivered).toBe('kept')
      expect(String(landed.why)).toMatch(
        /^This conversation did not start: its provider could not bring it back/,
      )
      expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)).toMatchObject({
        state: 'answered',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // §8 · a person's doors
  // ───────────────────────────────────────────────────────────────────────────

  describe('§8 · what a person reads', () => {
    const SAID = 'the provider’s own sentence about what it refused'

    const create = (extra: Record<string, unknown> = {}): Promise<unknown> =>
      executeRuntimeCommand(host, window, {
        kind: 'createSession',
        provider: 'claude',
        profileId: 'writer',
        approvalMode: 'auto',
        cwd: root,
        ...extra,
      })

    const NOT_OPENED =
      'No conversation was made, and starting it again will be refused the same way until what its provider refused is changed.'

    it('New Conversation: a provider’s refusal reads what failed, in its words, and that the same start will be refused; the launcher is answered `launch`', async () => {
      const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => refusedStart(SAID)
      const said = `This conversation did not open: its provider refused to start it, saying “${SAID}”. ${NOT_OPENED}`
      await expect(personOpens('writer')).rejects.toThrow(said)
      // ⛔ Not the raw refusal's words …
      const raw = await personOpens('writer').catch((error: Error) => error.message)
      expect(raw).not.toContain('codex refused thread/start')
      // ⚑ … which the log keeps, whole.
      expect(
        logged.mock.calls.some((call) => String(call[0]).includes('codex refused thread/start')),
      ).toBe(true)
      // The launcher that asks is answered the word `launch`, with the same sentence.
      expect(await create({ answerARefusal: true })).toMatchObject({
        refused: { reason: 'launch', said },
      })

      // The controls: no reason given, a plain error, and a start that failed otherwise.
      gate.startFails = () => refusedStart(null)
      await expect(personOpens('writer')).rejects.toThrow(
        `This conversation did not open: its provider refused to start it and gave no reason. ${NOT_OPENED}`,
      )
      gate.startFails = () => new Error('the provider said no')
      await expect(personOpens('writer')).rejects.toThrow('the provider said no')
      gate.startFails = () => new StartFailed('codex app-server exited (stderr tail: boom)')
      const failed = await personOpens('writer').catch((error: Error) => error.message)
      expect(failed).toBe(
        'This conversation did not open: its provider could not be started, so no conversation was made. Start it again; if its provider fails the same way, a person has to look — BroCrew records why in its log.',
      )
      expect(failed).not.toContain('stderr tail')
    })

    it('a message to a stopped conversation and the reopen under it say the refusal as a reopen, and the person’s words are not sent', async () => {
      const sessionId = await personOpens('writer')
      await host.close(sessionId, window)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.resumeFails = () => aResumeRefusedWith(refusedStart(SAID))
      const said = `This conversation did not continue: its provider refused to start it again, saying “${SAID}”. The conversation is kept, and its provider will refuse it the same way until what it refused is changed.`

      const answer = await host.startAndSend(sessionId, 'carry on', window)
      expect('notSent' in answer ? answer.notSent : null).toMatchObject({
        refusedBy: 'the-start',
        said,
      })
      await expect(host.resumeSession(sessionId, window)).rejects.toThrow(said)
      // ⛔ The person's words were not sent: no turn of theirs is in the ledger.
      expect(userTurns(store.events(sessionId).map((entry) => entry.event))).toEqual([])

      // The control: a start that failed otherwise says it of a reopen, in the generic sentence.
      gate.resumeFails = () => aResumeRefusedWith(new StartFailed('the child exited'))
      const generic =
        'This conversation did not continue: its provider could not be started again. The conversation is kept; if its provider fails the same way next time, a person has to look — BroCrew records why in its log.'
      const otherwise = await host.startAndSend(sessionId, 'carry on', window)
      expect('notSent' in otherwise ? otherwise.notSent : null).toMatchObject({
        refusedBy: 'the-start',
        said: generic,
      })
      await expect(host.resumeSession(sessionId, window)).rejects.toThrow(generic)
      // …and with the failure cleared the same reopen succeeds: the conversation was kept, and now the
      // person's words DO reach its ledger, so their absence above was the refusal's.
      gate.resumeFails = undefined
      await host.resumeSession(sessionId, window)
      expect(host.sessionIds).toContain(sessionId)
      await host.send(sessionId, 'carry on', window)
      await waitFor(
        () => userTurns(store.events(sessionId).map((entry) => entry.event)).length === 1,
        'the person’s words to be recorded',
      )
      expect(userTurns(store.events(sessionId).map((entry) => entry.event))).toEqual(['carry on'])
    })
  })
})
