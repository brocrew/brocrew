import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # A torn reply in a holder's own ledger is counted by the forest
 *
 * ⚑ **The rule (`453`, `671` R18, kept by D-016a):** the forest folds each drawn conversation's own
 * ledger for the work it HOLDS, and the fold is handed the walk's skip counter — so a row of that
 * ledger it could not parse is skipped AND counted, and `nodes.rowsUnread` says so. ⛔ A fold
 * handed no counter skips the same row exactly as it always has and the forest says zero for a
 * roster whose work is missing a piece.
 *
 * ⚠️ **Why a torn `work_replied` and no other row:** it is a type the piece fold selects
 * (`selectPieceEvents`, D-016) and that NO wait read opens. The wait read of a holder counts its
 * routings, its questions and the pieces it gave — so a torn question is counted by the wait read
 * too, under the same `(ledger, ordinal)` key, and hides a fold that lost its counter. A torn reply
 * is met by the fold alone.
 *
 * ⚑ Measured through the host's own door (`theWholeForest`), over real SQLite and real migrations,
 * with a PM that gave its worker a piece through the real `give_work`; the clean database and a
 * torn row the fold does not select are the controls.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** `373`'s double; its registry is shared so every launch's toolset can be reached. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('a torn reply in a holder’s own ledger is counted by the forest', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-torn-reply-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-torn-reply-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return ((await tool.call(args)).structured ?? {}) as Record<string, unknown>
  }

  /**
   * A PM that has handed its worker one piece of OPEN work, through the real `give_work` — which
   * starts the worker on the piece's brief (D-016). ⚑ In `ask` mode the brief's turn parks on its
   * card, so the piece is still open when the forest is read.
   */
  const aWorkerHoldingOpenWork = async (): Promise<{ pm: string; worker: string }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Build it',
      brief: 'build it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    expect(store.openPiecesOf(worker).map((piece) => piece.label)).toEqual([given.label])
    return { pm, worker }
  }

  /** A row this process never wrote: the payload is not JSON, at an ordinal far past the real ones. */
  const tearARow = (sessionId: string, type: string, ordinal: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, '{not json', ?)`,
    ).run(`evt_torn_${type}_${String(ordinal)}`, sessionId, ordinal, type, tick())
  }

  const theForestsTasks = (): number =>
    host.theWholeForest().nodes.rows.filter((node) => node.node === 'a-task').length

  it('⚑ THE CONTROL: on a clean database the forest draws the open work and counts 0 unread rows', async () => {
    await aWorkerHoldingOpenWork()
    expect(host.theWholeForest().nodes.rowsUnread).toBe(0)
    expect(theForestsTasks()).toBe(1)
  })

  it('🔴 a torn `work_replied` in the holder’s own ledger: the forest ANSWERS, still draws the work, and counts the row', async () => {
    const { worker } = await aWorkerHoldingOpenWork()
    expect(host.theWholeForest().nodes.rowsUnread).toBe(0)
    tearARow(worker, 'work_replied', 90_000)
    const forest = host.theWholeForest()
    // ⛔ **Met by the holder's fold and nothing else**: `selectPieceEvents` selects the type, and no
    // wait read opens it — so a 1 here is the fold's own counter reaching the walk's set, which is
    // what the forest owes a person whose work has a reply the app could not read.
    expect(forest.nodes.rowsUnread).toBe(1)
    // ⚑ **…and a person's surface is not blank**: the reply is unread, so the work is still drawn.
    expect(theForestsTasks()).toBe(1)
    // ⚑ **Three conversations, all drawn**: the one that seeded the worker's profile, the PM, and
    // the worker itself — a torn row in one ledger drops none of them.
    expect(forest.nodes.rows.filter((node) => node.node === 'a-conversation')).toHaveLength(3)
  })

  it('⚑ the same torn row is one row however often it is read, and a second torn reply is a second', async () => {
    const { worker } = await aWorkerHoldingOpenWork()
    tearARow(worker, 'work_replied', 90_000)
    expect(host.theWholeForest().nodes.rowsUnread).toBe(1)
    expect(host.theWholeForest().nodes.rowsUnread).toBe(1)
    tearARow(worker, 'work_replied', 90_001)
    expect(host.theWholeForest().nodes.rowsUnread).toBe(2)
  })

  it('⛔ a torn row of a type the piece fold does not select is met by nobody: the count stays 0', async () => {
    const { worker } = await aWorkerHoldingOpenWork()
    // ⚑ **THE PAIR to the test above**: the same holder, the same open work, the same ordinal and
    // the same torn payload — one fact different, the row's TYPE. ⚠️ A count that rose here would
    // be the forest reading rows it has no business opening.
    tearARow(worker, 'tool_result', 90_000)
    expect(host.theWholeForest().nodes.rowsUnread).toBe(0)
    expect(theForestsTasks()).toBe(1)
  })
})
