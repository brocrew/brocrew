import { RecordingSink, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentRuntime, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { SessionUnavailable } from '../src/main/runtime/session-unavailable'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * A Claude turn whose queued settings could not be applied (its plugin reload did not answer)
 * retires its provider: the adapter closes itself, and the CLI is confirmed gone only when it
 * exits. On Windows the SDK kills a wedged CLI 7 s after the close, later than the host's 5 s
 * drain, so the session's slot went before its launch did, and the next message met "has not
 * finished putting away its last session". Here the first launch fails its send the same way and
 * its process exit arrives after the drain bound.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const DRAIN_MS = 200
const RELOAD_FAILURE =
  'could not apply the queued settings: reloadPlugins did not answer within 60000ms'

describe('a failed settings apply leaves the conversation usable', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let launches: number
  let clock: number
  let counter: number
  let sessions: FakeProviderSessions

  /** `exitAfterMs` null: the retired provider never confirms its exit. */
  const buildHost = (exitAfterMs: number | null): RuntimeHost =>
    new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const inner = new FakeRuntime(provider, { sessions })
        const thisLaunch = ++launches
        const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
        const retiring = <H extends object>(handle: H): H => {
          let retired = false
          let exited!: () => void
          const exit = new Promise<void>((resolve) => {
            exited = resolve
          })
          return new Proxy(handle, {
            get(h, p) {
              if (p === 'isRetiring') return () => retired
              if (p === 'awaitProcessExit') return () => exit
              if (p === 'send')
                return () => {
                  if (retired) return Promise.reject(new Error('the provider is retiring'))
                  retired = true
                  void (h as unknown as SessionHandle).close().then(() => {
                    if (exitAfterMs !== null) setTimeout(exited, exitAfterMs)
                  })
                  return Promise.reject(new Error(RELOAD_FAILURE))
                }
              return bind(h, p)
            },
          })
        }
        return new Proxy(inner, {
          get(target, prop) {
            if (prop === 'start') {
              return async (opts: Parameters<AgentRuntime['start']>[0]) => {
                const handle = await target.start(opts)
                return thisLaunch === 1 ? retiring(handle) : handle
              }
            }
            return bind(target, prop)
          },
        }) as AgentRuntime
      },
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: fixtureProviderConfig,
      closeDrainTimeoutMs: DRAIN_MS,
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-settings-apply-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-settings-apply-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    launches = 0
    sessions = new FakeProviderSessions()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const turnTexts = (sessionId: string): string[] =>
    store
      .events(sessionId)
      .map((one) => one.event as { type: string; text?: unknown })
      .filter((event) => event.type === 'user_turn')
      .map((event) => String(event.text))

  const start = async (exitAfterMs: number | null) => {
    host = buildHost(exitAfterMs)
    const window = new RecordingSink('webContents:1')
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: work },
      window,
    )
    return { sessionId, window }
  }

  it('a message after the failed turn waits for the old provider to exit, then goes to a fresh start', async () => {
    const { sessionId, window } = await start(DRAIN_MS * 1.5)

    await expect(host.send(sessionId, 'first words', window)).resolves.toBeUndefined()

    expect(launches).toBe(2)
    expect(turnTexts(sessionId)).toEqual(['first words'])
  })

  it('Stop and send whose turn failed on the settings apply delivers its words to a fresh start', async () => {
    const { sessionId, window } = await start(DRAIN_MS * 1.5)

    await expect(
      host.sendInterrupting(sessionId, 'words sent with a stop', window),
    ).resolves.toBeUndefined()

    expect(launches).toBe(2)
    expect(turnTexts(sessionId)).toEqual(['words sent with a stop'])
  })

  it('control: a provider that never confirms its exit is still refused, after the bounded wait', async () => {
    const { sessionId, window } = await start(null)

    const refused = await host.send(sessionId, 'first words', window).then(
      () => null,
      (error: unknown) => error,
    )

    const cause = (refused as Error).cause
    expect(cause).toBeInstanceOf(SessionUnavailable)
    expect((cause as SessionUnavailable).unavailable).toBe('not-confirmed-stopped')
    expect(launches).toBe(1)
    expect(turnTexts(sessionId)).toEqual([])
  })
})
