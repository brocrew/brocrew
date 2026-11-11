import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type {
  ImportedFromHome,
  LibraryPage,
  LibraryQuery,
  RebuiltLedger,
} from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { mount, unmountAll } from './harness'
import { page, stub, stubbed } from './library-filter-fixture'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function open(available = true) {
  let lookupFailure: Error | undefined
  stub()
  const raw = {
    listLibrary: vi.fn(() => Promise.resolve(page())),
    importUserHomeSession: vi.fn(() => Promise.reject(new Error('raw import'))),
    rebuildLedger: vi.fn(() => Promise.reject(new Error('raw rebuild'))),
  }
  Object.assign(stubbed().api!.runtime, raw)
  const sessions = {
    listLibrary: vi.fn(function (this: unknown, input: LibraryQuery) {
      expect(this).toBe(sessions)
      structuredClone(input)
      return Promise.resolve(page())
    }),
    importUserHomeSession: vi.fn<
      (input: { provider: string; providerSessionId: string }) => Promise<ImportedFromHome>
    >(function (this: unknown) {
      expect(this).toBe(sessions)
      return Promise.resolve({
        outcome: 'imported',
        sessionId: 'fictional-import',
        readable: true,
        note: 'Fictional import complete',
      })
    }),
    rebuildLedger: vi.fn<(input: { sessionId: string }) => Promise<RebuiltLedger>>(function (
      this: unknown,
    ) {
      expect(this).toBe(sessions)
      return Promise.resolve({ outcome: 'stopped', status: null })
    }),
  }
  const client = createDesktopProviderApi(
    () => {
      throw new Error('unexpected provider call')
    },
    () => undefined,
    () => undefined,
    () => {
      if (lookupFailure) throw lookupFailure
      return available ? (sessions as unknown as ClientSessionApi) : undefined
    },
  )
  const root = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, client)
      return () => h(SessionLibrary)
    },
  })
  const view = mount(root, {})
  return {
    view,
    sessions,
    raw,
    setAvailable(value: boolean) {
      available = value
    },
    failLookup(cause: Error) {
      lookupFailure = cause
    },
  }
}

