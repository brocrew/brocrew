import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import { createSessionStore, NULL_SESSION_STORE } from '../src/main/db/session-store'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})

it.each(['timeout', 'Stop', 'interrupt-and-send'] as const)(
  'a never-settling refresh preserves delivery intent after %s and confirmed exit',
  async (cause) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-refused-refresh-')))
    const db = openDatabase(join(root, 'fictional.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const raw = new FakeRuntime('claude')
    const original = raw.start.bind(raw)
    const sent = vi.fn<SessionHandle['send']>(async () => {})
    let oldHandle!: SessionHandle
    let finish!: () => void
    let releaseExit!: () => void
    const exit = new Promise<void>((resolve) => {
      releaseExit = resolve
    })
    let began!: () => void
    const refreshing = new Promise<void>((resolve) => {
      began = resolve
    })
    vi.spyOn(raw, 'start').mockImplementation(async (options) => {
      const handle = await original(options)
      vi.spyOn(handle, 'send').mockImplementation(sent)
      oldHandle = handle
      vi.spyOn(handle, 'close')
      Object.defineProperty(handle, 'awaitProcessExit', { value: () => exit })
      Object.defineProperty(handle, 'refreshManagedPlugins', {
        value: () => {
          began()
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        },
      })
      return handle
    })
    const originalResume = raw.resume.bind(raw)
    const resent = vi.fn<SessionHandle['send']>(async () => {})
    const resumed = vi.spyOn(raw, 'resume').mockImplementation(async (ref, options) => {
      const handle = await originalResume(ref, options)
      vi.spyOn(handle, 'send').mockImplementation(resent)
      Object.defineProperty(handle, 'awaitProcessExit', { value: () => Promise.resolve() })
      return handle
    })
    let servers: { name: string; url: string; capability: string }[] = []
    const host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      createRuntime: () => raw,
      pluginAttachments: {
        agent: () => ({
          read: async () => ({ revision: String(servers.length), servers }),
          close: async () => {},
        }),
      },
      prepareProviderHome: () => {
        const home = join(root, 'home')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: () => join(root, 'home'),
      resolveCwd: () => root,
      newSessionId: () => 'sess_fictional_refresh',
      closeDrainTimeoutMs: 3000,
      readProviderConfig: () => ({
        home: join(root, 'home'),
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
    })
    cleanups.push(async () => {
      finish?.()
      releaseExit()
      await host.closeAll()
      db.close()
      rmSync(root, { recursive: true, force: true })
    })
    const events: RuntimeEventMessage[] = []
    const sink: RuntimeEventSink = {
      ownerId: 'fictional-owner',
      aPersonIsBehindIt: true,
      alive: true,
      send: (event) => {
        events.push(event)
      },
      sendLiveness: () => {},
    }
    const { sessionId } = await host.createSession({ provider: 'claude' }, sink)
    servers = [
      { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) },
    ]
    const sending = host.send(sessionId, 'the person’s fictional original words', sink)
    const result = sending.then(
      () => 'sent',
      (error: Error) => error.message,
    )
    let stopping = Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await refreshing
      if (cause !== 'timeout') {
        stopping =
          cause === 'Stop'
            ? host.interrupt(sessionId, sink)
            : host.sendInterrupting(sessionId, 'the person’s fictional replacement words', sink)
        void stopping.catch(() => {})
      }
      await vi.waitFor(() => expect(oldHandle.close).toHaveBeenCalledOnce(), {
        timeout: 2500,
        interval: 5,
      })
      expect(resumed).not.toHaveBeenCalled()
      expect(sent).not.toHaveBeenCalled()
      releaseExit()
      await stopping
      const said = await Promise.race([
        result,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve('still pending'), 2500)
        }),
      ])
      if (cause === 'timeout') expect(said).toBe('sent')
      else expect(said).toBe("Your message wasn't sent. Press Send to try again.")
      expect(sent).not.toHaveBeenCalled()
      if (cause === 'Stop') {
        expect(resumed).not.toHaveBeenCalled()
        expect(resent).not.toHaveBeenCalled()
      } else {
        expect(resumed).toHaveBeenCalledOnce()
        expect(resent).toHaveBeenCalledOnce()
        expect(resent.mock.calls[0]?.[0]).toContain(
          cause === 'timeout'
            ? 'the person’s fictional original words'
            : 'the person’s fictional replacement words',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(
        events.filter(
          ({ event }) =>
            event.type === 'user_turn' &&
            event.text.includes('the person’s fictional original words'),
        ),
      ).toHaveLength(cause === 'timeout' ? 1 : 0)
    } finally {
      clearTimeout(timer)
      finish?.()
      releaseExit()
      await stopping.catch(() => {})
      await result
    }
  },
)
for (const provider of ['claude', 'codex'] as const)
  it(`${provider} RuntimeHost offers attachments to every fresh agent and reads again before its turn`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-attachment-host-')))
    const raw = new FakeRuntime(provider)
    let releaseRetired!: () => void
    const retiredExit = new Promise<void>((resolve) => {
      releaseRetired = resolve
    })
    let allocated = 0
    const withExit = <T extends SessionHandle>(handle: T): T => {
      const fact = allocated++ === 0 ? retiredExit : Promise.resolve()
      if (provider === 'codex')
        Object.defineProperty(handle, 'awaitProcessExit', { value: () => fact })
      return handle
    }
    const originalStart = raw.start.bind(raw),
      originalResume = raw.resume.bind(raw)
    const start = vi
      .spyOn(raw, 'start')
      .mockImplementation(async (opts) => withExit(await originalStart(opts)))
    vi.spyOn(raw, 'resume').mockImplementation(async (ref, opts) =>
      withExit(await originalResume(ref, opts)),
    )
    const read = vi.fn(async () => ({
      revision: 'one',
      servers: [
        { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) },
      ],
    }))
    const close = vi.fn(async () => {})
    const agent = vi.fn(() => ({ read, close }))
    let counter = 0
    const host = new RuntimeHost({
      closeDrainTimeoutMs: 50,
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      createRuntime: () => raw,
      pluginAttachments: { agent },
      prepareProviderHome: () => join(root, 'home'),
      providerHomePath: () => join(root, 'home'),
      resolveCwd: () => root,
      newSessionId: () => `fictional-${++counter}`,
      readProviderConfig: () => ({
        home: join(root, 'home'),
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
    })
    cleanups.push(async () => {
      releaseRetired()
      await host.closeAll()
      rmSync(root, { recursive: true, force: true })
    })
    const events: RuntimeEventMessage[] = []
    const sink: RuntimeEventSink = {
      ownerId: 'fictional-owner',
      aPersonIsBehindIt: true,
      alive: true,
      send: (value) => {
        events.push(value)
      },
      sendLiveness: () => {},
    }
    const created = await host.createSession({ provider }, sink)
    expect(agent).toHaveBeenCalledWith(expect.arrayContaining(['brobot']))
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        managedPluginMcp: [expect.objectContaining({ name: 'plugin-fern' })],
      }),
    )
    expect(events.length).toBeGreaterThan(0)
    await host.send(created.sessionId, 'fictional words', sink)
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2)
    async function until(test: () => boolean) {
      const end = Date.now() + 2000
      while (!test()) {
        if (Date.now() > end) throw new Error('fictional turn did not settle')
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    await until(() => events.some((one) => one.event.type === 'permission_request'))
    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await until(
      () =>
        events.filter((one) => one.event.type === 'turn' && one.event.state === 'completed')
          .length === 1,
    )
    read.mockResolvedValue({ revision: 'two', servers: [] })
    await host.send(created.sessionId, 'fictional next turn', sink)
    expect(
      events.filter((one) => one.event.type === 'session' && one.event.state === 'ended'),
    ).toHaveLength(0)
    await until(() => events.filter((one) => one.event.type === 'permission_request').length === 2)
    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await until(
      () =>
        events.filter((one) => one.event.type === 'turn' && one.event.state === 'completed')
          .length === 2,
    )
    if (provider === 'codex') {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await host.closeAll()
        expect(warn.mock.calls.flat().join(' ')).toContain('had not confirmed termination')
        releaseRetired()
        await new Promise<void>((resolve) => setImmediate(resolve))
        warn.mockClear()
        await host.closeAll()
        expect(warn).not.toHaveBeenCalled()
      } finally {
        releaseRetired()
        warn.mockRestore()
      }
    }
  })
