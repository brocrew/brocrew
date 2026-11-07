import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  CodexSettingsUnusableError,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
} from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SessionUnavailable, unavailableOf } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('657 · a launch that did not start', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: FakeLaunchGate | null
  let homeFails: Error | null
  const gatesMade: FakeLaunchGate[] = []

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions, ...(gate === null ? {} : { gate }) }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        if (homeFails !== null) throw homeFails
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: fixtureProviderConfig,
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-657-launch-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-657-launch-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    gate = null
    homeFails = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const made of gatesMade.splice(0)) made.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> =>
    (
      await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'ask', cwd: work },
        window,
      )
    ).sessionId

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  let giver = ''

  const aParentThatMaySpawn = async (): Promise<ReturnType<typeof toolsOf>> => {
    await host.close(await personOpens('worker'), window)
    giver = await personOpens(DEFAULT_PROFILE_ID)
    return toolsOf(giver)
  }

  const A_GIVE = {
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'worker',
    title: 'A first piece',
    brief: 'x',
  }

  const piecesUnderTheRoot = (): readonly string[] =>
    store.childrenOf(store.rootOf(giver)?.piece ?? 'no root').map((one) => one.label)

  const holdTheNextLaunch = (): FakeLaunchGate => {
    const made = new FakeLaunchGate()
    gatesMade.push(made)
    gate = made
    return made
  }

  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  it('§1 a provider that is slow to answer is waited for, and the give lands once it answers', async () => {
    const call = await aParentThatMaySpawn()
    const held = holdTheNextLaunch()
    const giving = call('give_work', A_GIVE)
    await until(() => held.held > 0, 'the launch to reach its gate')
    await new Promise((resolve) => setTimeout(resolve, 200))
    let settled = false
    void giving.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    held.release()
    const answered = payload(await giving)
    expect(answered.outcome).not.toBe('refused')
    expect(piecesUnderTheRoot()).toHaveLength(1)
  })

  it('§2 a launch the app stopped before it started is answered as not started, a decision and not a retry', async () => {
    const call = await aParentThatMaySpawn()
    const held = holdTheNextLaunch()
    const spawning = call('give_work', A_GIVE)
    await until(() => held.held > 0, 'the launch to reach its gate')
    const starting = (
      payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] }
    ).agents.find((one) => one.state === 'active')
    expect(starting).toBeDefined()
    await host.closeAll()

    expect(payload(await spawning)).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      permanence: 'until-a-person-changes-it',
      retryable: false,
      remedy: null,
      detail: { profile: 'worker', because: 'shutting-down' },
    })
    const said = String(payload(await spawning).reason)
    expect(said).toContain('somebody stopped it first')
    expect(said).not.toContain('has to change that first')
    expect(piecesUnderTheRoot()).toEqual([])
  })

  it('§3 a sign-in the machine does not have is answered with a closed reason and none of the host text', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new AuthUnavailableError(
      'claude',
      'the machine Claude login at /Users/somebody/.claude is not healthy',
    )
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = payload(await call('give_work', A_GIVE))
    expect(answered).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      detail: { profile: 'worker', because: 'its-sign-in-is-unusable', provider: 'claude' },
    })
    expect(JSON.stringify(answered)).not.toContain('/Users/somebody')
    expect(String(answered.reason)).toContain('its Claude sign-in could not be used')
    expect(String(answered.reason)).toContain('sign in to Claude Code on this computer again')
    expect(String(answered.reason)).not.toContain('somebody stopped it first')
    expect(answered.retryable).toBe(false)
    expect(piecesUnderTheRoot()).toEqual([])
    expect(
      warned.mock.calls.some(
        (args) =>
          String(args[0]).startsWith('give_work: ') &&
          String(args[0]).includes('/Users/somebody/.claude'),
      ),
    ).toBe(true)
  })

  it('§3b Codex settings its profile holds that cannot be used are said as settings, not as a sign-in', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new CodexSettingsUnusableError(
      'profile config.toml could not be parsed at /Users/somebody/home/config.toml',
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = payload(await call('give_work', A_GIVE))
    expect(answered).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      detail: {
        profile: 'worker',
        because: 'its-provider-settings-are-unusable',
        provider: 'codex',
      },
    })
    expect(String(answered.reason)).toContain(
      'correct that agent’s Codex settings (config.toml): they could not be used',
    )
    expect(String(answered.reason)).not.toContain('sign-in')
    expect(JSON.stringify(answered)).not.toContain('/Users/somebody')
    expect(piecesUnderTheRoot()).toEqual([])
  })

  it('§4 a failure this tool does not recognise still propagates — it is not dressed as a word', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new Error('the disk said no')
    await expect(call('give_work', A_GIVE)).rejects.toThrow('the disk said no')
  })

  it('§5 the host keeps the class as `cause`, and the sentence a person reads is unchanged', async () => {
    const held = holdTheNextLaunch()
    const failing = host
      .createSession({ provider: 'claude', profileId: 'worker', cwd: work }, window)
      .then(
        () => null,
        (error: unknown) => error,
      )
    await until(() => held.held > 0, 'the launch to reach its gate')
    await host.closeAll()
    const failed = await failing
    expect(failed).toBeInstanceOf(Error)
    expect(String((failed as Error).message)).not.toContain('SessionUnavailable')
    expect(unavailableOf(failed)).toBeNull()
    const cause = (failed as Error).cause
    expect(cause).toBeInstanceOf(SessionUnavailable)
    expect(unavailableOf(cause)).toBe('shutting-down')
  })
})
