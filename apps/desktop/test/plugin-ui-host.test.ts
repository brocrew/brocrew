import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import ts from 'typescript'
import { uiFixture } from './plugin-ui-fixtures'
import type { PluginUiPeer } from '../src/main/plugins/ui/rpc'
import { PLUGIN_UI_RPC, PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'

const fake = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  let nextId = 1
  class Contents extends EventEmitter {
    id = nextId++
    url = ''
    destroyed = false
    mainFrame = { url: '', send: vi.fn() }
    openWindow: () => { action: string } = () => ({ action: 'allow' })
    constructor(readonly preferences: Record<string, unknown>) {
      super()
    }
    isDestroyed() {
      return this.destroyed
    }
    getURL() {
      return this.url
    }
    async loadURL(url: string) {
      const isolated = this.preferences.session as Session
      if (isolated.request(url, 'GET', 'mainFrame', this.id))
        throw new Error('fictional canceled request')
      this.url = url
      this.mainFrame.url = url
      this.emit('did-navigate', {}, url)
    }
    setWindowOpenHandler(callback: () => { action: string }) {
      this.openWindow = callback
    }
    close = vi.fn(() => {
      this.destroyed = true
      this.emit('destroyed')
    })
  }
  class Session extends EventEmitter {
    constructor(
      readonly partition: string,
      readonly options: { cache: boolean },
    ) {
      super()
    }
    before: (details: object, answer: (result: { cancel: boolean }) => void) => void = () => {}
    protocol = { handle: vi.fn(), unhandle: vi.fn() }
    webRequest = {
      onBeforeRequest: (callback: Session['before']) => {
        this.before = callback
      },
    }
    setPermissionCheckHandler = vi.fn()
    setPermissionRequestHandler = vi.fn()
    setDevicePermissionHandler = vi.fn()
    clearStorageData = vi.fn(async () => {})
    clearCache = vi.fn(async () => {})
    closeAllConnections = vi.fn(async () => {})
    request(url: string, method: string, resourceType: string, webContentsId: number) {
      let cancel = false
      this.before({ url, method, resourceType, webContentsId }, (result) => {
        cancel = result.cancel
      })
      return cancel
    }
  }
  const sessions: Session[] = [],
    contents: Contents[] = []
  const ipc = { handle: vi.fn(), removeHandler: vi.fn() }
  return {
    sessions,
    contents,
    ipc,
    exports: {
      ipcMain: ipc,
      session: {
        fromPartition: vi.fn((partition: string, options: { cache: boolean }) => {
          const created = new Session(partition, options)
          sessions.push(created)
          return created
        }),
      },
      WebContentsView: class {
        webContents: Contents
        constructor(options: { webPreferences: Record<string, unknown> }) {
          this.webContents = new Contents(options.webPreferences)
          contents.push(this.webContents)
        }
      },
    },
  }
})
vi.mock('electron', () => fake.exports)
import { installPluginUiRpc, openPluginConfigurationView } from '../src/main/plugins/ui/host'
import { guardedAppIpc } from '../src/main/app-ipc'
const owned: Awaited<ReturnType<typeof openPluginConfigurationView>>[] = []
afterEach(async () => {
  for (const view of owned.splice(0)) await view.close()
  vi.clearAllMocks()
})
async function host(overrideRead?: PluginUiPeer['read']) {
  const { verified, binding } = uiFixture(),
    read = overrideRead ?? vi.fn(async () => ({ loaves: 2 })),
    proposePeer = vi.fn(async () => ({ resources: [] })),
    detached = vi.fn()
  let valid = true,
    invalidate = () => {}
  const view = await openPluginConfigurationView({
    verified,
    binding,
    peer: { read, subscribe: async () => () => {}, proposeConfig: proposePeer },
    current: () => valid,
    onInvalidate: (revoke) => {
      invalidate = revoke
      return () => {}
    },
    propose: () => {},
    detached,
  })
  owned.push(view)
  return {
    view,
    read,
    proposePeer,
    detached,
    contents: fake.contents.at(-1)!,
    session: fake.sessions.at(-1)!,
    invalidate: () => {
      valid = false
      invalidate()
    },
  }
}
function handler() {
  installPluginUiRpc(fake.ipc)
  return fake.ipc.handle.mock.calls.find((call) => call[0] === PLUGIN_UI_RPC)![1]
}
describe('the actual isolated host wiring', () => {
  it('uses a unique memory partition and hardened WebContentsView with the fixed host preload', async () => {
    const a = await host(),
      b = await host()
    expect(a.view.origin).not.toBe(b.view.origin)
    expect(a.session).not.toBe(b.session)
    expect(fake.exports.session.fromPartition.mock.calls[0]![0]).not.toContain('persist:')
    expect(a.contents.preferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      devTools: false,
    })
    expect(a.contents.preferences.preload).toMatch(/preload[/\\]plugin-ui\.js$/)
    expect(a.session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false)
    const answer = vi.fn()
    a.session.setPermissionRequestHandler.mock.calls[0]![0](null, 'camera', answer)
    expect(answer).toHaveBeenCalledWith(false)
  })
  it('accepts only its current main-frame sender, origin, document generation and live binding', async () => {
    const f = await host(),
      call = handler(),
      generation = String(f.contents.preferences.additionalArguments).split('=')[1]
    const packet = {
      channel: PLUGIN_UI_CHANNEL,
      method: 'read',
      requestId: 'one',
      payload: {},
      configRevision: 0,
    }
    const event = { sender: f.contents, senderFrame: f.contents.mainFrame }
    expect(await call(event, { generation, packet })).toEqual({ ok: true, data: { loaves: 2 } })
    packet.method = 'proposeConfig'
    packet.payload = { loaves: 1 }
    for (const senderFrame of [null, { ...f.contents.mainFrame }])
      expect(await call({ ...event, senderFrame }, { generation, packet })).toMatchObject({
        ok: false,
      })
    expect(await call(event, { generation: 'stale', packet })).toMatchObject({ ok: false })
    expect(await call(event, { generation, packet, extra: true })).toMatchObject({ ok: false })
    f.contents.mainFrame.url = 'https://example.invalid/'
    expect(await call(event, { generation, packet })).toMatchObject({ ok: false })
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(f.proposePeer).not.toHaveBeenCalled()
    f.invalidate()
    expect(await call(event, { generation, packet })).toMatchObject({ ok: false })
  })
  it('returns a paced successful refresh through the registered main handler after Apply', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const f = await host(),
        call = handler()
      const generation = String(f.contents.preferences.additionalArguments).split('=')[1]
      const event = { sender: f.contents, senderFrame: f.contents.mainFrame }
      const request = (method: string, requestId: string, payload: unknown) =>
        call(event, {
          generation,
          packet: { channel: PLUGIN_UI_CHANNEL, method, requestId, payload, configRevision: 0 },
        })
      expect(await request('read', 'before', {})).toEqual({ ok: true, data: { loaves: 2 } })
      expect(await request('proposeConfig', 'apply', { loaves: 3 })).toEqual({
        ok: true,
        data: { proposed: true },
      })
      const refreshed = request('read', 'after', {})
      await vi.advanceTimersByTimeAsync(0)
      expect(f.read).toHaveBeenCalledOnce()
      clock.mockReturnValue(1000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await refreshed).toEqual({ ok: true, data: { loaves: 2 } })
    } finally {
      clock.mockRestore()
      vi.useRealTimers()
    }
  })
  it('denies other sessions/packages, remote/file/child network and every later main-frame request', async () => {
    const f = await host(),
      url = f.contents.url
    expect(
      f.session.request(url.replace('index.html', 'app.js'), 'GET', 'script', f.contents.id),
    ).toBe(false)
    for (const [target, method, type, id] of [
      [url, 'POST', 'xhr', f.contents.id],
      [url, 'GET', 'subFrame', f.contents.id],
      [url, 'GET', 'script', -1],
      ['https://example.invalid/', 'GET', 'script', f.contents.id],
      ['file:///fictional', 'GET', 'other', f.contents.id],
    ] as const)
      expect(f.session.request(target, method, type, id)).toBe(true)
    expect(f.session.request(url, 'GET', 'mainFrame', f.contents.id)).toBe(true)
    expect(f.contents.isDestroyed()).toBe(true)
  })
  it.each([
    'will-frame-navigate',
    'will-redirect',
    'will-attach-webview',
    'render-process-gone',
    'did-navigate-in-page',
  ])('revokes and clears the private session on %s', async (event) => {
    const f = await host(),
      preventDefault = vi.fn()
    f.contents.emit(event, { preventDefault })
    expect(f.contents.isDestroyed()).toBe(true)
    await f.view.close()
    expect(f.contents.isDestroyed()).toBe(true)
    expect(f.detached).toHaveBeenCalledOnce()
    expect(f.session.clearStorageData).toHaveBeenCalledOnce()
    expect(f.session.clearCache).toHaveBeenCalledOnce()
    expect(f.session.protocol.unhandle).toHaveBeenCalledWith('brocrew-plugin')
    if (event.startsWith('will-')) expect(preventDefault).toHaveBeenCalledOnce()
  })
  it('denies window.open and download, and invalidation tears down exactly once', async () => {
    const f = await host()
    expect(f.contents.openWindow()).toEqual({ action: 'deny' })
    expect(f.contents.isDestroyed()).toBe(true)
    await f.view.close()
    expect(f.detached).toHaveBeenCalledOnce()
    const other = await host(),
      event = { preventDefault: vi.fn() }
    other.session.emit('will-download', event)
    expect(other.contents.isDestroyed()).toBe(true)
    await other.view.close()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    const last = await host()
    last.invalidate()
    expect(last.contents.isDestroyed()).toBe(true)
    await last.view.close()
    expect(last.detached).toHaveBeenCalledOnce()
  })
  it('rechecks the actual document after a peer await before replying', async () => {
    let changeDocument = () => {}
    const f = await host(async () => {
      changeDocument()
      return { loaves: 2 }
    })
    changeDocument = () => {
      f.contents.mainFrame.url = 'https://example.invalid/replaced'
    }
    const generation = String(f.contents.preferences.additionalArguments).split('=')[1]
    const result = await handler()(
      { sender: f.contents, senderFrame: f.contents.mainFrame },
      {
        generation,
        packet: {
          channel: PLUGIN_UI_CHANNEL,
          method: 'read',
          requestId: 'changed',
          payload: {},
          configRevision: 0,
        },
      },
    )
    expect(result).toEqual({ ok: false, error: 'Plugin unavailable. Try again.' })
  })
  it('closing the host aborts its pending peer call before any late result', async () => {
    let signal: AbortSignal | undefined
    let release: () => void = () => {
      throw new Error('fictional peer not called')
    }
    const f = await host((_payload, _revision, _binding, seen) => {
      signal = seen
      return new Promise((resolve) => {
        release = () => resolve({ late: 'fictional-private-value' })
      })
    })
    const generation = String(f.contents.preferences.additionalArguments).split('=')[1]
    const call = handler()
    const pending = call(
      { sender: f.contents, senderFrame: f.contents.mainFrame },
      {
        generation,
        packet: {
          channel: PLUGIN_UI_CHANNEL,
          method: 'read',
          requestId: 'pending',
          payload: {},
          configRevision: 0,
        },
      },
    )
    await vi.waitFor(() => expect(signal?.aborted).toBe(false))
    await f.view.close()
    const abortedBeforeResult = signal?.aborted
    release()
    expect(await pending).toEqual({ ok: false, error: 'Plugin unavailable. Try again.' })
    expect(abortedBeforeResult).toBe(true)
  })
  it('does not report closed until Electron confirms destruction', async () => {
    const f = await host()
    f.contents.close.mockImplementation(() => {})
    let completed = false
    const closing = f.view.close().then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(f.session.clearStorageData).not.toHaveBeenCalled()
    f.contents.destroyed = true
    f.contents.emit('destroyed')
    await closing
    expect(completed).toBe(true)
    expect(f.session.clearStorageData).toHaveBeenCalledOnce()
  })
  it('the central app registrar also refuses unregistered contents in a plugin session', async () => {
    const f = await host(),
      backend = { handle: vi.fn(), removeHandler: vi.fn() },
      appHandler = vi.fn()
    guardedAppIpc(backend).handle('app:future-fictional-handler', appHandler)
    const call = backend.handle.mock.calls[0]![1]
    const unregistered = { session: f.session, getURL: () => 'about:blank' }
    expect(() => call({ sender: unregistered })).toThrow('Plugin unavailable.')
    expect(appHandler).not.toHaveBeenCalled()
    expect(() => call({ sender: { session: {}, getURL: () => 'about:blank' } })).not.toThrow()
    expect(appHandler).toHaveBeenCalledOnce()
  })
  it('keeps every main-process Electron IPC import on the central registration path', () => {
    const root = resolve(__dirname, '../src/main'),
      bypasses: string[] = []
    function walk(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) {
          walk(path)
          continue
        }
        if (!path.endsWith('.ts')) continue
        const source = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        )
        const file = relative(root, path).replaceAll('\\', '/')
        for (const statement of source.statements) {
          if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== 'electron'
          )
            continue
          const clause = statement.importClause
          if (!clause || clause.isTypeOnly) continue
          const imports = clause.namedBindings
          if (!imports || !ts.isNamedImports(imports)) {
            bypasses.push(file)
            continue
          }
          for (const specifier of imports.elements) {
            if (
              specifier.isTypeOnly ||
              (specifier.propertyName ?? specifier.name).text !== 'ipcMain'
            )
              continue
            if (file === 'app-ipc.ts') continue
            if (file !== 'index.ts' || specifier.name.text !== 'pluginIpcMain') {
              bypasses.push(file)
              continue
            }
            function visit(node: ts.Node) {
              if (
                ts.isIdentifier(node) &&
                node.text === 'pluginIpcMain' &&
                !ts.isImportSpecifier(node.parent)
              ) {
                const parent = node.parent
                if (
                  !ts.isCallExpression(parent) ||
                  !ts.isIdentifier(parent.expression) ||
                  parent.expression.text !== 'installPluginUiRpc' ||
                  parent.arguments.length !== 1 ||
                  parent.arguments[0] !== node
                )
                  bypasses.push(file)
              }
              ts.forEachChild(node, visit)
            }
            visit(source)
          }
        }
      }
    }
    walk(root)
    expect(bypasses).toEqual([])
  })
  it('every existing app invocation refuses plugin senders before reaching its handler', async () => {
    const f = await host(),
      backend = { handle: vi.fn(), removeHandler: vi.fn() },
      appHandler = vi.fn(() => 'private app data')
    guardedAppIpc(backend).handle('app:fictional', appHandler)
    const call = backend.handle.mock.calls[0]![1]
    expect(() => call({ sender: f.contents })).toThrow('Plugin unavailable.')
    await f.view.close()
    expect(() => call({ sender: f.contents })).toThrow()
    expect(appHandler).not.toHaveBeenCalled()
    for (const file of [
      'index.ts',
      'provider-snapshots.ts',
      'updates-in-the-app.ts',
      'workspaces-in-the-app.ts',
    ])
      expect(readFileSync(resolve(__dirname, '../src/main', file), 'utf8')).toContain(
        "import { ipcMain } from './app-ipc'",
      )
  })
})
