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
import type { CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-017 · one list, sorted by activity, wherever it is read.**
 *
 * ⛔ **`conversationsVisibleTo` is the one walk behind `list_agents` and `get_agent_status`'s
 * reach check** — running and stopped conversations are merged into a single
 * sequence, cut nowhere except the page, and sorted newest-activity-first. Nothing in the existing
 * suite compares that sequence unsorted (every prior assertion calls `.sort()` on the ids before
 * comparing), so the ordering rule itself has no test standing over it — §1 is that test.
 *
 * ⚑ **And the same walk is the reach.** A conversation that stopped is read under the identical
 * `withinMessagingReach` question as a running one, so a caller with a narrow grant must lose it
 * from `get_agent_status` and from the list the moment it stops, and a caller with a wide one must
 * keep it — §3 measures both halves of that over the SAME now-stopped target. ⚠️ §2 measured
 * `list_projects`' fold of the same walk, and went with that tool at D-016.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider — `a-reach-you-can-see.test.ts`'s harness, which §3's fixture is copied from.
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

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
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
}

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

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

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

  /**
   * 🔴 **Copied from `a-reach-you-can-see.test.ts`** — two callers, one target, one grant apart.
   * ⛔ **Nothing here makes anybody command anything**: no `commandedBy`, no shared owner and no
   * spawn between any two of them, so the only thing that can admit an answer is the grant — and,
   * since §3 below stops the target, the only thing that can admit a STOPPED one.
   */
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
    // ⚠️ **The premise, asserted rather than assumed.** ⚑ **`none` since D-016** — the reach
    // vocabulary is `none | any`, and `none` is the one word that leaves a caller out of reach.
    expect(store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
    // ⛔ **And neither COMMANDS it**, which the door that still asks `mayCommand` says for both.
    // ⚑ **D-016 · the parent alone** — nothing started the manager, so nothing is above it.
    expect(store.parentOf(manager)).toBeNull()
    expect((await host.interruptAgent(manager, speakingAs(brobot))).ok).toBe(false)
    expect((await host.interruptAgent(manager, speakingAs(explorer))).ok).toBe(false)
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }

  describe('§3 · a stopped, out-of-reach conversation meets the reach rail, never no-such-agent', () => {
    /**
     * 🔴 **M131's shape, named**: `whyItIsOutOfReach`'s `!this.slots.has(sessionId)` branch only
     * runs for a STOPPED conversation — every out-of-reach case `a-reach-you-can-see.test.ts` §1
     * drives is a RUNNING one, which never enters this branch at all. ⚑ **The granted caller, over
     * the identical stopped id, is the paired positive**: it is not the target having stopped that
     * excludes `explorer`, because `brobot` reaches the very same stopped conversation fine.
     */
    it("a stopped conversation out of the caller's reach is refused the reach rail, not no-such-agent, and is left off that caller's list — the granted caller still reaches it", async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()

      // 🔴 **The target stops.**
      await host.close(manager, window)

      // ⛔ **The narrow caller** — refused by REACH, in the same shape and the same words
      // `message_agent` gives for the identical call, and never `no-such-agent`: the conversation
      // exists, and `05` rule 6 reserves that word for an id no conversation has.
      const refused = await callOn(explorerTools, 'get_agent_status', { agent: manager })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
        permanence: 'until-a-person-changes-it',
        detail: { reach: 'none' },
      })
      expect(refused['rail']).not.toBe('no-such-agent')
      // ⚠️ **All but the detail**: at `none` `message_agent` answers from its argument-independent
      // wall (`486`), before it reads the id, so its detail names the grant and no agent.
      const withoutDetail = (answer: Record<string, unknown>): Record<string, unknown> => ({
        ...answer,
        detail: undefined,
      })
      const said = await callOn(explorerTools, 'message_agent', {
        agent: manager,
        text: 'anything at all',
        // ⚑ **D-016 · a note** — a follow-up names a piece the sender gave, and this caller gave none.
        kind: 'note',
      })
      expect(withoutDetail(said)).toStrictEqual(withoutDetail(refused))
      expect(said['detail']).toStrictEqual({ reach: 'none' })
      expect(await idsListedBy(explorerTools)).not.toContain(manager)

      // ⚑ **THE PAIRED POSITIVE — the granted caller, over the identical stopped id.**
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      expect(await idsListedBy(brobotTools)).toContain(manager)
    })
  })
})
