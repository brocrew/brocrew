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
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-016a · the pieces a giver handed out read back in the order a person quotes them
 *
 * ⚑ **The rule.** A giver's pieces live in their OWNERS' ledgers, one ledger per helper, and the
 * store reads them by visiting each conversation the `work` table names as given work by that
 * giver. ⛔ **The candidate query has no `ORDER BY`** — it is a `SELECT DISTINCT` over the `work`
 * rows naming that giver (`work_given_by_idx`) — so the order the owners come back in is an accident
 * of the plan. What makes the list the sequence a person says out loud (*"W3.2 first, then W3.3"*)
 * is the sort, and that sort is the whole of this file.
 *
 * ⚠️ **Why a fixture with one piece per helper cannot see it.** With one piece per helper the
 * concatenation of the ledgers IS in order whatever order the helpers come back in. ⛔ **The
 * divergence needs a helper that holds two pieces with another helper's piece numbered BETWEEN
 * them**: `A W3.1`, `B W3.2`, `A W3.3`. Concatenated per ledger that reads `.1, .3, .2` (helpers
 * visited A then B) or `.2, .1, .3` (B then A) — and neither is sorted, so this fixture fails under
 * the sort's removal whichever order the plan happens to give.
 *
 * ⚑ **D-016 · a busy helper still takes a piece** (the stall rule refuses only one whose turn ended
 * or was stopped with a piece open), so `A` is given its second piece while its first is still
 * open — parked on the card its brief raised in `ask` mode — and the second is held for it.
 *
 * 🔴 **Nothing is constructed.** A real `RuntimeHost` over a real SQLite ledger, real tools, the
 * fake provider; the work is given through `give_work` and read back through the store's own
 * `piecesGivenBy` and through `list_tasks`, which is the door an agent quotes the label from.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

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

describe('D-016a · a giver reads its pieces back in the order they were numbered', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: Window
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016a-order-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d016a-order-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    store = createSessionStore(db, tick)
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
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ A PM a person opened, and its own root's label — every piece it gives hangs under it. */
  const aPm = async (): Promise<{ pm: string; root: string; pmTools: AgentToolset }> => {
    await bringIdentityIntoBeing('worker-a')
    await bringIdentityIntoBeing('worker-b')
    const pm = await personOpens('pm')
    const pmTools = handed.at(-1)
    if (pmTools === undefined) throw new Error('no toolset was handed to the pm')
    const root = store.rootOf(pm)?.label
    if (root === undefined) throw new Error('the pm owns no root')
    return { pm, root, pmTools }
  }

  /**
   * ⚑ **A piece given through the one verb that gives**, answered with the conversation it reached
   * and its label. `worker-a` is given its first piece before `worker-b` is given any, so `A`'s
   * conversation is started first and its first piece is the earliest row — every plan that could
   * visit the helpers in a stable order visits `A` first, and the fixture is still red when it
   * visits `B` first.
   */
  const gives = async (
    pmTools: AgentToolset,
    profile: string,
    brief: string,
  ): Promise<{ owner: string; label: string }> => {
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { owner: given.agent as string, label: given.label as string }
  }

  const labelsOf = (rows: readonly { readonly label: string }[]): string[] =>
    rows.map((row) => row.label)

  it('🔴 A .1, B .2, A .3 — the giver reads .1, .2, .3, though no ledger holds them in that order', async () => {
    const { pm, root, pmTools } = await aPm()

    const first = await gives(pmTools, 'worker-a', 'the first piece, to the first worker')
    const second = await gives(pmTools, 'worker-b', 'the second piece, to the second worker')
    // ⚑ **The same conversation, busy on its first piece** — the give finds the one it has and holds
    // the brief for it: a helper that is working takes more (D-016 · the stall rule).
    const third = await gives(pmTools, 'worker-a', 'the third piece, back to the first worker')
    const a = first.owner
    const b = second.owner
    expect(third.owner).toBe(a)
    expect(b).not.toBe(a)
    expect([first.label, second.label, third.label]).toEqual([
      `${root}.1`,
      `${root}.2`,
      `${root}.3`,
    ])

    // ⛔ **The control, and it is what gives the assertion below its meaning.** Each helper's own
    // ledger reads in its own order — `A` holds .1 and .3, `B` holds .2 — so no single ledger, and
    // no concatenation of them in either visiting order, is .1, .2, .3. ⚠️ Without this the fixture
    // could pass because every ledger happened to be in order already.
    expect(labelsOf(store.piecesOwnedBy(a))).toEqual([`${root}.1`, `${root}.3`])
    expect(labelsOf(store.piecesOwnedBy(b))).toEqual([`${root}.2`])

    // 🔴 **The store's own reader** — `piecesGivenBy`, the source of `list_tasks`' given half and of
    // every wait read. ⛔ The sequence a person quotes, whatever order the plan visited the helpers
    // in.
    const read = store.piecesGivenBy(pm)
    expect(labelsOf(read)).toEqual([`${root}.1`, `${root}.2`, `${root}.3`])
    expect(read.map((row) => row.owner)).toEqual([a, b, a])

    // 🔴 **…and the door an agent reads the label from.** `list_tasks` composes the same list, so
    // *"W3.2"* comes before *"W3.3"* in what the giver is told.
    const listed = (await callOn(pmTools, 'list_tasks', {})) as {
      you_gave: { label: string }[]
    }
    expect(labelsOf(listed.you_gave)).toEqual([`${root}.1`, `${root}.2`, `${root}.3`])
  })

  it('⚑ the positive beside it — a giver whose pieces all sit in ONE ledger reads them in order too', async () => {
    const { pm, root, pmTools } = await aPm()

    const first = await gives(pmTools, 'worker-a', 'the first piece')
    const second = await gives(pmTools, 'worker-a', 'the second piece')
    expect(second.owner).toBe(first.owner)

    // ⚠️ **One helper, so there is nothing to interleave** — this arm passes with the sort and
    // without it, and says so: the divergence above is the multi-ledger one and only that one.
    expect(labelsOf(store.piecesGivenBy(pm))).toEqual([`${root}.1`, `${root}.2`])
    expect(labelsOf(store.piecesOwnedBy(first.owner))).toEqual([`${root}.1`, `${root}.2`])
  })
})
