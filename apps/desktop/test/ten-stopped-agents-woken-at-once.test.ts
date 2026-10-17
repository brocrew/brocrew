import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { MainThreadWork, startStallWatch, timedMethods } from '../src/main/stall-watch'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const HELPERS = 10
const ROWS = 2_000

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    void message
  }
  sendLiveness(): void {}
}

/**
 * One agent wakes ten stopped agents with long ledgers within a second. Each comes back running, and
 * none reads a page of history, which no window would be handed; a window's own reopen still reads
 * one. What the store did for the ten is logged per wake.
 */
describe('ten stopped agents woken at once', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let work: MainThreadWork
  let announced: string[]
  let counter = 0
  let clock = 8_000_000

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-mass-wake-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const tick = (): number => clock++
    work = new MainThreadWork()
    store = timedMethods(createSessionStore(db, tick), 'store', work)
    announced = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      announce: (change) => announced.push(change.what),
      statesMoved: () => {},
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

  const callOn = async (
    tools: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(name)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  it('⚑ each comes back running, and ⛔ none reads a history page nobody is shown', async () => {
    const window = new Window('webContents:1')
    const helpers: string[] = []
    for (let n = 0; n < HELPERS; n++) {
      const opened = await host.createSession(
        {
          provider: 'claude',
          profileId: `helper-${String(n)}`,
          approvalMode: 'auto',
          cwd: userData,
        },
        window,
      )
      await host.close(opened.sessionId, window)
    }
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'the-pm', approvalMode: 'auto', cwd: userData },
      window,
    )
    const tools = agentToolsFor(host, pm)
    for (let n = 0; n < HELPERS; n++) {
      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: `helper-${String(n)}`,
        title: `piece ${String(n)}`,
        brief: 'do it',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      helpers.push(given.agent as string)
    }
    // A long history in each helper's ledger, written while it is stopped.
    for (const helper of helpers) {
      await waitFor(
        () => store.events(helper).some((entry) => entry.event.type === 'turn'),
        'the brief’s turn to end',
      )
    }
    for (const helper of helpers) await host.close(helper, THE_APP_ITSELF)
    await waitFor(() => helpers.every((helper) => !host.sessionIds.includes(helper)), 'stopped')
    const t0 = performance.now()
    for (const helper of helpers) {
      let ordinal = store.nextOrdinal(helper)
      const rows: { ordinal: number; event: TranscriptEvent; at: number }[] = []
      for (let i = 0; i < ROWS; i++) {
        const event: TranscriptEvent =
          i % 50 === 0
            ? { type: 'status', state: i % 100 === 0 ? 'working' : 'idle' }
            : ({
                type: 'assistant_text',
                text: `words ${String(i)} `.repeat(20),
              } as unknown as TranscriptEvent)
        rows.push({ ordinal: ordinal++, event, at: clock++ })
      }
      store.appendMany(helper, rows)
    }
    console.log(
      `planted ${String(HELPERS * ROWS)} rows in ${String(Math.round(performance.now() - t0))} ms`,
    )

    work.clear()
    announced = []
    const lines: string[] = []
    const watch = startStallWatch({
      work: new MainThreadWork(),
      log: (line) => lines.push(line),
      tickMs: 10,
      floorMs: 50,
      observeGc: false,
    })
    const started = performance.now()
    await Promise.all(
      helpers.map((helper) =>
        callOn(tools, 'message_agent', { agent: helper, kind: 'note', text: 'wake up' }),
      ),
    )
    await waitFor(
      () => helpers.every((helper) => host.sessionIds.includes(helper)),
      'every helper running again',
    )
    const tookMs = performance.now() - started
    const counts = watch.takeCounts()
    watch.stop()
    const taken = work.take()
    expect(taken.find((one) => one.what === 'store.turnWindow')).toBeUndefined()
    const storeMs = taken.reduce((sum, one) => sum + one.ms, 0)
    // The control: a window's own reopen is handed a page, so it reads one.
    const first = helpers[0] as string
    await host.close(first, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(first), 'stopped again')
    work.clear()
    const reopened = await host.resumeSession(first, window)
    expect(reopened.history.entries.length).toBeGreaterThan(0)
    expect(work.take().find((one) => one.what === 'store.turnWindow')?.count).toBe(1)
    console.log(
      JSON.stringify(
        {
          wokeAllInMs: Math.round(tookMs),
          storeMsPerWake: Math.round(storeMs / HELPERS),
          longestLateTickMs: Math.round(counts.longestLateMs),
          blocksOver50ms: lines,
          announced: announced.reduce<Record<string, number>>((all, what) => {
            all[what] = (all[what] ?? 0) + 1
            return all
          }, {}),
          storeTop: taken
            .slice(0, 12)
            .map(
              (one) =>
                `${one.what} ${Math.round(one.ms)} ms ×${String(one.count)} (longest ${Math.round(one.longest)})`,
            ),
        },
        null,
        2,
      ),
    )
  }, 120_000)
})
