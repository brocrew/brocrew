import { ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/** One list orders running and stopped conversations by recent activity. */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
describe('D-017 · one list, newest activity first, wherever it is read', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-onelist-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-onelist-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = Date.UTC(2030, 0, 1)
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

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation. */
  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  /** ⚑ **The raw order `list_agents` hands back** — unsorted, because §1 is about that order. */
  const agentsInOrder = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · list_agents sorts by activity, running and stopped merged into one sequence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · list_agents: newest activity first, running and stopped merged', () => {
    /**
     * 🔴 **The sort itself, unsorted** — every existing test that reads `list_agents`' output
     * compares it through `idsListedBy`'s own `.sort()`, so a reversed comparator in
     * `conversationsVisibleTo` survives the whole suite up to this file. ⚑ **The pre-close read is
     * its own positive control**: the two reads below disagree only in `worker1`'s position, so an
     * assertion the sort could satisfy by coincidence would have to coincide twice.
     */
    it("list_agents orders newest activity first, and closing an older conversation moves it back to the front of a running one's", async () => {
      // ⚑ **BroBot opens first** — `canMessage: 'any'` is the ruled default (549), so nothing here
      // narrows or widens a grant; the whole test is about ORDER.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = theToolsetJustHandedOut()
      // ⛔ **Strict sequence.** Each `personOpens` call advances the shared clock (`tick`), so
      // creation order is a strictly increasing `updatedAt` — worker3 is the newest thing this app
      // has recorded the moment it opens.
      const worker1 = await personOpens('worker1')
      const worker2 = await personOpens('worker2')
      const worker3 = await personOpens('worker3')

      // ⚑ **THE BASELINE** — the caller's own conversation first (`5bb7ff7f`: the cap must never cut
      // *including your own*), then creation order, newest first, all four running.
      expect(await agentsInOrder(brobotTools)).toEqual([brobot, worker3, worker2, worker1])

      // 🔴 **worker1 stops** — the last write this store sees before the second read.
      await host.close(worker1, window)

      // ⛔ **worker1 jumps to the front of the others.** Stopping is activity: a stopped conversation is read off
      // the same walk as a running one (D-017 R2/R12), sorted by the same clock — not appended at
      // the end of the list, and not dropped back to its creation-order slot.
      expect(await agentsInOrder(brobotTools)).toEqual([brobot, worker1, worker3, worker2])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a stopped conversation is refused by REACH, never folded into no-such-agent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /** Two callers differ in message reach; both may read the stopped target. */
  const twoCallersAndOneTarget = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    explorer: string
    explorerTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const explorer = await personOpens('explorer')
    const explorerTools = theToolsetJustHandedOut()
    // Narrow messaging without narrowing the readers.
    expect(store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
    expect(store.parentOf(manager)).toBeNull()
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }

  describe('§3 · stopped conversations remain readable', () => {
    it('a stopped conversation remains readable when messaging is narrowed', async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()

      // 🔴 **The target stops.**
      await host.close(manager, window)

      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      const said = await callOn(explorerTools, 'message_agent', {
        agent: manager,
        text: 'anything at all',
        // ⚑ **D-016 · a note** — a follow-up names a piece the sender gave, and this caller gave none.
        kind: 'note',
      })
      expect(said).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
      expect(said['detail']).toStrictEqual({ reach: 'none' })
      expect(await idsListedBy(explorerTools)).toContain(manager)

      // ⚑ **THE PAIRED POSITIVE — the granted caller, over the identical stopped id.**
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      expect(await idsListedBy(brobotTools)).toContain(manager)
    })
  })
})
