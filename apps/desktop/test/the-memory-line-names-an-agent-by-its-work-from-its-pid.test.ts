import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'

/**
 * # The agents' memory line names an agent by its work, from its pid (aab65c9c)
 *
 * ⚑ `RuntimeHost.whoseAgentsAre` — asked by the agents' own memory line (`memory-watch.ts`
 * `theAgentsDetail`) only when it writes, for the pids of the agents holding the most: a pid that is
 * a running conversation's provider is named as a sentence names that conversation
 * (`nameByItsWork`); any other pid is left out, and so is one whose name cannot be read — the line
 * then says the process instead.
 *
 * The rig is `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`' own: a real
 * SQLite ledger in a temp dir and the Fake provider, whose handle is given the pid the test names.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A handle that answers the pid the test names. Every other member is the Fake's, untouched. */
function withAPid(handle: SessionHandle, pid: number | undefined): SessionHandle {
  if (pid === undefined) return handle
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'providerPid') return pid
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

interface Rig {
  readonly host: RuntimeHost
  /** One conversation, whose provider holds `pid` (none when undefined). */
  open(pid: number | undefined): Promise<string>
  dispose(): Promise<void>
}

function buildRig(): Rig {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-whose-agents-'))
  const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const ledger = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  let counter = 0
  let nextPid: number | undefined
  const host = new RuntimeHost({
    store: ledger,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: (provider: Provider) => {
      const runtime = new FakeRuntime(provider, { sessions })
      const start = runtime.start.bind(runtime)
      const pid = nextPid
      runtime.start = async (opts) => withAPid(await start(opts), pid) as never
      return runtime
    },
    prepareProviderHome: (provider: Provider) => {
      const home = join(userData, 'provider-homes', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
    newSessionId: () => `sess_${++counter}`,
    closeDrainTimeoutMs: 40,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
  return {
    host,
    open: async (pid) => {
      nextPid = pid
      const { sessionId } = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        null,
      )
      nextPid = undefined
      return sessionId
    },
    dispose: async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    },
  }
}

describe("whoseAgentsAre names the agents the memory line names, by their provider's pid", () => {
  let rig: Rig

  beforeEach(() => {
    rig = buildRig()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rig.dispose()
  })

  it('names each asked pid that is a running conversation’s provider, as a sentence names it', async () => {
    const { host, open } = rig
    const first = await open(4101)
    const second = await open(4102)
    const noPid = await open(undefined)
    expect(host.sessionIds).toEqual(expect.arrayContaining([first, second, noPid]))

    const named = host.whoseAgentsAre([4101, 4102])
    expect([...named.keys()].sort((a, b) => a - b)).toEqual([4101, 4102])
    expect(named.get(4101)).toBe(host.nameByItsWork(first))
    expect(named.get(4102)).toBe(host.nameByItsWork(second))
    expect(named.get(4101)?.length ?? 0).toBeGreaterThan(0)
  })

  it('leaves out a pid it was not asked for, and one that is no conversation’s', async () => {
    const { host, open } = rig
    await open(4101)
    await open(4102)
    await open(undefined)

    const named = host.whoseAgentsAre([4101, 9999])
    expect([...named.keys()]).toEqual([4101])
    expect(named.has(4102)).toBe(false)
    expect(named.has(9999)).toBe(false)
    expect(host.whoseAgentsAre([]).size).toBe(0)
    // Paired: the pid it left out above is named when asked.
    expect(host.whoseAgentsAre([4102]).has(4102)).toBe(true)
  })

  it('names each pid by its OWN conversation', async () => {
    const { host, open } = rig
    const first = await open(4101)
    const second = await open(4102)
    vi.spyOn(host, 'nameByItsWork').mockImplementation(
      (conversation: string) => `called ${conversation}`,
    )

    const named = host.whoseAgentsAre([4102, 4101])
    expect(named.get(4101)).toBe(`called ${first}`)
    expect(named.get(4102)).toBe(`called ${second}`)
  })

  it('leaves out a pid whose name cannot be read, and still names the others', async () => {
    const { host, open } = rig
    const unnamable = await open(4101)
    const fine = await open(4102)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(host, 'nameByItsWork').mockImplementation((conversation: string) => {
      if (conversation === unnamable) throw new Error('the ledger is closed')
      return `called ${conversation}`
    })

    const named = host.whoseAgentsAre([4101, 4102])
    expect(named.has(4101)).toBe(false)
    expect(named.get(4102)).toBe(`called ${fine}`)
    expect(
      warned.mock.calls.some((call) => String(call[0]).includes(unnamable)),
      'the name that could not be read is said in the console',
    ).toBe(true)
  })

  it('a conversation that has stopped is no longer named; one still running is', async () => {
    const { host, open } = rig
    const stopping = await open(4101)
    const running = await open(4102)
    expect(host.whoseAgentsAre([4101]).has(4101)).toBe(true)

    await host.close(stopping, THE_APP_ITSELF)
    expect(host.sessionIds).not.toContain(stopping)
    const named = host.whoseAgentsAre([4101, 4102])
    expect(named.has(4101)).toBe(false)
    expect(named.get(4102)).toBe(host.nameByItsWork(running))
  })
})
