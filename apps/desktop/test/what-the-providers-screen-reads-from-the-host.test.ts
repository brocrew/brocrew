import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, MAX_USAGE_WINDOWS, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { type ListedProcess } from '../src/main/runtime/process-listing'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { ProvidersChangedMessage, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # ⚑ What the Providers screen reads from the host: usage, and what the agents use
 *
 * Landing coverage for `providerUsage` / `providerResources` and what feeds them. **Usage** is held in
 * memory from the `provider_usage` readings a conversation's provider sends: the newest per window, a
 * field the provider left out keeping what it last said (a sparse update is not a reset), windows told
 * only when a number MOVED, at most 16 a provider, forgotten when what the provider runs on changes —
 * and a conversation that kept running on the older login no longer feeds it. It is never a row of a
 * conversation and never sent to a window. **Resources** are measured only when asked, from one
 * listing, one at a time, at most every five seconds, and a clock set back is a new sample.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

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

describe('what the Providers screen reads from the host', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let window: RecordingSink
  let handles: FakeSessionHandle[]
  let clock: number
  let moved: ProvidersChangedMessage[]
  let listing: () => Promise<readonly ListedProcess[]>
  let listed: number
  let counter = 0

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-providers-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    handles = []
    moved = []
    clock = 1_000_000
    listed = 0
    listing = async () => []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: () => clock,
      listProcesses: () => {
        listed += 1
        return listing()
      },
      providersMoved: (message) => moved.push(message),
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
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (provider: Provider = 'claude', profileId?: string) => {
    await host.createSession(
      { provider, ...(profileId === undefined ? {} : { profileId }), cwd: userData },
      window,
    )
    return handles.at(-1)!
  }

  const pump = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  const reading = (
    handle: FakeSessionHandle,
    readings: { window: string; usedPercent: number | null; resetsAt: number | null }[],
  ) => {
    handle.simulateProviderUsage(readings)
    return pump()
  }

  describe('usage', () => {
    it('🔴 nothing has arrived: an empty list per provider, and nothing is read to answer', () => {
      expect(host.providerUsage()).toEqual({ claude: [], codex: [] })
    })

    it('🔴 a reading is kept with the moment it arrived, told once, and never recorded or sent as a row', async () => {
      const handle = await open()
      const rows = window.messages.length
      await reading(handle, [{ window: 'five_hour', usedPercent: 40, resetsAt: 5_000 }])
      expect(host.providerUsage().claude).toEqual([
        { window: 'five_hour', usedPercent: 40, resetsAt: 5_000, at: clock },
      ])
      expect(host.providerUsage().codex).toEqual([])
      expect(moved).toEqual([{ what: 'usage', provider: 'claude' }])
      // No row of the conversation, no message to the window.
      expect(window.messages.filter((m) => m.event.type === 'provider_usage')).toEqual([])
      expect(window.messages.length).toBe(rows)
    })

    it('⚑ a windows is told only when a number moved: the same reading again is no news', async () => {
      const handle = await open()
      const same = [{ window: 'five_hour', usedPercent: 40, resetsAt: 5_000 }]
      await reading(handle, same)
      await reading(handle, same)
      expect(moved).toHaveLength(1)
      clock += 10
      await reading(handle, [{ window: 'five_hour', usedPercent: 41, resetsAt: 5_000 }])
      expect(moved).toHaveLength(2)
      // `at` follows the newest arrival even when it was no news.
      expect(host.providerUsage().claude[0]).toMatchObject({ usedPercent: 41, at: clock })
    })

    it('⛔ a sparse reading is not a reset: a field the provider left out keeps what it last said', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'a 7-day window', usedPercent: 74, resetsAt: 9_000 }])
      await reading(handle, [{ window: 'a 7-day window', usedPercent: 80, resetsAt: null }])
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 80, resetsAt: 9_000 }])
      await reading(handle, [{ window: 'a 7-day window', usedPercent: null, resetsAt: 12_000 }])
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 80, resetsAt: 12_000 }])
    })

    it('⛔ no more than sixteen windows a provider, and one already held is still updated past the bound', async () => {
      const handle = await open()
      await reading(
        handle,
        Array.from({ length: MAX_USAGE_WINDOWS + 4 }, (_, i) => ({
          window: `w${String(i)}`,
          usedPercent: i,
          resetsAt: null,
        })),
      )
      expect(host.providerUsage().claude).toHaveLength(MAX_USAGE_WINDOWS)
      await reading(handle, [{ window: 'w0', usedPercent: 99, resetsAt: null }])
      expect(host.providerUsage().claude.find((one) => one.window === 'w0')?.usedPercent).toBe(99)
      expect(host.providerUsage().claude).toHaveLength(MAX_USAGE_WINDOWS)
    })

    it('🔴 what a provider runs on changing forgets its readings, tells both facts, and leaves the other provider alone', async () => {
      const claude = await open('claude')
      const codex = await open('codex')
      await reading(claude, [{ window: 'five_hour', usedPercent: 40, resetsAt: null }])
      await reading(codex, [{ window: 'a 5-hour window', usedPercent: 10, resetsAt: null }])
      moved.length = 0

      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      expect(host.providerUsage().claude).toEqual([])
      expect(host.providerUsage().codex).toHaveLength(1)
      expect(moved).toEqual([
        { what: 'usage', provider: 'claude' },
        { what: 'login', provider: 'claude' },
      ])

      // …and a change that forgot nothing says only the login moved.
      moved.length = 0
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      expect(moved).toEqual([{ what: 'login', provider: 'claude' }])
    })

    it('⛔ a conversation still running on the older login no longer feeds the readings — one started after does', async () => {
      const older = await open('claude')
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      await reading(older, [{ window: 'five_hour', usedPercent: 95, resetsAt: null }])
      expect(host.providerUsage().claude, 'an older login’s reading was kept').toEqual([])

      const newer = await open('claude')
      await reading(newer, [{ window: 'five_hour', usedPercent: 3, resetsAt: null }])
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 3 }])
    })

    it('⚑ a change scoped to one profile marks only that profile’s conversations', async () => {
      const work = await open('claude', 'work')
      const home = await open('claude', 'home')
      ;(
        host as unknown as { providerLoginChanged(provider: Provider, profileId?: string): void }
      ).providerLoginChanged('claude', 'work')
      await reading(work, [{ window: 'five_hour', usedPercent: 90, resetsAt: null }])
      expect(host.providerUsage().claude).toEqual([])
      await reading(home, [{ window: 'five_hour', usedPercent: 12, resetsAt: null }])
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 12 }])
    })
  })

  describe('resources', () => {
    const listingOf = (rows: ListedProcess[]) => async () => rows
    const withPid = async (provider: Provider, pid: number) => {
      const handle = await open(provider)
      Object.defineProperty(handle, 'providerPid', { value: pid, configurable: true })
    }

    it('🔴 nothing is measured while nobody asks', async () => {
      await withPid('claude', 4242)
      await pump()
      clock += 60_000
      await pump()
      expect(listed).toBe(0)
    })

    it('🔴 an ask is answered from one listing, by the pids the adapters hold', async () => {
      await withPid('claude', 4242)
      await withPid('codex', 5252)
      listing = listingOf([
        { pid: 4242, ppid: 1, rssKb: 1_000, cpu: 5 },
        { pid: 4300, ppid: 4242, rssKb: 500, cpu: 1 },
        { pid: 5252, ppid: 1, rssKb: 2_000, cpu: 2 },
        { pid: 9999, ppid: 1, rssKb: 7_777, cpu: 70 },
      ])
      const out = await host.providerResources()
      expect(listed).toBe(1)
      expect(out.claude).toEqual({ running: 1, rssBytes: 1_500 * 1024, cpuPercent: 6, at: clock })
      expect(out.codex).toEqual({ running: 1, rssBytes: 2_000 * 1024, cpuPercent: 2, at: clock })
    })

    it('⚑ asks that arrive while one is under way join it, and one inside five seconds of the last is answered with it', async () => {
      await withPid('claude', 4242)
      let release: () => void = () => {}
      listing = () =>
        new Promise((resolve) => {
          release = () => resolve([{ pid: 4242, ppid: 1, rssKb: 10, cpu: 1 }])
        })
      const first = host.providerResources()
      const second = host.providerResources()
      expect(listed, 'a second ask started a second listing').toBe(1)
      release()
      const [a, b] = await Promise.all([first, second])
      expect(b).toBe(a)

      clock += 4_999
      expect(await host.providerResources()).toBe(a)
      expect(listed).toBe(1)

      // Past five seconds it is measured again.
      listing = listingOf([{ pid: 4242, ppid: 1, rssKb: 20, cpu: 2 }])
      clock += 1
      const later = await host.providerResources()
      expect(listed).toBe(2)
      expect(later.claude.rssBytes).toBe(20 * 1024)
    })

    it('⛔ a clock set back is a new sample, not a measurement from the future kept for ever', async () => {
      await withPid('claude', 4242)
      listing = listingOf([{ pid: 4242, ppid: 1, rssKb: 10, cpu: 1 }])
      await host.providerResources()
      clock -= 600_000
      await host.providerResources()
      expect(listed).toBe(2)
    })

    it('🔴 a listing that fails is said, with the roots still counted, and asked again at the next ask', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await withPid('claude', 4242)
      listing = async () => {
        throw new Error('ps timed out')
      }
      const failed = await host.providerResources()
      expect(failed.claude).toEqual({
        running: 1,
        at: clock,
        rssBytes: null,
        cpuPercent: null,
        reason: 'This computer did not list its processes just now; it is asked again in a moment.',
      })
      expect(JSON.stringify(failed)).not.toContain('ps timed out')
      // The failure is the answer for the five seconds an answer holds, and then it is asked again.
      expect(await host.providerResources()).toBe(failed)
      expect(listed).toBe(1)
      clock += 5_000
      listing = listingOf([{ pid: 4242, ppid: 1, rssKb: 10, cpu: 1 }])
      const ok = await host.providerResources()
      expect(listed).toBe(2)
      expect(ok.claude.rssBytes).toBe(10 * 1024)
    })
  })
})
