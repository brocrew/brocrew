import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerThemeIpc } from '../../src/main/themes/ipc'
import { themeDefaultsFor } from '../../src/main/themes/defaults'
import * as preload from '../../src/preload/theme-before-paint'
import { applyReading } from '../../src/renderer/src/lib/window-theme'
import type { ThemeDocument } from '../../src/renderer/src/lib/apply-theme'
import { writeActiveTheme } from '../../src/main/themes/state'
import { DEFINED } from './fixtures'
import { createHostFixture, putTheme, type HostFixture } from './host-fixtures'

const firstPaintChannel = 'themes:first-paint'

function loadingDocument() {
  const attributes = new Map<string, string>()
  const styles: { id: string; textContent: string | null; remove(): void }[] = []
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  }
  const head = { appendChild: (node: never) => styles.push(node) }
  const doc = {
    documentElement: null as typeof root | null,
    head: null as typeof head | null,
    getElementById: (id: string) => styles.find((node) => node.id === id) ?? null,
    createElement: () => {
      const node = {
        id: '',
        textContent: null as string | null,
        remove: () => void styles.splice(styles.indexOf(node), 1),
      }
      return node
    },
  }
  let notify = () => {}
  const disconnect = vi.fn()
  const observe = vi.fn((changed: () => void) => {
    notify = changed
    return disconnect
  })
  return {
    doc,
    root,
    styles,
    observe,
    disconnect,
    parseHead() {
      doc.documentElement = root
      notify()
      expect(styles).toHaveLength(0)
      doc.head = head
      notify()
    },
  }
}

type BeforePaint = (
  ipc: { sendSync(channel: string): unknown },
  doc: ReturnType<typeof loadingDocument>['doc'],
  observe: ReturnType<typeof loadingDocument>['observe'],
) => void

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
  await putTheme(fixture.builtIns, 'crew-night', {
    ...DEFINED,
    id: 'crew-night',
    name: 'Night',
    frame: { ...DEFINED.frame, paper: '#0b1a2e' },
  })
})
afterEach(async () => fixture.cleanup())

describe('the first surface has the cached chosen theme before an async read can finish', () => {
  it.each(['fresh', 'saved-night', 'classic'] as const)('%s at document creation', async (kind) => {
    if (kind !== 'fresh')
      await writeActiveTheme(fixture.userData, kind === 'classic' ? 'classic' : 'crew-night')
    const store = fixture.store({
      ...themeDefaultsFor(fixture.userData),
      writesItsDefault: true,
      builtInIds: ['defined', 'crew-night'],
    })
    await store.start()
    const refresh = vi.spyOn(store, 'refresh')
    const synchronous = new Map<string, (event: { returnValue?: unknown }) => void>()
    const ipc = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
      on: (channel: string, listener: (event: { returnValue?: unknown }) => void) =>
        synchronous.set(channel, listener),
      removeListener: (channel: string) => synchronous.delete(channel),
    }
    const dispose = registerThemeIpc(
      ipc as unknown as Parameters<typeof registerThemeIpc>[0],
      store,
      vi.fn(),
    )
    try {
      const handler = synchronous.get(firstPaintChannel)
      expect(
        handler,
        'the loaded theme must be available without waiting for async IPC',
      ).toBeTypeOf('function')
      const sendSync = vi.fn((channel: string) => {
        const replies: unknown[] = []
        const event = Object.defineProperty({}, 'returnValue', {
          set: (value: unknown) => replies.push(structuredClone(value)),
        })
        synchronous.get(channel)!(event)
        expect(
          replies,
          'the first assignment sends the reply, so there must be exactly one',
        ).toHaveLength(1)
        return replies[0]
      })
      const bootstrap = (preload as unknown as { themeBeforePaint?: BeforePaint }).themeBeforePaint
      expect(bootstrap).toBeTypeOf('function')
      const page = loadingDocument()
      bootstrap!({ sendSync }, page.doc, page.observe)
      expect(sendSync).toHaveBeenCalledExactlyOnceWith(firstPaintChannel)
      expect(page.observe).toHaveBeenCalledOnce()
      page.parseHead()
      // A rendering checkpoint after parsing must already see the chosen root and stylesheet.
      if (kind === 'classic') {
        expect(page.root.getAttribute('data-theme')).toBeNull()
        expect(page.styles).toEqual([])
      } else {
        expect(page.root.getAttribute('data-theme')).toBe('crew-night')
        expect(page.styles).toHaveLength(1)
        expect(page.styles[0]).toMatchObject({ id: 'brobot-theme' })
        expect(page.styles[0]!.textContent).toContain('--frame-paper: #0b1a2e')
      }
      expect(refresh).not.toHaveBeenCalled()
      expect(page.disconnect).toHaveBeenCalledOnce()
      // The normal async reading uses the same style, so settling cannot remove or duplicate it.
      applyReading(store.reading(), page.doc as ThemeDocument)
      expect(page.styles).toHaveLength(kind === 'classic' ? 0 : 1)
    } finally {
      dispose()
    }
    expect(synchronous.size).toBe(0)
  })

  it('bootstraps only the main frame in the packaged preload', async () => {
    const source = await readFile(new URL('../../src/preload/index.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/if\s*\(process\.isMainFrame\)\s*themeBeforePaint\(ipcRenderer\)/)
  })
})
