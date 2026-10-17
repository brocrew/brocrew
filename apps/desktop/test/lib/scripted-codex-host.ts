import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CodexRuntime,
  type AgentRuntime,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { CODEX_PROTOCOL_VERSION } from '../../../../packages/runtime/src/codex/protocol-version'
import type { ModelListResponse } from '../../../../packages/runtime/src/codex/protocol/v2/ModelListResponse'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from '../../../../packages/runtime/test/fixtures/codex-protocol'
import { type AppDatabase, openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, SessionLivenessMessage } from '../../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './what-this-app-adds'

/**
 * ⚑ **709 · a real host over the REAL `CodexRuntime`, with an app-server scripted like one** —
 * shared by `an-interrupt-codex-never-answers.test.ts` (`704` H-8) and
 * `the-agents-words-on-a-card.test.ts` (R44). ⛔ Not a handle double: both questions are about what
 * the adapter itself does between the wire and the host, so a double that replaced the adapter would
 * be measuring the double.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../../src/main/db/migrations')

export class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  readonly messages: RuntimeEventMessage[] = []
  /** ⚑ 723 · the session state this window was sent — where the header reads a standing grant. */
  readonly liveness: SessionLivenessMessage[] = []
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message)
  }
}

/** A queue with an async iterator — the shape the transport hands the adapter. */
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

/**
 * What this app-server does when it is asked to interrupt a turn — `late` answers it, and ends the
 * turn, {@link ScriptedAppServer.lateMs} after the ask.
 */
export type InterruptAnswer =
  'answers' | 'never' | 'never-but-ends' | 'late' | 'answers-but-runs-on'

/**
 * ⚑ **D-042 · R1 — the catalogue this app-server answers `model/list` with**: ONE row, the one it
 * marks `isDefault`, at its own `defaultReasoningEffort` — the shape bundled 0.146.0 answers (058,
 * measured), cut to the one row a launch reads. ⛔ Until D-042 this app-server answered `{}`, an
 * empty list, and no launch read it; now a Codex launch that names no model reads its list and names
 * the row it marks default, and F2 refuses a launch whose list names none (`nothing-names-a-model`) —
 * so an empty answer here would refuse every conversation these tests open. ⚑ The row is the model
 * {@link threadStartResponse} reports running (`gpt-5`), so what the host asks for and what the
 * thread reports agree, and no card says the two apart.
 */
