import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { ExportedSession } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import type { PaletteNavigation } from '../../src/renderer/src/lib/command-palette'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { mount, unmountAll } from './harness'

const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const key = (key: string, metaKey = false) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, metaKey, bubbles: true }),
  )
function fixture(read?: ClientSessionApi['exportSession']) {
  const globalExport = vi.fn(async (): Promise<ExportedSession> => ({
    kind: 'bundle',
    path: '/wrong-window/copy.json',
    frames: 0,
    ledgerEntries: 0,
    resumable: false,
    note: 'Wrong window answer.',
  }))
  Reflect.set(window, 'api', { runtime: { exportSession: globalExport } })
  const transport = { exportSession: read }
  // Only export is exercised; other session operations are outside this surface.
  const sessions = vi.fn(() => (read === undefined ? undefined : (transport as ClientSessionApi)))
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    sessions,
  )
  const navigations: PaletteNavigation[] = []
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () =>
          h(CommandPalette, {
            conversations: [
              {
                sessionId: 'fern-session',
                provider: 'codex',
                label: 'Fern conversation',
                named: null,
                word: 'idle',
                opening: null,
                place: null,
              },
            ],
            looked: true,
            listError: null,
            activeId: 'fern-session',
            agent: null,
            onNavigate: (action: PaletteNavigation) => navigations.push(action),
          })
      },
    }),
    {},
    { width: 1200 },
  )
  return { m, sessions, transport, globalExport, navigations }
}
async function choose(kind: 'native' | 'bundle') {
  key('k', true)
  await settle()
  const row = document.querySelector<HTMLElement>(`[data-cy="palette-row-this-export-${kind}"]`)
  expect(row).not.toBeNull()
  row!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  await settle()
  expect(document.querySelector('[data-cy="palette-panel"]')).toBeNull()
}
afterEach(() => {
  unmountAll()
  for (const toast of useOverlays().toasts.value) useOverlays().dismiss(toast.id)
  Reflect.deleteProperty(window, 'api')
})
it.each(['native', 'bundle'] as const)(
  'exports %s through the ancestor client with exact payload and awaited host words, even after unmount',
  async (kind) => {
    let finish!: (value: ExportedSession) => void
    const pending = new Promise<ExportedSession>((resolve) => {
      finish = resolve
    })
    let expectedReceiver: unknown
    const read = vi.fn<ClientSessionApi['exportSession']>(function (this: unknown) {
      expect(this).toBe(expectedReceiver)
      return pending
    })
    const out = fixture(read)
    expectedReceiver = out.transport
    expect(out.sessions).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    await choose(kind)
    expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId: 'fern-session', exportKind: kind })
    expect(useOverlays().toasts.value).toHaveLength(0)
    expect(out.navigations).toEqual([])
    out.m.unmount()
    finish({
      kind,
      path: `/supplied/${kind}.copy`,
      frames: 3,
      ledgerEntries: 9,
      resumable: false,
      note: `Supplied ${kind} meaning.`,
    })
    await settle()
    expect(useOverlays().toasts.value.at(-1)?.text).toBe(
      `/supplied/${kind}.copy — Supplied ${kind} meaning.`,
    )
    expect(out.globalExport).not.toHaveBeenCalled()
  },
)
it('reports the supplied readable failure without navigation or a window fallback', async () => {
  const read = vi.fn<ClientSessionApi['exportSession']>(async () => {
    throw new Error(
      "Error invoking remote method 'runtime:command': Error: Fern could not write its copy.",
    )
  })
  const out = fixture(read)
  await choose('native')
  expect(useOverlays().toasts.value.at(-1)?.text).toBe(
    'Nothing was exported: Fern could not write its copy.',
  )
  expect(out.navigations).toEqual([])
  expect(out.globalExport).not.toHaveBeenCalled()
})
it('mounts without the optional capability and reports absence only on the export gesture', async () => {
  const out = fixture()
  expect(out.sessions).not.toHaveBeenCalled()
  expect(useOverlays().toasts.value).toHaveLength(0)
  await choose('bundle')
  expect(useOverlays().toasts.value.at(-1)?.text).toBe(
    'Nothing was exported: Session export is not available in this window.',
  )
  expect(out.navigations).toEqual([])
  expect(out.globalExport).not.toHaveBeenCalled()
})

it('keeps the captured client across two gestures while resolving its current lazy supplier', async () => {
  const answer: ExportedSession = {
    kind: 'native',
    path: '/fern/first',
    frames: 1,
    ledgerEntries: 0,
    resumable: false,
    note: 'First supplied meaning.',
  }
  const first = vi.fn<ClientSessionApi['exportSession']>(async () => answer)
  const out = fixture(first)
  expect(out.sessions).not.toHaveBeenCalled()
  await choose('native')
  const secondTransport = {
    exportSession: vi.fn<ClientSessionApi['exportSession']>(async function (this: unknown) {
      expect(this).toBe(secondTransport)
      return { ...answer, kind: 'bundle', path: '/fern/second', note: 'Second supplied meaning.' }
    }),
  }
  out.sessions.mockReturnValueOnce(secondTransport as unknown as ClientSessionApi)
  const changedGlobal = vi.fn(async () => ({ ...answer, path: '/changed-window/wrong' }))
  Reflect.set(window, 'api', { runtime: { exportSession: changedGlobal } })
  await choose('bundle')
  expect(first).toHaveBeenCalledExactlyOnceWith({ sessionId: 'fern-session', exportKind: 'native' })
  expect(secondTransport.exportSession).toHaveBeenCalledExactlyOnceWith({
    sessionId: 'fern-session',
    exportKind: 'bundle',
  })
  expect(out.sessions).toHaveBeenCalledTimes(2)
  expect(useOverlays().toasts.value.map((toast) => toast.text)).toEqual([
    '/fern/first — First supplied meaning.',
    '/fern/second — Second supplied meaning.',
  ])
  expect(out.globalExport).not.toHaveBeenCalled()
  expect(changedGlobal).not.toHaveBeenCalled()
})
it('reports an older capability with no export operation through the same absence notification', async () => {
  const out = fixture()
  out.sessions.mockReturnValueOnce({} as ClientSessionApi)
  await choose('native')
  expect(useOverlays().toasts.value.at(-1)?.text).toBe(
    'Nothing was exported: Session export is not available in this window.',
  )
  expect(out.globalExport).not.toHaveBeenCalled()
})
it('preserves a present lazy supplier failure through readableError without failing setup', async () => {
  const out = fixture()
  out.sessions.mockImplementationOnce(() => {
    throw new Error(
      "Error invoking remote method 'runtime:command': Error: Fern session transport is restarting.",
    )
  })
  expect(out.sessions).not.toHaveBeenCalled()
  await choose('bundle')
  expect(useOverlays().toasts.value.at(-1)?.text).toBe(
    'Nothing was exported: Fern session transport is restarting.',
  )
  expect(out.globalExport).not.toHaveBeenCalled()
})
