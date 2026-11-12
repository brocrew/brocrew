import { ToolWatchingRuntime } from './lib/provider-double'
import { neutralHostDeps, syntheticProviderHome, fixtureProviderConfig } from './lib/host-fixture'
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
import type { ExternalMcpServerRow } from '../src/shared/external-mcp'
import type { IdentityUse } from '../src/shared/agent-roster'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { providerForALaunch } from '../src/renderer/src/lib/agent-store'
import { providerTakesEffectNextTime } from '../src/renderer/src/lib/front-door-words'
import {
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
  SEEDED_PROVIDERS,
  providerName,
  seededProviderFor,
  type AgentIdentity,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'

const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class NobodyThere extends RecordingSink {
  override readonly aPersonIsBehindIt = false
}

describe('433 §A · the provider a person can change', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-provider-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-provider-root-'))
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

  const ask = (
    command: Parameters<typeof executeRuntimeCommand>[2],
    sink: RuntimeEventSink = window,
  ): Promise<unknown> => executeRuntimeCommand(host, sink, command)

  const personOpens = async (profileId: string, provider: Provider = 'claude'): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider,
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

  const chooseFor = (profileId: string, provider: Provider | null): Promise<unknown> =>
    ask({ kind: 'setAgentProvider', profileId, provider })

  const sessionProvider = (sessionId: string): unknown =>
    (
      db.prepare('SELECT provider FROM provider_session WHERE id = ?').get(sessionId) as
        { provider: string } | undefined
    )?.provider ?? null

  const providerColumn = (slug: string): unknown =>
    (
      db.prepare('SELECT provider FROM agent_identity WHERE slug = ?').get(slug) as
        { provider: string | null } | undefined
    )?.provider ?? null

  const rowCount = (slug: string): unknown =>
    db.prepare('SELECT count(*) AS n FROM agent_identity WHERE slug = ?').get(slug)

  const aProjectManagerSomebodyCreated = (): AgentIdentity => {
    const made = host.createAgent({
      slug: PROJECT_MANAGER_PROFILE_ID,
      displayName: null,
      provider: null,
    })
    expect(rowCount(PROJECT_MANAGER_PROFILE_ID)).toEqual({ n: 1 })
    expect(made.provider).toBeNull()
    return made
  }

  describe('§1 · a person says what the NEXT conversation starts on', () => {
    it('🔴 the next conversation takes the new default, and the running one does not move', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const brobotTools = theToolsetJustHandedOut()
      aProjectManagerSomebodyCreated()

      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      const inherited = (await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'the first child',
        brief: 'the first child',
      })) as { agent: string; outcome: string }
      expect(inherited.outcome, JSON.stringify(inherited)).toBe('ok')
      expect(sessionProvider(inherited.agent)).toBe('claude')
      await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const secondParentTools = theToolsetJustHandedOut()

      const saved = (await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'codex')) as AgentIdentity | null
      expect(saved?.provider).toBe('codex')
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBe('codex')

      const chosen = (await callOn(secondParentTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'the second child',
        brief: 'the second child',
      })) as { agent: string; outcome: string }
      expect(chosen.outcome, JSON.stringify(chosen)).toBe('ok')
      expect(sessionProvider(chosen.agent)).toBe('codex')

      expect(sessionProvider(brobot)).toBe('claude')
      expect(host.agentCard(brobot)?.provider).toBe('claude')
      expect(host.sessionIds).toContain(brobot)
      expect(sessionProvider(inherited.agent)).toBe('claude')
    })

    it('⛔ clearing it hands the identity back to what it would have followed', async () => {
      await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const brobotTools = theToolsetJustHandedOut()
      aProjectManagerSomebodyCreated()
      expect(
        (await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'codex')) as AgentIdentity | null,
      ).toMatchObject({
        provider: 'codex',
      })

      const cleared = (await chooseFor(PROJECT_MANAGER_PROFILE_ID, null)) as AgentIdentity | null
      expect(cleared?.provider).toBeNull()
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()

      const child = (await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'after clearing',
        brief: 'after clearing',
      })) as { agent: string; outcome: string }
      expect(child.outcome, JSON.stringify(child)).toBe('ok')
      expect(sessionProvider(child.agent)).toBe('claude')
    })

    it('⛔ an identity with no row answers null, and no row is created', async () => {
      expect(await chooseFor('nobody-has-run-as-this', 'codex')).toBeNull()
      expect(
        db
          .prepare('SELECT count(*) AS n FROM agent_identity WHERE slug = ?')
          .get('nobody-has-run-as-this'),
      ).toEqual({ n: 0 })
    })

    it('⛔ a channel with nobody behind it is refused by name, and writes nothing', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      await expect(
        ask(
          { kind: 'setAgentProvider', profileId: DEFAULT_PROFILE_ID, provider: 'codex' },
          new NobodyThere('agent:sess_1'),
        ),
      ).rejects.toThrow(noPersonBehindIt('setAgentProvider'))
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      expect((await chooseFor(DEFAULT_PROFILE_ID, 'codex')) as AgentIdentity | null).toMatchObject({
        provider: 'codex',
      })
    })

    it('⚑ what a launch as this identity would run on follows the column, through one function', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      aProjectManagerSomebodyCreated()
      const roster = (): {
        identities: AgentIdentity[]
        foldersWithoutARow: string[]
        use: readonly IdentityUse[]
        spawningEnabled: boolean
        defaultApprovalMode: 'ask' | 'auto'
        externalMcpServers: readonly ExternalMcpServerRow[]
      } => host.agentIdentities() as never
      expect(providerForALaunch(roster(), PROJECT_MANAGER_PROFILE_ID, 'codex')).toBe('codex')
      await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'claude')
      expect(providerForALaunch(roster(), PROJECT_MANAGER_PROFILE_ID, 'codex')).toBe('claude')
    })
  })

  describe('§2 · a first-run convenience, and standing rule 11', () => {
    it('⚑ a first launch mints the seeded default, and every other identity says nothing', async () => {
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      expect(providerColumn(DEFAULT_PROFILE_ID)).not.toBe('codex')
      await personOpens('explorer', 'codex')
      expect(providerColumn('explorer')).toBeNull()
      expect(seededProviderFor('explorer')).toBeNull()
      expect(seededProviderFor(DEFAULT_PROFILE_ID.toUpperCase())).toBe(
        seededProviderFor(DEFAULT_PROFILE_ID),
      )
    })

    it('🔴 a person creating BroBot and naming a provider is not overruled by the seed', () => {
      const made = store.createAgentIdentity(
        {
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          provider: 'codex',
        },
        { by: 'a-person' },
      )
      expect(made?.provider).toBe('codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe('codex')
      expect(seededProviderFor(DEFAULT_PROFILE_ID)).not.toBe('codex')
    })

    it('🔴 a launch takes the seed; a person who picks *nobody has said* keeps it', async () => {
      const made = store.createAgentIdentity(
        {
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )
      expect(made?.provider).toBeNull()
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()

      await personOpens(PROJECT_MANAGER_PROFILE_ID, 'codex')
      expect(rowCount(PROJECT_MANAGER_PROFILE_ID)).toEqual({ n: 1 })
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).not.toBe('codex')
      expect(seededProviderFor(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      const seeded = seededProviderFor(DEFAULT_PROFILE_ID)
      expect(seeded, 'nothing is seeded, so this pair measures nothing').not.toBeNull()
      expect(SEEDED_PROVIDERS.map((seed) => seed.slug)).toEqual([DEFAULT_PROFILE_ID])
    })

    it('🔴 a person who clears the seed is not re-granted it by the next launch', async () => {
      const first = await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      expect(await chooseFor(DEFAULT_PROFILE_ID, null)).toMatchObject({ provider: null })
      await host.close(first, window)

      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()

      store = createSessionStore(db, tick)
      host = buildHost()
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
    })
  })

  describe('§4 · the app SAYS that changing it means a new conversation', () => {
    it('⛔ every clause of it, and the provider named the way a person reads it', () => {
      for (const provider of Object.keys(PROVIDER_NAME) as Provider[]) {
        const said = providerTakesEffectNextTime(provider)
        expect(said).toContain(providerName(provider))
        expect(said, 'the wire id reached a sentence a person reads').not.toContain(provider)
        expect(said).toContain('starts nothing and moves nothing')
        expect(said).toContain('keeps the provider it began on')
      }
      expect(providerTakesEffectNextTime('claude')).not.toBe(providerTakesEffectNextTime('codex'))
    })
  })
})