async function ready() {
  await nextTick()
  await nextTick()
  await nextTick()
}
function search(view: ReturnType<typeof mount>, value: string) {
  const input = view.q('library-search') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

it('reads through the injected receiver with plain current query and provider filters', async () => {
  const { view, sessions, raw } = open()
  await ready()
  expect(view.all('library-row-claude:unimported')).toHaveLength(1)
  search(view, 'fictional parser')
  const provider = view.q('library-facet-provider') as HTMLSelectElement
  provider.value = 'codex'
  provider.dispatchEvent(new Event('change'))
  await expect.poll(() => sessions.listLibrary.mock.calls.length).toBe(2)
  expect(sessions.listLibrary.mock.calls[1]![0]).toMatchObject({
    query: 'fictional parser',
    filters: { provider: 'codex' },
  })
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it('suppresses a late injected read failure after the current request succeeds', async () => {
  const { view, sessions, raw } = open()
  await ready()
  const old = deferred<LibraryPage>()
  sessions.listLibrary.mockReturnValueOnce(old.promise)
  search(view, 'old')
  await expect.poll(() => sessions.listLibrary.mock.calls.length).toBe(2)
  search(view, 'current')
  await expect.poll(() => sessions.listLibrary.mock.calls.length).toBe(3)
  old.reject(new Error('late fictional read failure'))
  await ready()
  expect(view.all('library-error')).toHaveLength(0)
  expect(view.all('library-row-claude:unimported')).toHaveLength(1)
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it('keeps injected import busy through its refresh and preserves payload and outcome', async () => {
  const { view, sessions, raw } = open()
  await ready()
  const importing = deferred<ImportedFromHome>()
  const refresh = deferred<LibraryPage>()
  sessions.importUserHomeSession.mockReturnValueOnce(importing.promise)
  sessions.listLibrary.mockReturnValueOnce(refresh.promise)
  const button = view.q('library-import-claude:unimported') as HTMLButtonElement
  button.click()
  await ready()
  button.click()
  expect(button.disabled).toBe(true)
  expect(sessions.importUserHomeSession.mock.contexts[0]).toBe(sessions)
  expect(sessions.importUserHomeSession.mock.calls).toEqual([
    [{ provider: 'claude', providerSessionId: 'thread-1' }],
  ])
  importing.resolve({
    outcome: 'imported',
    sessionId: 'fictional-import',
    readable: true,
    note: 'Fictional import complete',
  })
  await ready()
  expect(button.disabled).toBe(true)
  expect(sessions.listLibrary).toHaveBeenCalledTimes(2)
  refresh.resolve(page())
  await ready()
  expect(button.disabled).toBe(false)
  expect(view.q('library-outcome-claude:unimported').textContent).toContain(
    'Fictional import complete',
  )
  expect(raw.importUserHomeSession).not.toHaveBeenCalled()
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it('keeps injected rebuild busy through refresh and preserves its receiver and payload', async () => {
  const { view, sessions, raw } = open()
  await ready()
  const rebuilding = deferred<RebuiltLedger>()
  const refresh = deferred<LibraryPage>()
  sessions.rebuildLedger.mockReturnValueOnce(rebuilding.promise)
  sessions.listLibrary.mockReturnValueOnce(refresh.promise)
  const button = view.q('library-rebuild-codex:behind') as HTMLButtonElement
  button.click()
  await ready()
  button.click()
  expect(button.disabled).toBe(true)
  expect(sessions.rebuildLedger.mock.contexts[0]).toBe(sessions)
  expect(sessions.rebuildLedger.mock.calls).toEqual([[{ sessionId: 'sess_1' }]])
  rebuilding.resolve({ outcome: 'stopped', status: null })
  await ready()
  expect(button.disabled).toBe(true)
  expect(sessions.listLibrary).toHaveBeenCalledTimes(2)
  refresh.resolve(page())
  await ready()
  expect(button.disabled).toBe(false)
  expect(view.q('library-outcome-codex:behind').textContent).not.toBe('')
  expect(raw.rebuildLedger).not.toHaveBeenCalled()
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it('shows injected import and rebuild failures without refreshing or falling back', async () => {
  const { view, sessions, raw } = open()
  await ready()
  sessions.importUserHomeSession.mockRejectedValueOnce(new Error('fictional import failed'))
  sessions.rebuildLedger.mockRejectedValueOnce(new Error('fictional rebuild failed'))
  view.q('library-import-claude:unimported').click()
  view.q('library-rebuild-codex:behind').click()
  await ready()
  expect(view.q('library-outcome-claude:unimported').textContent).toContain(
    'fictional import failed',
  )
  expect(view.q('library-outcome-codex:behind').textContent).toContain('fictional rebuild failed')
  expect((view.q('library-import-claude:unimported') as HTMLButtonElement).disabled).toBe(false)
  expect((view.q('library-rebuild-codex:behind') as HTMLButtonElement).disabled).toBe(false)
  expect(sessions.listLibrary).toHaveBeenCalledTimes(1)
  expect(raw.importUserHomeSession).not.toHaveBeenCalled()
  expect(raw.rebuildLedger).not.toHaveBeenCalled()
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it('renders missing injected sessions as the existing read error without a mount failure or raw fallback', async () => {
  const { view, raw } = open(false)
  await ready()
  expect(view.q('library-error').textContent).not.toBe('')
  expect(view.q('library-error').textContent?.toLowerCase()).toContain('unavailable')
  expect(raw.listLibrary).not.toHaveBeenCalled()
})

it.each(['read', 'import', 'rebuild'] as const)(
  'preserves a supplied capability getter failure for %s',
  async (operation) => {
    const { view, sessions, raw, failLookup } = open()
    await ready()
    failLookup(new Error('Fictional capability getter failed'))
    if (operation === 'read') {
      search(view, 'getter failure')
      await expect.poll(() => view.all('library-error').length).toBe(1)
      expect(view.q('library-error').textContent).toContain('Fictional capability getter failed')
    } else {
      const id = operation === 'import' ? 'claude:unimported' : 'codex:behind'
      view.q(`library-${operation}-${id}`).click()
      await ready()
      expect(view.q(`library-outcome-${id}`).textContent).toContain(
        'Fictional capability getter failed',
      )
      expect((view.q(`library-${operation}-${id}`) as HTMLButtonElement).disabled).toBe(false)
    }
    expect(sessions.listLibrary).toHaveBeenCalledTimes(1)
    expect(sessions.importUserHomeSession).not.toHaveBeenCalled()
    expect(sessions.rebuildLedger).not.toHaveBeenCalled()
    expect(raw.listLibrary).not.toHaveBeenCalled()
    expect(raw.importUserHomeSession).not.toHaveBeenCalled()
    expect(raw.rebuildLedger).not.toHaveBeenCalled()
  },
)

it.each(['import', 'rebuild'] as const)(
  'reports unavailable sessions during %s through its existing row failure',
  async (operation) => {
    const { view, sessions, raw, setAvailable } = open()
    await ready()
    setAvailable(false)
    const id = operation === 'import' ? 'claude:unimported' : 'codex:behind'
    view.q(`library-${operation}-${id}`).click()
    await ready()
    expect(view.q(`library-outcome-${id}`).textContent?.toLowerCase()).toContain('unavailable')
    expect((view.q(`library-${operation}-${id}`) as HTMLButtonElement).disabled).toBe(false)
    expect(sessions.listLibrary).toHaveBeenCalledTimes(1)
    expect(sessions.importUserHomeSession).not.toHaveBeenCalled()
    expect(sessions.rebuildLedger).not.toHaveBeenCalled()
    expect(raw.listLibrary).not.toHaveBeenCalled()
    expect(raw.importUserHomeSession).not.toHaveBeenCalled()
    expect(raw.rebuildLedger).not.toHaveBeenCalled()
  },
)
