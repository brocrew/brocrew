import { afterEach, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import type { ImportedBundle, LibraryPage } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { sessionClientView } from '../lib/session-client-view'
import { mount, unmountAll, type Mounted } from './harness'
import { page, stub, stubbed } from './library-filter-fixture'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

const restored: ImportedBundle = {
  ok: true,
  sessionId: 'fictional-bundle',
  already: false,
  provider: 'claude',
  cwd: '/fictional/source',
  events: 17,
}

function open() {
  stub()
  let available = true
  let lookupFailure: Error | undefined
  const raw = vi.fn(async (): Promise<ImportedBundle> => ({ ok: false, reason: 'raw opposite' }))
  window.api.runtime.importBundleFile = raw
  const list = vi.fn(async () => page())
  window.api.runtime.listLibrary = list
  const sessions = {
    ...window.api.runtime,
    importBundleFile: vi.fn<(input: { path: string }) => Promise<ImportedBundle>>(async function (
      this: unknown,
      input,
    ) {
      expect(this).toBe(sessions)
      expect(input).toEqual({ path: '/fictional/bundle.json' })
      return restored
    }),
  }
  const root = sessionClientView(
    CLIENT_PROVIDERS,
    () => {
      if (lookupFailure) throw lookupFailure
      return available ? sessions : undefined
    },
    () => () => h(SessionLibrary),
  )
  const view = mount(root, {}, { width: 1100, height: 900 })
  return {
    view,
    sessions,
    list,
    raw,
    unavailable() {
      available = false
    },
    failLookup() {
      lookupFailure = new Error('fictional session getter failed')
    },
  }
}

async function ready() {
  await nextTick()
  await nextTick()
  await nextTick()
}

async function type(view: Mounted, value: string) {
  const field = view.q('library-bundle-path') as HTMLInputElement
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
}

function enter(view: Mounted) {
  view.q('library-bundle-path').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

it('uses the injected receiver and keeps one restore busy through its successful refresh', async () => {
  const { view, sessions, list, raw } = open()
  await ready()
  const importing = deferred<ImportedBundle>()
  const refresh = deferred<LibraryPage>()
  sessions.importBundleFile.mockReturnValueOnce(importing.promise)
  list.mockReturnValueOnce(refresh.promise)
  await type(view, '  /fictional/bundle.json  ')
  view.q('library-bundle-restore').click()
  await ready()
  enter(view)
  expect(sessions.importBundleFile).toHaveBeenCalledTimes(1)
  expect(sessions.importBundleFile.mock.contexts[0]).toBe(sessions)
  expect(sessions.importBundleFile.mock.calls).toEqual([[{ path: '/fictional/bundle.json' }]])
  expect(view.q('library-bundle-restore').textContent).toContain('Restoring…')
  expect(view.q('library-bundle-restore').hasAttribute('disabled')).toBe(true)
  importing.resolve(restored)
  await ready()
  expect(list).toHaveBeenCalledTimes(2)
  expect(view.q('library-bundle-result').textContent).toContain('Restored 17 entries')
  expect(view.q('library-bundle-result').textContent).toContain('/fictional/source')
  expect(view.q('library-bundle-result').textContent).toContain('no Resume')
  expect(view.q('library-bundle-restore').hasAttribute('disabled')).toBe(true)
  enter(view)
  expect(sessions.importBundleFile).toHaveBeenCalledTimes(1)
  refresh.resolve(page())
  await ready()
  expect(view.q('library-bundle-restore').hasAttribute('disabled')).toBe(false)
  expect(raw).not.toHaveBeenCalled()
  await type(view, '/fictional/other.json')
  expect(view.all('library-bundle-result')).toHaveLength(0)
})

it('shows the supplied refusal without refreshing and retries the current path', async () => {
  const { view, sessions, list, raw } = open()
  await ready()
  sessions.importBundleFile.mockResolvedValueOnce({ ok: false, reason: 'fictional bundle refused' })
  await type(view, '/fictional/bundle.json')
  enter(view)
  await ready()
  expect(view.q('library-bundle-result').textContent).toContain('fictional bundle refused')
  expect(view.q('library-bundle-result').getAttribute('role')).toBe('alert')
  expect(list).toHaveBeenCalledTimes(1)
  expect(view.q('library-bundle-restore').hasAttribute('disabled')).toBe(false)
  await type(view, '/fictional/retry.json')
  sessions.importBundleFile.mockResolvedValueOnce(restored)
  enter(view)
  await ready()
  expect(sessions.importBundleFile.mock.calls[1]).toEqual([{ path: '/fictional/retry.json' }])
  expect(list).toHaveBeenCalledTimes(2)
  expect(raw).not.toHaveBeenCalled()
})

it.each([
  ['missing capability', 'Session library is unavailable'],
  ['missing method', 'Session library is unavailable'],
  ['throwing session getter', 'fictional session getter failed'],
  ['throwing method getter', 'fictional method getter failed'],
  ['rejected operation', 'fictional import failed'],
])('reports %s inside the restore outcome and releases busy', async (failure, sentence) => {
  const { view, sessions, list, raw, unavailable, failLookup } = open()
  await ready()
  if (failure === 'missing capability') unavailable()
  if (failure === 'missing method') {
    Object.defineProperty(sessions, 'importBundleFile', { value: undefined })
  }
  if (failure === 'throwing session getter') failLookup()
  if (failure === 'throwing method getter') {
    Object.defineProperty(sessions, 'importBundleFile', {
      get() {
        throw new Error('fictional method getter failed')
      },
    })
  }
  if (failure === 'rejected operation') {
    sessions.importBundleFile.mockRejectedValueOnce(new Error('fictional import failed'))
  }
  await type(view, '/fictional/bundle.json')
  enter(view)
  await ready()
  expect(view.q('library-bundle-result').textContent).toContain(sentence)
  expect(view.q('library-bundle-result').getAttribute('role')).toBe('alert')
  expect(view.q('library-bundle-restore').hasAttribute('disabled')).toBe(false)
  expect(list).toHaveBeenCalledTimes(1)
  expect(raw).not.toHaveBeenCalled()
})
