import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECOVERY_CHANNELS, type RecoveryBridge } from '../../src/shared/recovery'
import { HIDDEN_TITLE } from '../../src/main/launch-presentation'
import { permitsNavigation } from '../../src/main/window-navigation'
import {
  openRecoveryWindow,
  recoveryDocument,
  registerRecoveryIpc,
  tellTheWindow,
} from '../../src/main/recovery-window'
import type { RecoveryCalls } from '../../src/main/recovery/window-calls'

/**
 * The recovery window and its preload, with Electron stood in for: what the window is made with,
 * what it loads, that it is guarded and released like the app's own, that only its own top frame
 * is answered, and that its preload exposes `window.recovery` and nothing else.
 */

type Listener = (...args: unknown[]) => unknown

const electron = vi.hoisted(() => {
  const windows: {
    options: Record<string, unknown>
    events: Map<string, Listener>
    contents: Map<string, Listener[]>
    opener: Listener | null
    title: string
    shown: number
    loaded: string[]
  }[] = []
  const exposed: [string, unknown][] = []
  const invoked: unknown[][] = []
  const listening: [string, Listener][] = []
  const stopped: [string, Listener][] = []
  return { windows, exposed, invoked, listening, stopped }
})

vi.mock('electron', () => {
  class BrowserWindow {
    readonly record: (typeof electron.windows)[number]
    readonly webContents: Record<string, unknown>
    constructor(options: Record<string, unknown>) {
      const record = {
        options,
        events: new Map<string, Listener>(),
        contents: new Map<string, Listener[]>(),
        opener: null as Listener | null,
        title: '',
        shown: 0,
        loaded: [] as string[],
      }
      this.record = record
      electron.windows.push(record)
      this.webContents = {
        id: 7,
        on: (event: string, listener: Listener) => {
          record.contents.set(event, [...(record.contents.get(event) ?? []), listener])
        },
        setWindowOpenHandler: (handler: Listener) => {
          record.opener = handler
        },
        setBackgroundThrottling: () => undefined,
      }
    }
    on(event: string, listener: Listener): this {
      this.record.events.set(event, listener)
      return this
    }
    setTitle(title: string): void {
      this.record.title = title
    }
    show(): void {
      this.record.shown += 1
    }
    loadFile(path: string): Promise<void> {
      this.record.loaded.push(`file ${path}`)
      return Promise.resolve()
    }
    loadURL(url: string): Promise<void> {
      this.record.loaded.push(url)
      return Promise.resolve()
    }
  }
  return {
    BrowserWindow,
    contextBridge: {
      exposeInMainWorld: (name: string, api: unknown) => electron.exposed.push([name, api]),
    },
    ipcRenderer: {
      invoke: (...args: unknown[]) => {
        electron.invoked.push(args)
        return Promise.resolve(null)
      },
      on: (channel: string, listener: Listener) => electron.listening.push([channel, listener]),
      removeListener: (channel: string, listener: Listener) =>
        electron.stopped.push([channel, listener]),
    },
  }
})

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../../src')

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  electron.windows.splice(0)
})

function aWindow(hidden: boolean): {
  readonly made: (typeof electron.windows)[number]
  readonly said: string[]
} {
  const said: string[] = []
  openRecoveryWindow({
    hidden,
    openExternal: (url) => said.push(`external ${url}`),
    release: () => said.push('release'),
    onClosed: () => said.push('closed'),
  })
  const made = electron.windows.at(-1)
  if (made === undefined) throw new Error('no window was made')
  return { made, said }
}

