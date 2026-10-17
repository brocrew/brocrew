import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  FakeProviderSessions,
  type AgentRuntime,
  type AgentToolAnswer,
  type ClaudeQuery,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type FakeSessionHandle,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ResumeOptions,
  type SessionHandle,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  threadStartResponse,
  turnStartResponse,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type CallerIdentity,
  type RuntimeEventSink,
} from './helpers/giver-notice-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { AgentModelChoice } from '../src/shared/model-choice'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 677 · `R25` §4.1 and §4.4 — what reaches the PROVIDER, and what a WAKE reads
 *
 * ⚑ **The brief's first criterion, word for word:** *"A spawn of an identity a person set to a model
 * and effort reaches the provider with exactly those — a capture of the launch options, both
 * providers. ⛔ Control: an identity with nothing set sends nothing, byte-identical to today."*
 *
 * 🔴 **D-042 · R1 reverses the control's half**: *every call names its model and effort* — what was
 * named for the conversation, else its agent's default, else the person's last pick, else the
 * provider's own default BY NAME (Claude's `default` at `high`; Codex's `isDefault` row of
 * `model/list` at its `defaultReasoningEffort`). So the control below now sends the provider's
 * default by its name, never an absence.
 *
 *  - **§1 · Claude** — the REAL `ClaudeRuntime` over a query factory that keeps every `Options` it is
 *    handed: the SDK options for the spawned child, keyed by the child's own `CLAUDE_CONFIG_DIR`.
 *  - **§2 · Codex** — the REAL `CodexRuntime` over a transport that records every JSON-RPC request:
 *    `thread/start` for the model and (D-042) the effort, the first `turn/start` for both, and
 *    `model/list` — which a launch naming nothing reads for Codex's default.
 *  - **§3 · a wake** — over a real host. 🔴 **D-042 moved it**: `677`'s wake re-read the identity's
 *    CURRENT choice; now every start — a wake, a person's Reopen — replays the conversation's own
 *    ROW (R2: each conversation keeps its own pair), and only a row that names none yet is resolved
 *    by R1's order and recorded. ⚑ **D-017 — the wake is the start the parent's MESSAGE makes**
 *    (`resume_agent` and `end_agent` are gone).
 *
 * ⚑ **D-016 · a spawn is a GIVE that finds no conversation**, and the brief is the child's first
 * turn. So the launch below is `giveWork`'s, and the first turn a provider sees is the brief's.
 * 🔴 **D-042 · R4 — a give may name a model and an effort again** (`give_work`'s own arguments),
 * judged by `model-rails.ts`' one seam.
 *
 * ⚠️ **What this measures, and what it cannot** (`581`'s bound, verbatim): *"This captures what the
 * provider put in its model-bound request, not a hosted model's obedience to the text."* — and here
 * one layer earlier still: what our adapter HANDED the provider. What a provider then does with a
 * changed model on a resume is measured against the real binaries in
 * `packages/runtime/smoke/{claude,codex}-resume-model-probe.smoke.ts`.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  readonly messages: RuntimeEventMessage[] = []
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A queue with an async iterator — the shape both seams hand the adapter. */
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
      next: async (): Promise<IteratorResult<T>> => {
        if (this.waiting.length > 0) return { value: this.waiting.shift() as T, done: false }
        if (this.closed) return { value: undefined as never, done: true }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.settle = resolve
        })
      },
    }
  }
}

/** The SDK `Query` stand-in: nothing arrives unless a test pushes it. */
class FakeQuery implements ClaudeQuery {
  readonly messages = new Wire<SDKMessage>()
  async interrupt(): Promise<unknown> {
    return undefined
  }
  async close(): Promise<void> {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/** The codex app-server stand-in: a conformant handshake, and EVERY request kept. */
class RecordingTransport implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  constructor(readonly home: string) {}
  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params: (params ?? {}) as Record<string, unknown> })
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.home,
      })
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = ((params ?? {}) as { cwd?: string }).cwd ?? '/tmp/x'
      return Promise.resolve(threadStartResponse('th_1', cwd) as unknown as Record<string, unknown>)
    }
    if (method === 'turn/start') return Promise.resolve(turnStartResponse(`tn_${++this.turns}`))
    // ⚑ **D-042 · R1 — a launch naming nothing reads Codex's own default off `model/list`**: one
    // row marked `isDefault`, with the effort the server names for it.
    if (method === 'model/list') return Promise.resolve(CODEX_MODEL_LIST)
    return Promise.resolve({})
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
  /** The params of the first request by that method, or undefined. */
  first(method: string): Record<string, unknown> | undefined {
    return this.requests.find((one) => one.method === method)?.params
  }
}

