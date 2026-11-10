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
import type { AgentToolAnswer, AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { TOOL_NAMES, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('two sentences that name a door', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-644-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-644-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const askFor = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    (await askFor(toolset, name, args)).structured as Record<string, unknown>

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  const aParentAndTheChildItSpawned = async (): Promise<{
    parent: string
    child: string
    parentTools: AgentToolset
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const parent = await personOpens(DEFAULT_PROFILE_ID)
    const parentTools = theToolsetJustHandedOut()
    const given = await callOn(parentTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { parent, child: given.agent as string, parentTools }
  }

  describe('the empty listing', () => {
    it('the listing still names the caller once it has stopped, and, empty, it names the roster', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      expect(await idsListedBy(tools)).toEqual([brobot])

      await host.close(brobot, window)
      expect(await idsListedBy(tools)).toEqual([brobot])

      host.agentsVisibleTo = () => ({ agents: [], notListed: 0 })
      const alone = await askFor(tools, 'list_agents', {})
      expect((alone.structured as { count: number }).count).toBe(0)
      expect(alone.text).toContain('list_profiles names every agent this app holds')
    })
  })

  describe('the refusal names a door', () => {
    it('a child this caller spawned and ended is still reachable', async () => {
      const { parent, child, parentTools } = await aParentAndTheChildItSpawned()
      expect(await idsListedBy(parentTools)).toContain(child)

      await host.close(child, THE_APP_ITSELF)
      await waitFor(async () => !host.sessionIds.includes(child), 'the child’s teardown to finish')
      expect(await idsListedBy(parentTools)).toContain(child)

      const sent = await askFor(parentTools, 'message_agent', {
        agent: child,
        text: 'are you there',
        kind: 'note',
      })
      expect(sent.structured, JSON.stringify(sent.structured)).toMatchObject({
        outcome: 'ok',
        agent: child,
      })
      expect(parent).not.toBe(child)
    })

    it('it names two doors and promises nothing about the id it just declined', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()
      const ghost = 'sess_nobody_ever_opened'

      const refused = await askFor(tools, 'message_agent', {
        agent: ghost,
        text: 'hello',
        kind: 'note',
      })
      const payload = refused.structured as {
        rail: string
        permanence: string
        retryable: boolean
        remedy: string | null
        reason: string
      }

      expect(payload.reason).toContain('list_agents names the ones you can reach')
      expect(payload.reason).toContain('list_profiles names every agent this app holds')

      expect(payload.reason).not.toContain(ghost)
      expect([payload.permanence, payload.retryable, payload.remedy]).toEqual([
        'permanent',
        false,
        null,
      ])

      expect(payload.reason).toContain(
        'no conversation you can reach goes by that id or piece label, so nothing was done.',
      )
    })

    it('both doors are in this refused caller’s own toolset, and neither refuses it', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()

      const refused = await askFor(tools, 'message_agent', {
        agent: 'sess_nobody_ever_opened',
        text: 'hello',
        kind: 'note',
      })
      const said = (refused.structured as { reason: string }).reason

      for (const door of ['list_agents', 'list_profiles'] as const) {
        expect(said, `the sentence does not name ${door}`).toContain(door)
        expect(TOOL_NAMES as readonly string[], `${door} left the roster`).toContain(door)
        expect(
          tools.tools.map((one) => one.name),
          `${door} is not in the refused caller's toolset`,
        ).toContain(door)
        expect(
          (await callOn(tools, door, {})).outcome,
          `${door} refused the caller its sentence sent there`,
        ).toBe('ok')
      }
    })
  })
})
