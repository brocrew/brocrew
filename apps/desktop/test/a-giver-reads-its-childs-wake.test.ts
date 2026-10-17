import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 F080 — a giver reads its child's wake, through the tools a model calls
 *
 * `state-a-supervisor-can-trust.test.ts` reads a wake whose ledger holds nothing but its opening.
 * These read one that followed its background work, through `read_transcript` and `list_tasks`:
 *
 *  - §1 · `read_transcript`'s words: the wake is its own turn, after the provider's own summaries —
 *    the newest five as a block, and how many there were when there were more; its payload carries
 *    every summary, and no `received`;
 *  - §2 · the last exchange in both tools' payloads says *since then its provider started a turn*,
 *    and the words say *latest words*, never *words back* — and neither does, before the wake.
 *
 * ⚑ Real host, real SQLite ledger, real toolsets; the provider is the Fake. The wake's rows are
 * planted in the child's ledger the way the machine writes them (`provider_turn`, its words, its
 * `turn` row), after the brief's own turn has ended.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('F080 · a giver reads its child’s wake', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly order: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let order: AgentToolset[]
  let counter: number
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f080-wake-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f080-wake-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    order = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, order, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
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

  const personOpens = async (profileId: string): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  const call = async (
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

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  const turnsEnded = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  /** ⚑ Let the brief's turn, parked on its card in `ask`, finish. */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    await waitFor(() => cards(sessionId).length > 0, 'a card to answer')
    try {
      host.claimSession(sessionId, window)
    } catch (error) {
      const why = (error as { cause?: { unavailable?: string } }).cause?.unavailable
      if (why !== 'already-open') throw error
    }
    await host.respondPermission(
      sessionId,
      cards(sessionId).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
  }

  /** ⚑ A row planted by hand at the end of a ledger — the way the machine and the host write it. */
  const plant = (sessionId: string, event: TranscriptEvent): void => {
    const next =
      (
        db
          .prepare(`SELECT MAX(ordinal) AS max FROM events WHERE session_id = ?`)
          .get(sessionId) as { max: number | null }
      ).max ?? 0
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    ).run(
      `evt_f080_${sessionId}_${String(next + 1)}`,
      sessionId,
      next + 1,
      event.type,
      JSON.stringify(event),
      1,
    )
  }

  const backgroundEnded = (n: number): TranscriptEvent =>
    ({
      type: 'background_work',
      ended: {
        id: `b${String(n)}`,
        outcome: 'completed',
        summary: `Background command "job ${String(n)}" completed (exit code 0)`,
      },
      source: 'task_notification',
    }) as TranscriptEvent

  /** ⚑ A PM a person opened, and a worker it gave a piece to — the brief's turn over. */
  const aPmAndItsWorker = async () => {
    await host.close((await personOpens('worker')).id, window)
    const pm = await personOpens('pm')
    const given = await call(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the index',
      brief: 'build it',
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const worker = given.structured.agent as string
    const label = given.structured.label as string
    await letTheTurnFinish(worker)
    await waitFor(() => turnsEnded(worker) === 1, 'the brief’s turn to end')
    return { pm, worker, label }
  }

  /** ⚑ The wake: `summaries` background endings, then its opening, its words, its ending. */
  const theWake = (worker: string, summaries: number, said: string | null): void => {
    for (let n = 1; n <= summaries; n++) plant(worker, backgroundEnded(n))
    plant(worker, { type: 'provider_turn' })
    if (said !== null) plant(worker, { type: 'assistant_message', text: said })
    plant(worker, { type: 'turn', state: 'completed', startedBy: 'the-provider' })
  }

  describe('§1 · `read_transcript` — the wake is its own turn, after what its provider said ended', () => {
    it('🔴 seven endings: the newest five as a block, and the count said — the payload carries all seven', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      theWake(worker, 7, 'woke and checked the jobs')
      const read = await call(pm.tools, 'read_transcript', { agent: worker })

      const shown = [3, 4, 5, 6, 7]
        .map((n) => `Background command "job ${String(n)}" completed (exit code 0)`)
        .join('\n')
      expect(read.text).toMatch(
        /Turn \d+, which its provider started by itself after its background work ended \(the last 5 of 7\):/,
      )
      expect(read.text).toContain(`(the last 5 of 7):\n\n${shown}\n\n`)
      expect(read.text, 'an ending older than the newest five was quoted').not.toContain('"job 1"')
      expect(read.text).not.toContain('"job 2"')
      expect(read.text).toMatch(/ said:\nwoke and checked the jobs/)

      const turns = read.structured.turns as Record<string, unknown>[]
      const wake = turns.at(-1)
      expect(wake).toMatchObject({
        started_by_its_provider: {
          after: [1, 2, 3, 4, 5, 6, 7].map(
            (n) => `Background command "job ${String(n)}" completed (exit code 0)`,
          ),
        },
        said: { text: 'woke and checked the jobs' },
      })
      expect(wake, 'a wake named a message that opened it').not.toHaveProperty('received')
      // ⚑ The turn before it is the brief's, and names what it received.
      expect(turns.at(-2)).toHaveProperty('received')
    })

    it('⚑ the control — five endings: all five, and no count', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      theWake(worker, 5, 'woke')
      const read = await call(pm.tools, 'read_transcript', { agent: worker })
      const all = [1, 2, 3, 4, 5]
        .map((n) => `Background command "job ${String(n)}" completed (exit code 0)`)
        .join('\n')
      expect(read.text).toContain(`after its background work ended:\n\n${all}\n\n`)
      expect(read.text).not.toContain('(the last ')
    })

    it('⚑ none in the record, and nothing said: it says no message opened it, and that it said nothing', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      theWake(worker, 0, null)
      const read = await call(pm.tools, 'read_transcript', { agent: worker })
      expect(read.text).toMatch(
        /Turn \d+, which its provider started by itself; no message opened it\./,
      )
      expect(read.text).toMatch(/ said nothing in it\./)
      const wake = (read.structured.turns as Record<string, unknown>[]).at(-1)
      expect(wake).toEqual({ started_by_its_provider: { after: [] }, said: null })
    })
  })

  describe('§2 · the last exchange, in both tools, after the wake', () => {
    it('🔴 since then its provider started a turn: said in `read_transcript` and `list_tasks`, and its words are its latest', async () => {
      const { pm, worker, label } = await aPmAndItsWorker()

      // ⚑ The control first: before the wake, the exchange is an answer, and says nothing more.
      const before = await call(pm.tools, 'read_transcript', { agent: worker })
      expect(before.structured.last_exchange).not.toHaveProperty(
        'since_then_its_provider_started_a_turn',
      )
      expect(before.text).toContain('latest words back:')
      expect(before.text).not.toContain('Since then, ')
      const listedBefore = await call(pm.tools, 'list_tasks', { piece: label })
      expect(listedBefore.structured.last_exchange).not.toHaveProperty(
        'since_then_its_provider_started_a_turn',
      )

      theWake(worker, 1, 'the job finished, and I checked it')

      const after = await call(pm.tools, 'read_transcript', { agent: worker })
      expect(after.structured.last_exchange).toMatchObject({
        answer: { text: 'the job finished, and I checked it' },
        since_then_its_provider_started_a_turn: true,
      })
      expect(after.text).toMatch(/Since then, [^\n]*'s provider started a turn by itself\./)
      expect(after.text).toMatch(/'s latest words:\nthe job finished, and I checked it/)
      expect(after.text, 'a wake’s words were called an answer').not.toContain('latest words back:')

      const listed = await call(pm.tools, 'list_tasks', { piece: label })
      expect(listed.structured.label, JSON.stringify(listed.structured)).toBe(label)
      expect(listed.structured.last_exchange).toMatchObject({
        since_then_its_provider_started_a_turn: true,
      })
    })
  })
})