describe('the recovery window', () => {
  it('is made sandboxed and isolated, with its own preload, and shown when it is ready', () => {
    const { made } = aWindow(false)
    expect(made.options).toMatchObject({
      show: false,
      title: 'BroCrew',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const preload = (made.options['webPreferences'] as { preload: string }).preload
    expect(preload.endsWith(`${sep}preload${sep}recovery.js`)).toBe(true)
    expect(made.shown).toBe(0)
    made.events.get('ready-to-show')?.()
    expect(made.shown).toBe(1)
  })

  it('is kept out of sight on a hidden launch, and never shown', () => {
    const { made } = aWindow(true)
    expect(made.title).toBe(HIDDEN_TITLE)
    made.events.get('ready-to-show')?.()
    expect(made.shown).toBe(0)
  })

  it('loads recovery.html: the packaged file, or the dev server’s page', () => {
    const packaged = aWindow(false).made
    expect(packaged.loaded).toEqual([`file ${recoveryDocument(undefined).indexHtml}`])
    expect(
      recoveryDocument(undefined).indexHtml.endsWith(`${sep}renderer${sep}recovery.html`),
    ).toBe(true)
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5290')
    expect(aWindow(false).made.loaded).toEqual(['http://localhost:5290/recovery.html'])
  })

  it('is guarded and released like the app’s own window', () => {
    const { made, said } = aWindow(false)
    for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      expect(made.contents.get(event), event).toHaveLength(1)
    }
    expect(made.opener).not.toBeNull()
    for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) {
      made.contents.get(event)?.[0]?.()
    }
    expect(said).toEqual(['release', 'release', 'release'])
    made.events.get('closed')?.()
    expect(said.at(-1)).toBe('closed')
  })

  it('admits its own document and refuses the app’s, in both builds', () => {
    const packaged = recoveryDocument(undefined)
    expect(permitsNavigation(packaged, pathToFileURL(packaged.indexHtml).href)).toBe(true)
    const app = join(dirname(packaged.indexHtml), 'index.html')
    expect(permitsNavigation(packaged, pathToFileURL(app).href)).toBe(false)
    const dev = recoveryDocument('http://localhost:5290/')
    expect(dev.devServerUrl).toBe('http://localhost:5290/recovery.html')
    expect(permitsNavigation(dev, 'http://localhost:5290/recovery.html')).toBe(true)
    expect(permitsNavigation(dev, 'http://localhost:5290/')).toBe(false)
    expect(permitsNavigation(dev, 'http://localhost:5290/index.html')).toBe(false)
  })
})

describe('the recovery window’s calls, as main receives them', () => {
  const answered: [string, readonly unknown[]][] = []
  const calls = {
    answer: (channel: string, args: readonly unknown[]) => {
      answered.push([channel, args])
      return Promise.resolve('answered')
    },
  } as unknown as RecoveryCalls
  const handlers = new Map<string, Listener>()
  const theWindow = { isDestroyed: () => false, webContents: { id: 7 } }
  let open: typeof theWindow | null = theWindow
  registerRecoveryIpc(
    { handle: (channel: string, handler: Listener) => handlers.set(channel, handler) } as never,
    () => open as never,
    calls,
  )
  const ask = (event: unknown, ...args: unknown[]): unknown =>
    handlers.get(RECOVERY_CHANNELS.restore)?.(event, ...args)

  it('are registered for every channel the window invokes', () => {
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(RECOVERY_CHANNELS)
        .filter((channel) => channel !== RECOVERY_CHANNELS.progress)
        .sort(),
    )
  })

  it('are answered only for the recovery window’s own top frame', async () => {
    const top = { sender: { id: 7 }, senderFrame: { parent: null } }
    expect(await ask(top, 'a-copy')).toBe('answered')
    expect(answered).toEqual([[RECOVERY_CHANNELS.restore, ['a-copy']]])
    expect(() => ask({ sender: { id: 8 }, senderFrame: { parent: null } })).toThrow(
      /Only the recovery window/,
    )
    expect(() => ask({ sender: { id: 7 }, senderFrame: { parent: {} } })).toThrow()
    expect(() => ask({ sender: { id: 7 }, senderFrame: null })).toThrow()
    open = null
    expect(() => ask(top)).toThrow()
    open = theWindow
    expect(answered).toHaveLength(1)
  })

  it('tell the window a settled verdict, and progress, and nothing once it is gone', () => {
    const sent: unknown[][] = []
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sent.push(args) },
    }
    const verdict = { kind: 'open', checkpoint: 'made' } as const
    tellTheWindow(window as never, { verdict })
    tellTheWindow(window as never, { done: 2, total: 6 })
    expect(sent).toEqual([
      [RECOVERY_CHANNELS.verdict, verdict],
      [RECOVERY_CHANNELS.progress, { done: 2, total: 6 }],
    ])
    tellTheWindow({ ...window, isDestroyed: () => true } as never, { verdict })
    tellTheWindow(null, { verdict })
    expect(sent).toHaveLength(2)
  })
})