export const THE_MODEL_LIST: ModelListResponse = {
  data: [
    {
      id: 'gpt-5',
      model: 'gpt-5',
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      displayName: 'GPT-5',
      description: 'The scripted app-server’s one model.',
      modelSpecialty: null,
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning.' },
        { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth.' },
        { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems.' },
      ],
      defaultReasoningEffort: 'medium',
      inputModalities: ['text'],
      supportsPersonality: false,
      multiAgentVersion: null,
      additionalSpeedTiers: [],
      serviceTiers: [],
      defaultServiceTier: null,
      availableAccessPrograms: null,
      isDefault: true,
    },
  ],
  nextCursor: null,
}

/** The codex app-server stand-in: a conformant handshake, turns that run until told, every request kept. */
export class ScriptedAppServer implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  /** Every answer the adapter wrote to a request this app-server raised. */
  readonly responses: { id: string | number; result: unknown }[] = []
  interruptAnswer: InterruptAnswer = 'answers'
  lateMs = 0
  constructor(readonly home: string) {}
  request(method: string, params?: unknown): Promise<unknown> {
    const asked = (params ?? {}) as Record<string, unknown>
    this.requests.push({ method, params: asked })
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.home,
      })
    }
    // ⚑ D-042 · R1 — a launch naming no model reads this list and names its `isDefault` row.
    if (method === 'model/list') return Promise.resolve(THE_MODEL_LIST)
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = typeof asked['cwd'] === 'string' ? asked['cwd'] : '/tmp/x'
      return Promise.resolve(threadStartResponse('th_1', cwd) as unknown as Record<string, unknown>)
    }
    if (method === 'turn/start') {
      const id = `tn_${++this.turns}`
      // ⚑ Codex's own `turn/started` follows the response, so the turn is RUNNING — an interrupt of
      // it is one Codex can act on (`704`'s late arm), and the adapter sends exactly one.
      setTimeout(() => {
        this.queue.push({
          kind: 'notification',
          method: 'turn/started',
          params: turnStartedNotification('th_1', id),
        })
      }, 1)
      return Promise.resolve(turnStartResponse(id))
    }
    if (method === 'turn/interrupt') {
      const turnId = typeof asked['turnId'] === 'string' ? asked['turnId'] : this.lastTurn
      if (this.interruptAnswer === 'late') {
        return new Promise((resolve) =>
          setTimeout(() => {
            this.end(turnId, 'interrupted')
            resolve({})
          }, this.lateMs),
        )
      }
      // ⚑ **723 · `answers-but-runs-on`** — the request answered and the turn NOT ended (`704`
      // measured Codex answering and completing a turn anyway), so a caller that read the answer as
      // the ending is caught.
      if (this.interruptAnswer === 'answers-but-runs-on') return Promise.resolve({})
      if (this.interruptAnswer !== 'never') this.end(turnId, 'interrupted')
      // ⛔ **Never answered** — the wedged app-server `704` H-8 is about.
      if (this.interruptAnswer !== 'answers') return new Promise<never>(() => {})
      return Promise.resolve({})
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result })
  }
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  exited: Promise<void> | undefined
  /** Codex's own ending for a turn, in its own word. */
  end(turnId: string, status: 'completed' | 'interrupted'): void {
    this.queue.push({
      kind: 'notification',
      method: 'turn/completed',
      params: turnCompletedNotification('th_1', completedTurn(turnId, { status })),
    })
  }
  /**
   * ⚑ **723 · a notification as Codex sends it** — scoped to this thread and the last bound turn,
   * unless the params say otherwise. An MCP tool call's `item/started` is what tells Codex's own
   * approval from a server's form wearing its marker.
   */
  announce(method: string, params: Record<string, unknown>): void {
    this.queue.push({
      kind: 'notification',
      method,
      params: { threadId: 'th_1', turnId: this.lastTurn, ...params },
    })
  }
  /**
   * A server request as a CONFORMANT app-server raises it — scoped to this thread and the turn the
   * last `turn/start` bound (061), unless the params say otherwise.
   */
  raise(id: string | number, method: string, params: Record<string, unknown>): void {
    this.queue.push({
      kind: 'request',
      id,
      method,
      params: { threadId: 'th_1', turnId: this.lastTurn, ...params },
    })
  }
  get lastTurn(): string {
    return `tn_${String(this.turns)}`
  }
  /** Every request by that method, in the order it was written. */
  sent(method: string): Record<string, unknown>[] {
    return this.requests.filter((one) => one.method === method).map((one) => one.params)
  }
  /**
   * The person's words in every `turn/start`, in the order they were written — the last paragraph,
   * after the authorship preamble the host puts in front of them (`607`), and before the block
   * it adds at the end.
   */
  turnsAsked(): string[] {
    return this.sent('turn/start').map((params) => {
      const input = Array.isArray(params['input']) ? (params['input'] as unknown[]) : []
      const text = input
        .map((part) =>
          typeof part === 'object' &&
          part !== null &&
          typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('')
      return withoutWhatThisAppAdds(text).split('\n\n').at(-1) ?? ''
    })
  }
}

export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A host whose every Codex conversation runs on a {@link ScriptedAppServer}, one per launch.
 *
 * ⚑ **D-042 moved what `servers[0]` is**: the host's `model/list` probe is a launch too (`listModels`
 * spawns its own app-server), and a conversation that names no model asks it BEFORE its own thread
 * starts — so the probe's server comes first and `servers.at(-1)` is still the conversation's. ⛔ A
 * test that wants the conversation's server reads `servers.at(-1)`, never `servers[0]`.
 */
export function aHostOverScriptedCodex(
  userData: string,
  deps: { interruptWaitMs?: number } = {},
): { host: RuntimeHost; db: AppDatabase; store: SessionStore; servers: ScriptedAppServer[] } {
  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const store = createSessionStore(db)
  const servers: ScriptedAppServer[] = []
  let counter = 0
  const createRuntime = (provider: Provider): AgentRuntime => {
    if (provider !== 'codex') throw new Error(`this rig opens Codex only, not ${provider}`)
    return new CodexRuntime((context: CodexLaunchContext) => {
      const server = new ScriptedAppServer(context.providerHome)
      servers.push(server)
      return server
    })
  }
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
    newSessionId: () => `sess_${++counter}`,
    ...(deps.interruptWaitMs === undefined ? {} : { interruptWaitMs: deps.interruptWaitMs }),
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
  return { host, db, store, servers }
}
