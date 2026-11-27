import { closeStartedHostAfterFailedStart } from '../src/main/failed-start-cleanup'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, onTestFinished, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime/testing'
import { createAppLifetime } from '../src/main/app-lifetime'
import { closeDatabase } from '../src/main/db/close-database'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { closeHostFixture, numberedFixtureHostPaths } from './lib/host-fixture'
import { deferred } from './helpers/quit-open-list-cases'
import { scratchHostState } from './helpers/scratch-host'

const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('index.ts', index, ts.ScriptTarget.Latest, true)
const cleanup = parsed.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'stopWhatTheStartStarted',
)!
const lifetime = parsed.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((decl) => decl.name.getText(parsed) === 'lifetime'),
)!
const source = ts.transpileModule(
  [
    cleanup.getText(parsed),
    lifetime.getText(parsed),
    'globalThis.startCleanup = stopWhatTheStartStarted; globalThis.appLifetime = lifetime',
  ].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText

it.each(['fulfilled', 'rejected'] as const)(
  'failed-start cleanup with a %s provider stop joins the accepted reply across repeated quit',
  async (outcome) => {
    let clock = 5_000_000
    const tick = (): number => clock++
    const { userData, root, db, store, issued, window } = scratchHostState(
      'failed-start-reply',
      tick,
    )
    const host = new RuntimeHost({
      store,
      ...numberedFixtureHostPaths(() => userData, tick),
      createRuntime: (provider) => new FakeRuntime(provider, { sessions: issued }),
    })
    onTestFinished(() =>
      closeHostFixture(host, { close: () => (db.open ? db.close() : db) }, userData, root),
    )
    host.createAgent({ slug: 'worker', displayName: 'Worker', provider: null }, window)
    const captured = deferred()
    const release = deferred()
    const order: string[] = []
    const diagnostics: string[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on('unhandledRejection', onUnhandled)
    onTestFinished(() => {
      process.off('unhandledRejection', onUnhandled)
    })
    const rename = store.renameAgentDisplayName.bind(store)
    vi.spyOn(store, 'renameAgentDisplayName').mockImplementationOnce(async (...args) => {
      const receipt = await rename(...args)
      captured.resolve()
      await release.promise
      return receipt
    })
    const closeHost = host.closeAll.bind(host)
    const reachedHost = deferred()
    const close = vi.spyOn(host, 'closeAll').mockImplementation(async () => {
      order.push('host-close')
      reachedHost.resolve()
      const result = await closeHost()
      order.push('host-drained')
      return result
    })
    const originalClose = db.close.bind(db)
    const writerClose = vi.spyOn(db, 'close').mockImplementation(() => {
      order.push('database-close')
      return originalClose()
    })
    const failure = new Error('provider stop rejection witness')
    const stopProviderSetup = vi.fn(() => {
      order.push('provider-stop')
      return outcome === 'rejected' ? Promise.reject(failure) : Promise.resolve()
    })
    const app = { getPath: () => userData, quit: vi.fn(), exit: vi.fn() }
    const context = {
      closeStartedHostAfterFailedStart,
      host,
      db,
      stoppingTheStart: null,
      stopProviderSetup,
      stopThemeIpc: vi.fn(),
      stopStorageIpc: vi.fn(),
      stopVoiceIpc: vi.fn(),
      dockLabel: null,
      themes: { close: () => Promise.resolve() },
      pluginController: { close: () => Promise.resolve() },
      pluginSupervisor: { quit: () => Promise.resolve() },
      updates: {
        workspaceUpdates: { holdQuit: () => false },
        stop: vi.fn(),
        drain: async () => void order.push('updates-drained'),
      },
      eventRetention: { stop: vi.fn(async () => {}) },
      stopRecoveryWork: vi.fn(async () => {}),
      BrowserWindow: { getAllWindows: () => [] },
      APP_CLOSING_CHANNEL: 'closing',
      theLastDraftSaves: async () => {},
      closeDatabase,
      stopOrphanedCommands: async () => {},
      theDataOpened: false,
      startFailed: true,
      app,
      armLastResortExit: vi.fn(),
      spawn: vi.fn(),
      process,
      Buffer,
      STDERR_FD: 2,
      writeSync: (_fd: number, bytes: Buffer, offset: number, length: number) => {
        diagnostics.push(bytes.subarray(offset, offset + length).toString())
        return length
      },
      sayAtOnce: (line: string) => diagnostics.push(line),
      inspect,
      createAppLifetime,
    }
    runInNewContext(source, context)
    const running = context as typeof context & {
      startCleanup(): Promise<void>
      appLifetime: ReturnType<typeof createAppLifetime>
    }
    const reply = executeRuntimeCommand(host, window, {
      kind: 'setAgentDisplayName',
      profileId: 'worker',
      displayName: 'Planner',
    }).then((receipt) => {
      order.push('reply')
      return receipt
    })
    await Promise.race([captured.promise, reply])
    const stopping = running.startCleanup()
    expect(running.startCleanup()).toBe(stopping)
    const event = { preventDefault: vi.fn() }
    running.appLifetime.beforeQuit(event)
    running.appLifetime.beforeQuit(event)
    try {
      await Promise.race([reachedHost.promise, stopping])
      await new Promise<void>((done) => setImmediate(done))
      expect(stopProviderSetup).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(db.open).toBe(true)
      expect(writerClose).not.toHaveBeenCalled()
      expect(order).not.toContain('updates-drained')
      expect(unhandled).toEqual([])
      if (outcome === 'rejected') {
        expect(diagnostics.join('\n')).toContain(
          'BroCrew failed to stop provider setup after its failed start:',
        )
        expect(diagnostics.join('\n')).toContain(failure.message)
      } else {
        expect(diagnostics.join('\n')).not.toContain('failed to stop provider setup')
      }
      expect(diagnostics.join('\n')).toContain('was asked to quit again (a quit gesture)')
    } finally {
      release.resolve()
      await running.appLifetime.shuttingDown
      await stopping
    }
    expect(await reply).toMatchObject({ slug: 'worker', displayName: 'Planner' })
    expect(stopProviderSetup).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(writerClose).toHaveBeenCalledOnce()
    expect(order.indexOf('reply')).toBeLessThan(order.indexOf('host-drained'))
    expect(order.indexOf('host-drained')).toBeLessThan(order.indexOf('updates-drained'))
    expect(order.indexOf('updates-drained')).toBeLessThan(order.indexOf('database-close'))
    expect(context.eventRetention.stop).toHaveBeenCalledTimes(2)
    expect(context.stopRecoveryWork).toHaveBeenCalledTimes(2)
    expect(unhandled).toEqual([])
    expect(db.open).toBe(false)
  },
)