const OPUS_HIGH: AgentModelChoice = { provider: 'claude', model: 'opus', effort: 'high' }
const TERRA_HIGH: AgentModelChoice = { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' }

const efforts = (...ids: string[]): { reasoningEffort: string }[] =>
  ids.map((reasoningEffort) => ({ reasoningEffort }))
/**
 * ⚑ **D-042 · Codex's `model/list`, in the server's own words** — its default is `luna`, not the
 * model §2's agent chose, so the two launches differ in the model AND the effort.
 */
const CODEX_MODEL_LIST = {
  data: [
    {
      id: 'gpt-5.6-terra',
      model: 'gpt-5.6-terra',
      displayName: 'terra',
      supportedReasoningEfforts: efforts('low', 'medium', 'high'),
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'gpt-5.6-luna',
      model: 'gpt-5.6-luna',
      displayName: 'luna',
      supportedReasoningEfforts: efforts('low', 'medium', 'high'),
      defaultReasoningEffort: 'medium',
      isDefault: true,
    },
  ],
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/* ─────────────────────────────────────────────── §1-§2 · both adapters, for real ── */

describe('677 §1-§2 · a spawn reaches the provider with exactly the person’s model and effort', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  const window = new Window('webContents:1')
  /** Every SDK `Options` the Claude adapter built, in launch order. */
  let claudeLaunches: Options[]
  /** Every codex transport, with the home it was opened in. */
  let codexTransports: RecordingTransport[]
  /** Every codex handle, with the `StartOptions` the HOST handed the adapter. */
  let codexStarts: { options: StartOptions; handle: SessionHandle }[]

  const homeOf = (provider: Provider, profileId: string): string =>
    join(userData, 'provider-homes', profileId, provider)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-677-reach-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    claudeLaunches = []
    codexTransports = []
    codexStarts = []
    const createRuntime = (provider: Provider): AgentRuntime => {
      if (provider === 'claude') {
        return new ClaudeRuntime(
          (params) => {
            claudeLaunches.push(params.options)
            return new FakeQuery() as never
          },
          async () => true,
        )
      }
      const runtime = new CodexRuntime((context: CodexLaunchContext) => {
        const transport = new RecordingTransport(context.providerHome)
        codexTransports.push(transport)
        return transport
      })
      // ⚑ The options the host handed the adapter, kept beside the handle — so §2 can take the
      // child's first turn and read the effort off the wire, where Codex carries it.
      return new Proxy(runtime, {
        get(target, property) {
          if (property === 'start') {
            return async (options: StartOptions) => {
              const handle = await target.start(options)
              codexStarts.push({ options, handle })
              return handle
            }
          }
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value
        },
      })
    }
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime,
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = homeOf(provider, profileId ?? 'brobot')
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
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** `pm`, opened by a person on Claude, and the named identities it will start brought into being. */
  const aPmThatMayStart = async (...slugs: string[]): Promise<string> => {
    const { sessionId } = await host.createSession({ provider: 'claude', profileId: 'pm' }, window)
    for (const slug of slugs) {
      store.createAgentIdentity(
        {
          slug: slug.replace(/@.*/, ''),
          displayName: null,
          provider: slug.endsWith('@codex') ? 'codex' : null,
        },
        { by: 'a-person' },
      )
    }
    return sessionId
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  /** ⚑ **D-016** — the PM gives the identity a piece; the give starts its conversation. */
  const spawn = async (parent: string, profileId: string): Promise<string> => {
    const outcome = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: profileId,
        title: 'the work this is about',
        brief: 'the work this is about',
      },
      speakingAs(parent),
    )
    if (!outcome.ok) throw new Error(outcome.refusal.reason)
    if (outcome.runsOn.how !== 'started')
      throw new Error(`the give to ${profileId} started nothing`)
    return outcome.owner
  }

  const optionsIn = (profileId: string): Options => {
    const found = claudeLaunches.filter(
      (options) => options.env?.['CLAUDE_CONFIG_DIR'] === homeOf('claude', profileId),
    )
    expect(found, `exactly one Claude launch as ${profileId}`).toHaveLength(1)
    return found[0] as Options
  }

  const rowOf = (sessionId: string) =>
    db.prepare('SELECT model, reasoning_effort FROM provider_session WHERE id = ?').get(sessionId)

  it('🔴 §1 CLAUDE · the SDK options carry exactly the person’s model and effort', async () => {
    const pm = await aPmThatMayStart('worker', 'plain')
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const worker = await spawn(pm, 'worker')
    const chosen = optionsIn('worker')
    expect(chosen.model).toBe('opus')
    expect(chosen.effort).toBe('high')
    // ⚑ …and the row records what the launch asked for, which is what a person's Reopen replays.
    expect(rowOf(worker)).toEqual({ model: 'opus', reasoning_effort: 'high' })
  })

  it('⛔ §1 CONTROL · an identity nobody chose for sends Claude’s default BY NAME — never an absence (D-042 · R1)', async () => {
    const pm = await aPmThatMayStart('worker', 'plain')
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const plain = await spawn(pm, 'plain')
    await spawn(pm, 'worker')
    const byName = optionsIn('plain')
    // ⛔ **D-042 · R1 reverses `677`'s *"sends NOTHING"***: nothing runs on an unnamed default, so the
    // control names the provider's own default — Claude's `default` alias at `medium` (W4.28; `high` until then, F3).
    expect(byName.model).toBe('default')
    expect(byName.effort).toBe('medium')
    // ⚑ …and RECORDS it, so every later start of this conversation replays one pair.
    expect(rowOf(plain)).toEqual({ model: 'default', reasoning_effort: 'medium' })
    // 🔴 **Nothing else about the launch moved, measured as a difference**: the chosen launch's
    // option KEYS are the control's — both name `model` and `effort` now — and only those two
    // VALUES are the default's rather than the provider's.
    const chosen = optionsIn('worker')
    expect(Object.keys(chosen).sort()).toEqual(Object.keys(byName).sort())
    expect([chosen.model, chosen.effort]).toEqual(['opus', 'high'])
  })

  it('🔴 §1 · D-042 · R2 — a PERSON’s own launch of that identity, naming nothing, starts on its default too — and what they name wins (`R25` §1.4)', async () => {
    await aPmThatMayStart('worker')
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    // ⚑ The window's own door, with nothing picked in the launcher. ⛔ **Reversed by D-042 · R2**:
    // *"a new conversation starts on the agent's default"*, whoever starts it.
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'worker' },
      window,
    )
    const launched = optionsIn('worker')
    expect([launched.model, launched.effort]).toEqual(['opus', 'high'])
    expect(rowOf(sessionId)).toEqual({ model: 'opus', reasoning_effort: 'high' })
    // ⚑ **`R25` §1.4's half that stands — a person's own launcher is not touched**: what they NAME
    // is R1's first entry, ahead of the default.
    const named = await host.createSession(
      { provider: 'claude', profileId: 'worker', model: 'sonnet', reasoningEffort: 'low' },
      window,
    )
    const both = claudeLaunches.filter(
      (options) => options.env?.['CLAUDE_CONFIG_DIR'] === homeOf('claude', 'worker'),
    )
    expect(both).toHaveLength(2)
    expect([both[1]?.model, both[1]?.effort]).toEqual(['sonnet', 'low'])
    expect(rowOf(named.sessionId)).toEqual({ model: 'sonnet', reasoning_effort: 'low' })
  })

  it('🔴 §2 CODEX · `thread/start` carries the model and effort, and the first `turn/start` both — the control carries Codex’s own default, BY NAME', async () => {
    const pm = await aPmThatMayStart('builder@codex', 'plain-codex@codex')
    expect(store.setModelChoice('builder', TERRA_HIGH)).toBe(true)
    await spawn(pm, 'builder')
    await spawn(pm, 'plain-codex')
    // ⚑ One app-server per launch, opened in the child's OWN home — so the home names the transport.
    // ⚑ **D-042 · and the one that opened a thread is the session's**: a launch naming nothing first
    // asks Codex's list, in the same home, on an app-server of its own (a probe is a launch).
    const opened = (profileId: string): RecordingTransport[] =>
      codexTransports.filter(
        (one) => one.home === homeOf('codex', profileId) && one.first('thread/start') !== undefined,
      )
    const listed = (profileId: string): RecordingTransport[] =>
      codexTransports.filter(
        (one) => one.home === homeOf('codex', profileId) && one.first('model/list') !== undefined,
      )
    const transportOf = (profileId: string): RecordingTransport => {
      const found = opened(profileId)
      expect(found, `exactly one app-server as ${profileId}`).toHaveLength(1)
      return found[0] as RecordingTransport
    }
    // 🔴 **D-042 · R1 — Codex's default is a ROW of its list**: the control read it once; a launch
    // whose default names its pair read nothing.
    expect(listed('plain-codex')).toHaveLength(1)
    expect(listed('builder')).toHaveLength(0)

    // ⚑ What the HOST handed the adapter — the launch options the brief asks for.
    const chosenStart = codexStarts.find(
      (one) => one.options.providerHome === homeOf('codex', 'builder'),
    )
    const plainStart = codexStarts.find(
      (one) => one.options.providerHome === homeOf('codex', 'plain-codex'),
    )
    if (chosenStart === undefined || plainStart === undefined)
      throw new Error('a codex spawn did not start')
    expect(chosenStart.options.model).toBe('gpt-5.6-terra')
    expect(chosenStart.options.reasoningEffort).toBe('high')
    expect(plainStart.options.model).toBe('gpt-5.6-luna')
    expect(plainStart.options.reasoningEffort).toBe('medium')

    // ⚑ …and what the ADAPTER then put on the wire. ⚑ **D-016** — the first turn is the give's
    // brief, so nothing is sent here: the turn the brief started is the one read.
    const chosen = transportOf('builder')
    const plain = transportOf('plain-codex')
    const effortOn = (params: Record<string, unknown> | undefined): unknown =>
      (params?.['config'] as { model_reasoning_effort?: unknown } | undefined)
        ?.model_reasoning_effort
    expect(chosen.first('thread/start')?.['model']).toBe('gpt-5.6-terra')
    expect(plain.first('thread/start')?.['model']).toBe('gpt-5.6-luna')
    // ⚑ **D-042 · the thread is named its effort too** — `config.model_reasoning_effort`.
    expect(effortOn(chosen.first('thread/start'))).toBe('high')
    expect(effortOn(plain.first('thread/start'))).toBe('medium')
    await waitFor(
      () => chosen.first('turn/start') !== undefined && plain.first('turn/start') !== undefined,
      'both first turns',
    )
    expect(chosen.first('turn/start')?.['effort']).toBe('high')
    expect(chosen.first('turn/start')?.['model']).toBe('gpt-5.6-terra')
    expect(plain.first('turn/start')?.['effort']).toBe('medium')
    expect(plain.first('turn/start')?.['model']).toBe('gpt-5.6-luna')
  })

  it('⛔ §2 · a Claude choice is never sent to a Codex child — it starts on Codex’s own default, and the host’s answer says what it runs on', async () => {
    // ⚑ **682 · the one way left to put a Claude choice beside a Codex child**: an identity whose OWN
    // provider is Codex, holding a Claude choice written before `R31b` (the store's own writer is
    // below every door). ⛔ Not in force, so read by nothing — `aChoiceIsInForce`.
    const pm = await aPmThatMayStart('builder@codex')
    expect(store.setModelChoice('builder', OPUS_HIGH)).toBe(true)
    const outcome = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'builder',
        title: 'the work this is about',
        brief: 'the work this is about',
      },
      speakingAs(pm),
    )
    if (!outcome.ok) throw new Error(outcome.refusal.reason)
    // ⚑ **D-042** — `677`'s *"the answer says why"* (`aChoiceForAnotherProvider`) went with its
    // sentence: a default not in force is read by nothing, and the answer says what the start runs
    // on — R1's next entry, Codex's own default.
    expect(outcome.runsOn).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      effort: 'medium',
      effortReported: false,
      how: 'started',
      from: 'the-providers-default',
      named: { model: false, effort: false },
    })
    const start = codexStarts.find((one) => one.options.providerHome === homeOf('codex', 'builder'))
    if (start === undefined) throw new Error('the codex child did not start')
    // ⛔ Nothing of the Claude choice was sent — Codex's own pair, by its name.
    expect([start.options.model, start.options.reasoningEffort]).toEqual(['gpt-5.6-luna', 'medium'])
  })
})

