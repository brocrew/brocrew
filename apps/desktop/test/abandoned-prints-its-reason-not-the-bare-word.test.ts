import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/** The toolset one conversation is offered — `agentToolsFor` exports no name for it. */
type AgentToolset = ReturnType<typeof agentToolsFor>

/**
 * # 🔴 675 M20 · `abandoned` prints its reason, not the bare word
 *
 * ## ⛔ What table 675's row measures
 *
 * `QUESTION_STATE_SENTENCE` (`agent-tools.ts`) gives `list_questions` a parenthetical for every
 * ended state a reader could misread from the word alone — `stranded`, `interrupted`,
 * `work-withdrawn`, and `abandoned`. Losing the `abandoned` entry does not remove the row or the
 * word: `questionLine` still prints `<id> · from <asker> · abandoned`, because the bare state name
 * comes from `one.request.state`, not from the sentence table. Only the parenthetical explaining
 * *why nothing brings the question back* disappears — the defect `675` (661 F2) fixed and this row
 * guards.
 *
 * ⚑ **So the assertion has to be the sentence itself, scoped to this question's own line** — a
 * `toContain('abandoned')` on the whole answer would still pass with the entry gone, because the
 * word is printed independently of the table.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools — one double, the provider** — same shape
 * as `a-childs-state.test.ts` and `the-word-for-a-question-nobody-stopped.test.ts`.
 */

const migrationsFolder = join(__dirname, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** `394`'s double, with the handles kept — a test has to BE the provider to ask like one. */
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
    this.handles.push(handle)
    return handle
  }
}

describe('675 M20 · abandoned prints why it cannot come back', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: Window
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-675-m20-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-675-m20-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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

  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
  }

  const ledger = (sessionId: string) => store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** A PM in a window with one child of its own, started by a give through the real door (D-016). */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const pmProfile = 'pm-1'
    const workerProfile = 'worker-1'
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const spawned = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work this row is about',
      brief: 'the work this row is about',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    return { pm, worker: spawned.agent as string, pmTools, workerHandle: latestHandle() }
  }

  /** Raise a question on the child and wait for the app to have ROUTED it. */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
  ): Promise<{ id: string }> => {
    const raised = handle.simulateUserInput(prompt, options, false)
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  const lineFor = (text: string, id: string): string =>
    text.split('\n').find((one) => one.includes(id)) ?? ''

  it('🔴 an abandoned question names why it cannot be answered, not just the word', async () => {
    const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
    const asked = await childAsks(worker, workerHandle)

    // ⚠️ Measured BEFORE as well: while the request is still open, nothing in the sentence table
    // applies to it, so its line carries no parenthetical at all — the fixture's own control.
    const before = lineFor(await textOf(pmTools, 'list_questions'), asked.id)
    expect(before).toContain('open')
    expect(before).not.toContain('cannot be answered')

    // ⛔ Stops the conversation that raised the question. ⚑ **D-017 · R3/R4 — nothing ends a
    // conversation any more, and a stop abandons only what its own PROVIDER holds**: this question
    // is the worker's provider's (`simulateUserInput`), so the stop settles it as `abandoned`
    // (`675`, `661` F2), never `interrupted` — the provider's request stopped with the process, and
    // *ask it again* would be the wrong advice. The app's own close is the stop every such path
    // shares (a person's Close, a quit).
    await host.close(worker, THE_APP_ITSELF)

    // ⚑ A question that is over is listed when asked for.
    const after = await callOn(pmTools, 'list_questions', { state: 'all' })
    const rows = after.questions as { question: string; state: string }[]
    expect(rows.find((one) => one.question === asked.id)?.state).toBe('abandoned')

    const line = lineFor(await textOf(pmTools, 'list_questions', { state: 'all' }), asked.id)
    expect(line).toContain('abandoned')
    // 🔴 **The sentence, by name** (standing rule 5): a reader that sees only `abandoned` is left to
    // guess whether the question comes back. It does not, and this is the fact that says so.
    expect(line).toContain(
      '(the conversation that raised it stopped while it was waiting, and the request stopped with it, so it cannot be answered)',
    )
    expect(line).not.toContain('ask it again')
    expect(pm).toBeTruthy()
  })
})
