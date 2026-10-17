import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
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
import { resourcesRoot } from '../src/main/resources/resources'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 676 M13 — the plates' own wait read must count a row no OTHER reader meets
 *
 * ## ⛔ What the row's own words no longer reach, post-D-017
 *
 * ⚑ **M13 planted `oneWaitReadPerAnswer`'s `unread` argument to `undefined`** and its label reads
 * a torn QUESTION row into `waiting on nothing`. ⛔ **That premise died with the refactor that gave
 * `oneWaitReadPerAnswer` a SEPARATE `ledger` argument** (`whatEachConversationIsWaitingOn` now
 * builds `ledger = oneLedgerReadPerAnswer(unread)` on the REAL `unread` and hands it in beside the
 * planted one) — every question-row read runs through that `ledger`, never through the argument the
 * plant tears out, so a torn `user_input_request` row is counted correctly whether or not this row's
 * edit is applied, and nothing here can tell the two apart by planting one.
 *
 * ## ⚑ What the SAME edit still breaks
 *
 * 🔴 **The `unread` argument the plant tears out is still the ONE thing `piecesGivenBy(id, unread)`
 * takes inside `oneWaitReadPerAnswer`'s own `childrenOpen` computation** (D-016: it was
 * `tasksAssignedBy` inside `aWorker`) — the wait read's own scan of every child a conversation gave
 * work to. ⛔ **For a child that is still an open conversation this app is running, its own
 * `piecesOwnedBy` read (built on the REAL `unread`, untouched by the plant) meets the same torn row a
 * second time and counts it anyway** — which is why `apps/desktop/test/
 * the-rest-of-r18-and-the-answer-with-no-bound.test.ts` §3 stays green under this plant. ⚑ **But a
 * child this app CLOSED is not in that walk at all** (`whatEachConversationIsWaitingOn`'s own
 * `runningStateOf(conversation) === 'not-running'` gate returns `[]` before `piecesOwnedBy` is ever
 * called) — so the wait read's own scan is the ONLY reader left standing over a torn row in a
 * closed child's ledger, and planting `undefined` there is exactly what silences it.
 *
 * ⚠️ **`list_tasks` still counts it** (the PM's `you_gave` half is `pieceBoard`'s own
 * `piecesGivenBy(pm, unread)` — a different door, a different `unread`), so the divergence this
 * file pins is the SAME shape the row's title names: *the plates' wait reads count into nobody*,
 * while the answer beside them still says the truth. ⚑ **D-016** took `list_projects`, the reader
 * `676` first set beside the plates; `list_tasks` is the one left that reads the same work given
 * out on its own `unread`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A row the ledger cannot parse — the whole of what "torn" means here. */
const TORN = '{not json'

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

/** ⚑ `the-rest-of-r18…`'s own double: a test has to BE the provider to answer its tool calls. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('676 M13 · a closed child’s torn assignment is missed by the plates alone', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m13-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m13-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_760_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
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
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      structured: (answered.structured ?? {}) as Record<string, unknown>,
      text: answered.text,
    }
  }

  /**
   * A PM in a window with one child of its own, given work through the one verb an agent has — ⚑
   * D-016 · `give_work`, which starts the child and whose brief is its first turn.
   */
  const aPmAndItsWorker = async (
    brief: string,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief,
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const worker = given.structured.agent as string
    if (store.piecesOwnedBy(worker).at(-1) === undefined) throw new Error('the give wrote no piece')
    return { pm, worker, pmTools }
  }

  /** ⛔ A torn row of `type`, planted in `sessionId`'s active generation past anything written. */
  const plantTorn = (sessionId: string, type: string, ordinal: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    ).run(`evt_torn_${sessionId}_${String(ordinal)}`, sessionId, ordinal, type, TORN, tick())
  }

  /** The two readers `676` gave a count: the PM's `list_tasks`, and the Team plates’/rail’s own read. */
  const twoCounts = async (
    pmTools: AgentToolset,
  ): Promise<{ listTasks: unknown; plates: unknown }> => {
    const listed = await call(pmTools, 'list_tasks', {})
    return {
      listTasks: listed.structured.rows_unread,
      plates: host.whatEachConversationIsWaitingOn().rowsUnread,
    }
  }

  it('⚑ THE CONTROL: nothing torn, worker still open — both readers carry 0', async () => {
    const { pmTools } = await aPmAndItsWorker('build it')
    expect(await twoCounts(pmTools)).toEqual({ listTasks: 0, plates: 0 })
  })

  it('⚑ the positive: a torn assignment in a STILL-OPEN worker is met twice, and both readers carry 1', async () => {
    const { worker, pmTools } = await aPmAndItsWorker('build it')
    // ⚠️ **The worker is left running** — its own `piecesOwnedBy` read meets this row too, on the
    // REAL `unread`, so both readers answer even while the wait read's own scan is planted elsewhere.
    plantTorn(worker, 'work_given', 90_000)
    expect(await twoCounts(pmTools)).toEqual({ listTasks: 1, plates: 1 })
  })

  it('🔴 the kill: a torn assignment in a CLOSED worker is met ONLY by the wait read’s own scan — `list_tasks` still counts 1, the plates must too', async () => {
    const { worker, pmTools } = await aPmAndItsWorker('build it')
    // ⚑ **Take the worker over, then close it** — `runningStateOf(worker)` is now `not-running`, so
    // `whatEachConversationIsWaitingOn`'s own walk never calls `piecesOwnedBy(worker, …)`: the ONLY
    // reader left that can meet a torn row in its ledger is `oneWaitReadPerAnswer`'s `childrenOpen`
    // scan over the PM, `piecesGivenBy(pm, unread)` — the very read this row plants `undefined` into.
    host.claimSession(worker, window)
    await host.close(worker, window)
    plantTorn(worker, 'work_given', 90_000)
    // ⛔ **`list_tasks` is a different door, on its own `unread`** (`pieceBoard`'s own
    // `piecesGivenBy(pm, unread)`), so it answers 1 regardless of what this row plants — a closed
    // worker's work still shows in the PM's `you_gave`, and the torn row it left behind is still
    // counted there.
    const listed = await call(pmTools, 'list_tasks', {})
    expect(listed.structured.rows_unread).toBe(1)
    // 🔴 **And the plates must carry the SAME 1** — on clean code they do (`oneWaitReadPerAnswer`'s
    // `unread` reaches `piecesGivenBy`); under 676 M13's plant, `unread` is torn out at exactly
    // this call and `piecesGivenBy(pm, undefined)` silently stops noting the row it still, quite
    // correctly, excludes from the count — so the plates say every row was read when one was not.
    expect(host.whatEachConversationIsWaitingOn().rowsUnread).toBe(1)
  })
})