/* ─────────────────────────────────────────────────────────────────── §3 · a wake ── */

/**
 * ⚑ **D-042 · Claude's list, as the adapter maps the SDK's** — the `default` row marked the
 * provider's own, `high` the default effort of every row that lists it (F3), and `haiku` left
 * undescribed (measured, 106): a model that offers no effort.
 */
const CLAUDE_LIST: ModelChoice[] = [
  {
    id: 'default',
    label: 'Default',
    efforts: [
      { id: 'low', label: 'low' },
      { id: 'high', label: 'high' },
      { id: 'max', label: 'max' },
    ],
    defaultEffort: 'high',
    isDefault: true,
  },
  {
    id: 'opus',
    label: 'Opus',
    efforts: [
      { id: 'low', label: 'low' },
      { id: 'high', label: 'high' },
      { id: 'max', label: 'max' },
    ],
    defaultEffort: 'high',
  },
  { id: 'haiku', label: 'Haiku' },
]

/** `394`'s double, with every start and resume's options KEPT — and, D-042, Claude's list. */
class RecordingDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly started: StartOptions[],
    private readonly resumed: ResumeOptions[],
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.started.push(options)
    return super.start(options)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.resumed.push(options)
    return super.resume(ref, options)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    return CLAUDE_LIST
  }
}

