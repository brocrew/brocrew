import type { SessionInstructions } from '../src/shared/instruction-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type AgentToolset } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { codexDynamicToolsFor } from '../../../packages/runtime/src/codex/agent-tools'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { ToolWatchingRuntime } from './lib/provider-double'

const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('two verbs, one sentence', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-456-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-456-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, sessions),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      readInstructions: () => ({
        instructions: NOTHING_INJECTED,
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const brobotsTools = async (): Promise<AgentToolset> => {
    await host.createSession(
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID, cwd: work, approvalMode: 'ask' },
      window,
    )
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const projectManagersTools = async (): Promise<AgentToolset> => {
    host.createAgent({
      slug: PROJECT_MANAGER_PROFILE_ID,
      displayName: null,
      provider: null,
    })
    await host.createSession(
      { provider: 'codex', profileId: PROJECT_MANAGER_PROFILE_ID, cwd: work, approvalMode: 'ask' },
      window,
    )
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const one = toolset.tools.find((tool) => tool.name === name)
    if (one === undefined) throw new Error(`no such tool: ${name}`)
    return (await one.call(args)).structured as Record<string, unknown>
  }

  describe('§1 · the tool descriptions each provider is sent', () => {
    it('Claude and Codex are sent the same tool descriptions', async () => {
      const toolset = await brobotsTools()
      const fromCodex = codexDescriptions(toolset)
      const fromClaude = await claudeDescriptions(toolset)

      expect(Object.keys(fromCodex).length, 'the Codex reader found no tools').toBeGreaterThan(10)
      expect(Object.keys(fromClaude).length, 'the Claude reader found no tools').toBeGreaterThan(10)

      expect(fromClaude).toEqual(fromCodex)
    })
  })

  describe('§2 · a name made can be given work', () => {
    it('a caller gives work to the name it just made, and not to one nobody made', async () => {
      const tools = await projectManagersTools()

      const created = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      expect(created['outcome'], 'the creation this test is about did not happen').toBe('ok')

      const started = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'The work it was made for',
        brief: 'the work it was made for',
      })
      expect(started['outcome']).toBe('ok')

      const refused = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody-made-this',
        title: 'The work it was made for',
        brief: 'the work it was made for',
      })
      expect(refused['rail']).toBe('no-such-profile')
    })

    it('the creation answer says what happened: named, not running, sent nothing', async () => {
      const tools = await brobotsTools()
      const one = tools.tools.find((tool) => tool.name === 'create_agent')
      const said = (await one!.call({ profile_slug: 'archivist' })).text
      // It says the name this app gave the agent, and does not echo the slug it was sent.
      const archivist = store.agentIdentities().find((agent) => agent.slug === 'archivist')
      const named = archivist?.displayName ?? null
      const opens =
        named === null
          ? 'Created; it goes by its profile name.'
          : `Created; this app named it ${named}.`
      expect(said.startsWith(opens), said).toBe(true)
      expect(said).not.toContain('archivist')
      expect(said).toContain('It is not running and has been sent nothing.')
    })
  })

  describe('§3 · the two inputs', () => {
    it('a give takes a brief; a creation takes rules and no purpose', async () => {
      const toolset = await brobotsTools()
      const give = toolset.tools.find((one) => one.name === 'give_work')
      const create = toolset.tools.find((one) => one.name === 'create_agent')
      expect(Object.keys(give?.input ?? {})).toContain('brief')
      expect(Object.keys(create?.input ?? {})).not.toContain('brief')
      expect(Object.keys(create?.input ?? {})).not.toContain('purpose')
      expect(Object.keys(create?.input ?? {})).toContain('rules')
    })
  })
})

function codexDescriptions(toolset: AgentToolset): Record<string, string> {
  const specs = codexDynamicToolsFor(toolset) as
    { tools: { name: string; description: string }[] }[] | undefined
  if (specs === undefined || specs.length !== 1) throw new Error('no Codex namespace was built')
  return Object.fromEntries(specs[0]!.tools.map((one) => [one.name, one.description]))
}

async function claudeDescriptions(toolset: AgentToolset): Promise<Record<string, string>> {
  const servers = claudeMcpServersFor(toolset)
  const low = (servers?.['brobot'] as { instance: { server: unknown } } | undefined)?.instance
    .server as { connect(transport: unknown): Promise<void> }
  const out: Record<string, unknown>[] = []
  const transport: Record<string, unknown> = {
    start: async () => {},
    send: async (message: Record<string, unknown>) => {
      out.push(message)
    },
    close: async () => {},
  }
  await low.connect(transport)
  const post = (message: unknown): void => {
    ;(transport['onmessage'] as (m: unknown) => void)(message)
  }
  post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  })
  await vi.waitFor(() => expect(out.some((m) => m['id'] === 1)).toBe(true))
  post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  await vi.waitFor(() => expect(out.some((m) => m['id'] === 2)).toBe(true))
  const listed = out.find((m) => m['id'] === 2) as {
    result?: { tools?: { name: string; description: string }[] }
  }
  return Object.fromEntries((listed.result?.tools ?? []).map((one) => [one.name, one.description]))
}

const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}