describe('the recovery preload', () => {
  it('exposes window.recovery and nothing else, each call on its own channel', async () => {
    await import('../../src/preload/recovery')
    expect(electron.exposed.map(([name]) => name)).toEqual(['recovery'])
    const bridge = electron.exposed[0]?.[1] as RecoveryBridge
    expect(Object.keys(bridge).sort()).toEqual(
      [
        'history',
        'onProgress',
        'onVerdict',
        'quit',
        'resolveMessagePaths',
        'restore',
        'retry',
        'returnToNewer',
        'revealMessagePath',
        'verdict',
        'zone',
      ].sort(),
    )
    expect(Object.keys(bridge.history).sort()).toEqual(['conversations', 'transcript'])

    await bridge.verdict()
    await bridge.restore('a-copy')
    await bridge.returnToNewer()
    await bridge.retry()
    await bridge.zone()
    await bridge.quit()
    await bridge.history.conversations()
    await bridge.history.transcript('conversation-1')
    await bridge.resolveMessagePaths({ sessionId: 'conversation-1', texts: ['notes.md'] })
    await bridge.revealMessagePath({ sessionId: null, text: '/tmp' })
    expect(electron.invoked).toEqual([
      [RECOVERY_CHANNELS.verdict],
      [RECOVERY_CHANNELS.restore, 'a-copy'],
      [RECOVERY_CHANNELS.return],
      [RECOVERY_CHANNELS.retry],
      [RECOVERY_CHANNELS.zone],
      [RECOVERY_CHANNELS.quit],
      [RECOVERY_CHANNELS.conversations],
      [RECOVERY_CHANNELS.transcript, 'conversation-1'],
      [RECOVERY_CHANNELS.messagePaths, { sessionId: 'conversation-1', texts: ['notes.md'] }],
      [RECOVERY_CHANNELS.revealMessagePath, { sessionId: null, text: '/tmp' }],
    ])

    const heard: unknown[] = []
    const stopProgress = bridge.onProgress((done, total) => heard.push([done, total]))
    const stopVerdicts = bridge.onVerdict((verdict) => heard.push(verdict))
    const [progressChannel, progress] = electron.listening[0] ?? []
    const [verdictChannel, verdicts] = electron.listening[1] ?? []
    expect([progressChannel, verdictChannel]).toEqual([
      RECOVERY_CHANNELS.progress,
      RECOVERY_CHANNELS.verdict,
    ])
    progress?.({}, { done: 1, total: 2 })
    verdicts?.({}, { kind: 'open', checkpoint: 'made' })
    expect(heard).toEqual([[1, 2], { kind: 'open', checkpoint: 'made' }])
    stopProgress()
    stopVerdicts()
    expect(electron.stopped).toEqual(electron.listening)
  })

  /**
   * A sandboxed preload can load no module but `electron`, so a shared chunk the build might make
   * for anything it imports would stop it from loading. Every other import must be `import type`,
   * which the build drops: an `import { type X }` can still leave a bare import behind.
   */
  it('loads no module but electron: every other import is a type, so no shared chunk can appear', () => {
    const preload = readFileSync(join(SRC, 'preload', 'recovery.ts'), 'utf8')
    expect(modulesLoadedBy(preload)).toEqual(['electron'])
    expect(preload).toMatch(/^import type \{[^}]*\} from '\.\.\/shared\/recovery'$/m)

    // Each way a module could come back in is seen.
    for (const [planted, loaded] of [
      ["import { RECOVERY_CHANNELS } from '../shared/recovery'", '../shared/recovery'],
      ["import { type StartupVerdict } from '../shared/recovery'", '../shared/recovery'],
      ["import '../shared/recovery'", '../shared/recovery'],
      ["export { RECOVERY_CHANNELS } from '../shared/recovery'", '../shared/recovery'],
      ["const shared = await import('../shared/recovery')", '../shared/recovery'],
      ["const shared = require('../shared/recovery')", '../shared/recovery'],
    ] as const) {
      expect(modulesLoadedBy(`${planted}\n${preload}`)).toEqual([loaded, 'electron'])
    }
    expect(modulesLoadedBy("import type { X } from '../shared/recovery'")).toEqual([])
  })
})

/** The modules `source` loads when it runs: every import, export-from or require but a type's. */
function modulesLoadedBy(source: string): string[] {
  const file = ts.createSourceFile('preload.ts', source, ts.ScriptTarget.Latest, true)
  const loaded: string[] = []
  const named = (node: ts.Expression | undefined): string =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : '(computed)'
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
      loaded.push(named(node.moduleSpecifier))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      loaded.push(named(node.moduleSpecifier))
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      loaded.push('(import =)')
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      loaded.push(named(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return loaded
}