describe('677 §3 · a wake is a launch — 🔴 D-042: it replays the conversation’s own ROW, and only an empty row reads R1', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let handles: FakeSessionHandle[]
  let started: StartOptions[]
  let resumed: ResumeOptions[]
  const window = new Window('webContents:1')
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-677-wake-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-677-wake-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_770_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    started = []
    resumed = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new RecordingDouble(provider, handles, issued, gate, started, resumed),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length
  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer: AgentToolAnswer = await tool.call(args)
    return answer.structured as Record<string, unknown>
  }

  /**
   * ⚑ A PM a person opened in `auto`, a worker it gave work to, the brief's turn over, and then
   * STOPPED: exactly what a wake is for. ⚑ **D-017 — nothing ends a conversation** (`end_agent` is
   * gone): the app's own stop, which the parent's ending was.
   *
   * ⚑ **D-042 · R4 — a give names its model again**, so a worker whose RECORD names `recorded` is made
   * the plain way: the give names it (its effort left out — `haiku` offers none), and no person's
   * default is in play. ⚠️ Until D-042 it took a person's choice made and taken back around the give.
   */
  const anEndedWorkerWithOpenWork = async (
    recorded?: string,
    /** ⚑ A person's DEFAULT made once the identity exists and BEFORE the give — or none. */
    chosenFirst?: AgentModelChoice,
  ): Promise<{ pm: string; worker: string; piece: string }> => {
    const opened = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(opened.sessionId, window)
    if (chosenFirst !== undefined) expect(store.setModelChoice('worker', chosenFirst)).toBe(true)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    // ⚑ **D-016** — the give starts the worker and its brief is the first turn: the work itself.
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'migrate',
      brief: 'migrate',
      ...(recorded === undefined ? {} : { model: recorded }),
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const worker = given.agent as string
    await waitFor(() => turnsIn(worker) > 0, 'the work’s turn to end')
    expect(store.openPiecesOf(worker).some((piece) => piece.giver === pm)).toBe(true)
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over')
    return { pm, worker, piece: given.label as string }
  }

  /**
   * ⚑ **The wake — D-017: the parent's MESSAGE starts the stopped worker** (`resume_agent` is gone),
   * as its identity is now. A follow-up, since the worker holds the parent's work — ⚑ D-016: naming
   * that piece.
   */
  const wake = async (ended: {
    readonly pm: string
    readonly worker: string
    readonly piece: string
  }): Promise<Record<string, unknown>> => {
    const woken = await callOn(ended.pm, 'message_agent', {
      agent: ended.worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: ended.piece,
    })
    expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
    return woken
  }

  const rowOf = (sessionId: string) =>
    db.prepare('SELECT model, reasoning_effort FROM provider_session WHERE id = ?').get(sessionId)

  /** ⚑ A conversation's row emptied as every helper's was before D-042: nothing recorded. */
  const recordedNothing = (worker: string): void => {
    store.setModel(worker, null)
    store.setReasoningEffort(worker, null)
    expect(rowOf(worker)).toEqual({ model: null, reasoning_effort: null })
  }

  it('🔴 `give_work` NAMES a model and an effort (D-042 · R4), and its answer SAYS what the child runs on', async () => {
    // ⛔ **Reversed by D-042 · R4** — D-016's plan ruling 3 took `spawn_agent`'s `model` away; a give
    // now chooses what its helper's one conversation runs on, judged by `model-rails.ts`' seam.
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    const spawnTool = agentToolsFor(host, pm).tools.find((one) => one.name === 'give_work')
    if (spawnTool === undefined) throw new Error('no give_work')
    expect(Object.keys(spawnTool.input)).toContain('model')
    expect(Object.keys(spawnTool.input)).toContain('effort')
    // ⚑ …and the answer, end to end over the real tool, on a person's default — naming nothing.
    const opened = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(opened.sessionId, window)
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const answered = await spawnTool.call({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this is about',
      brief: 'the work this is about',
    })
    // ⚑ R1's source in words, and the effort as requested until the provider reports it (R5).
    expect(answered.text).toContain('It runs on “opus” at high effort (requested) — its default.')
  })

  it('🔴 D-042 · R2 — a default changed AFTER the start does NOT reach its wake: the wake replays the ROW, which R1 already filled', async () => {
    // ⛔ **`677`'s wake re-read of the identity's CURRENT choice is gone** (D-042): each conversation
    // keeps its own pair until it is changed there, and the agent's default is what its NEW ones start on.
    const ended = await anEndedWorkerWithOpenWork()
    const { worker } = ended
    // ⚑ The premise: it was started when nobody had chosen, so — R1 — on Claude's default BY NAME,
    // recorded on its row.
    expect([started.at(-1)?.model, started.at(-1)?.reasoningEffort]).toEqual(['default', 'medium'])
    expect(rowOf(worker)).toEqual({ model: 'default', reasoning_effort: 'medium' })

    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const before = resumed.length
    const woken = await wake(ended)
    expect(woken, JSON.stringify(woken)).toMatchObject({ outcome: 'ok', agent: worker })
    const options = resumed[before]
    expect(options?.model).toBe('default')
    expect(options?.reasoningEffort).toBe('medium')
    // ⛔ The row is what every later start replays — and the default moved none of it.
    expect(rowOf(worker)).toEqual({ model: 'default', reasoning_effort: 'medium' })
  })

  it('⛔ CONTROL · with nothing changed a wake replays what was recorded — byte-identical to before', async () => {
    const ended = await anEndedWorkerWithOpenWork('haiku')
    const { worker } = ended
    const before = resumed.length
    await wake(ended)
    const options = resumed[before]
    if (options === undefined) throw new Error('the wake did not resume')
    expect(options.model).toBe('haiku')
    expect('reasoningEffort' in options).toBe(false)
    expect(rowOf(worker)).toEqual({ model: 'haiku', reasoning_effort: null })
  })

  it('⚑ an EFFORT-only value is NOT paired with a recorded model — that wake resumes as recorded', async () => {
    // ⛔ **Used whole** (review, round one) — and 🔴 **D-042: it is no default at all**: a default is
    // a model and the effort it runs at, so `677`'s effort-only value, which only the column can still
    // hold, folds to none; and a wake replays its row whatever a default says.
    const ended = await anEndedWorkerWithOpenWork('haiku')
    const { worker } = ended
    db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE slug = 'worker'`).run(
      '{"provider":"claude","model":null,"effort":"max"}',
    )
    expect(store.modelChoiceOf('worker')).toBeNull()
    const before = resumed.length
    await wake(ended)
    const options = resumed[before]
    if (options === undefined) throw new Error('the wake did not resume')
    expect(options.model).toBe('haiku')
    expect('reasoningEffort' in options).toBe(false)
    expect(rowOf(worker)).toEqual({ model: 'haiku', reasoning_effort: null })
  })

  it('⚑ …and an agent’s default IS sent to a conversation that names no model — R1 resolves it at the wake, and records it', async () => {
    // 🔴 **D-042 · R1 — *"a row with nothing recorded gets that pair at its next start"***: every
    // helper from before D-042 has an empty row, and its next start names R1's pair and keeps it.
    const ended = await anEndedWorkerWithOpenWork()
    const { worker } = ended
    recordedNothing(worker)
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const before = resumed.length
    await wake(ended)
    const options = resumed[before]
    if (options === undefined) throw new Error('the wake did not resume')
    expect([options.model, options.reasoningEffort]).toEqual(['opus', 'high'])
    expect(rowOf(worker)).toEqual({ model: 'opus', reasoning_effort: 'high' })
  })

  it('⛔ a MODEL switched with no effort does not inherit an effort recorded for an older model it cannot run', async () => {
    // ⚑ Started on a person's {opus, high} — so the row records `high` — then its giver switches it
    // to `haiku`, naming no effort (D-042 · R4: *"from this piece on"*). ⚑ The seam keeps an effort
    // only where the new model offers it; `haiku` offers none, so the pair is `{haiku, —}`.
    const ended = await anEndedWorkerWithOpenWork(undefined, OPUS_HIGH)
    const { pm, worker } = ended
    expect(rowOf(worker)).toEqual({ model: 'opus', reasoning_effort: 'high' })
    // ⚑ Its piece taken back first: a give to a helper still holding stalled work is refused
    // (`its-work-has-stalled`), and taking it back wakes the helper to hear so — on its row's pair.
    const turns = turnsIn(worker)
    const took = await callOn(pm, 'withdraw_task', { piece: ended.piece })
    expect(took.outcome, JSON.stringify(took)).toBe('ok')
    await waitFor(
      () => resumed.at(-1)?.model === 'opus' && turnsIn(worker) > turns,
      'the worker to hear it',
    )
    const switched = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'and then',
      brief: 'and then',
      model: 'haiku',
    })
    expect(switched.outcome, JSON.stringify(switched)).toBe('ok')
    expect(switched.started).toBe(false)
    expect(switched.runs_on).toEqual({ model: 'haiku', effort: null })
    // ⛔ …and the ROW every later start replays holds no effort beside it.
    expect(rowOf(worker)).toEqual({ model: 'haiku', reasoning_effort: null })
    await waitFor(() => turnsIn(worker) > turns + 1, 'the switched piece’s turn to end')
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over again')
    const before = resumed.length
    await wake({ pm, worker, piece: switched.label as string })
    const options = resumed[before]
    if (options === undefined) throw new Error('the wake did not resume')
    expect(options.model).toBe('haiku')
    expect('reasoningEffort' in options).toBe(false)
    expect(rowOf(worker)).toEqual({ model: 'haiku', reasoning_effort: null })
  })

  it('⛔ a default for ANOTHER provider is not read by R1 at the wake of a Claude conversation — Claude’s own default is', async () => {
    // ⚑ **D-042** — the row names nothing, so this wake DOES read R1; the default is Codex's, so R1
    // passes it by for Claude's own default, BY NAME.
    const ended = await anEndedWorkerWithOpenWork('haiku')
    recordedNothing(ended.worker)
    expect(store.setModelChoice('worker', TERRA_HIGH)).toBe(true)
    const before = resumed.length
    await wake(ended)
    expect([resumed[before]?.model, resumed[before]?.reasoningEffort]).toEqual([
      'default',
      'medium',
    ])
    expect(rowOf(ended.worker)).toEqual({ model: 'default', reasoning_effort: 'medium' })
  })

  it('⛔ a PERSON’s Reopen replays the row too — it comes back as it was (`R25` §1.4; D-042 · R1)', async () => {
    const { worker } = await anEndedWorkerWithOpenWork('haiku')
    expect(store.setModelChoice('worker', OPUS_HIGH)).toBe(true)
    const before = resumed.length
    await host.resumeSession(worker, window)
    expect(resumed[before]?.model).toBe('haiku')
    expect('reasoningEffort' in (resumed[before] ?? {})).toBe(false)
    expect(rowOf(worker)).toEqual({ model: 'haiku', reasoning_effort: null })
  })
})
