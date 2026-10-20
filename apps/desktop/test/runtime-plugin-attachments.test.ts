import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})
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
