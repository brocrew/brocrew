import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { LibraryQuery, RebuiltLedger } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { ROWS, page } from './library-filter-fixture'
import { mount, unmountAll } from './harness'

let previous: PropertyDescriptor | undefined
beforeEach(() => {
  previous = Object.getOwnPropertyDescriptor(window, 'api')
  Reflect.deleteProperty(window, 'api')
  providersBridge()
})
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
  if (previous) Object.defineProperty(window, 'api', previous)
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function library(name = 'Fern', late = false) {
  const names = PROVIDER_DESCRIPTORS.map((entry) => ({
    ...entry,
    displayName: entry.id === 'claude' ? name : 'Birch',
  }))
  const naming = deferred<typeof names>()
  const rebuilding = deferred<RebuiltLedger>()
  const raw = {
    catalogue: vi.spyOn(window.api.runtime, 'providerCatalogue'),
    listLibrary: vi.fn<ClientSessionApi['listLibrary']>(async () => page()),
    rebuildLedger: vi.fn<ClientSessionApi['rebuildLedger']>(async () => ({
      outcome: 'stopped',
      status: null,
    })),
    importUserHomeSession: vi.fn<ClientSessionApi['importUserHomeSession']>(async () => ({
      outcome: 'imported',
      sessionId: 'raw-import',
      readable: true,
      note: 'Raw import.',
    })),
  }
  Object.assign(window.api.runtime, {
    listLibrary: raw.listLibrary,
    rebuildLedger: raw.rebuildLedger,
    importUserHomeSession: raw.importUserHomeSession,
  })
  const selected = {
    ...window.api.runtime,
    providerCatalogue: vi.fn(async function (this: object) {
      expect(this).toBe(selected)
      return late ? naming.promise : names
    }),
    listLibrary: vi.fn<ClientSessionApi['listLibrary']>(async function (
      this: object,
      query: LibraryQuery,
    ) {
      expect(this).toBe(selected)
      structuredClone(query)
      const entries = ROWS.filter(
        (row) => !query.filters?.provider || row.provider === query.filters?.provider,
      )
      return page({ entries, matched: entries.length })
    }),
    rebuildLedger: vi.fn<ClientSessionApi['rebuildLedger']>(function (this: object) {
      expect(this).toBe(selected)
      return rebuilding.promise
    }),
    importUserHomeSession: vi.fn<ClientSessionApi['importUserHomeSession']>(async function (
      this: object,
    ) {
      expect(this).toBe(selected)
      return {
        outcome: 'imported',
        sessionId: 'selected-import',
        readable: true,
        note: 'Native Claude import note: exact words.',
      }
    }),
  }
  const api = createDesktopProviderApi(
    () => selected,
    () => undefined,
    () => undefined,
    () => selected,
  )
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(SessionLibrary)
      },
    }),
    {},
  )
  await vi.waitFor(() => expect(view.all('library-row-claude:unimported')).toHaveLength(1))
  return { view, selected, raw, rebuilding, answer: () => naming.resolve(names) }
}
async function filter(out: Awaited<ReturnType<typeof library>>, provider: string) {
  const select = out.view.q('library-facet-provider') as HTMLSelectElement
  select.value = provider
  select.dispatchEvent(new Event('change'))
  await vi.waitFor(() =>
    expect(out.selected.listLibrary.mock.lastCall?.[0].filters?.provider).toBe(provider),
  )
}

it('uses selected names in home provenance while keeping recorded and imported origin priority', async () => {
  const out = await library()
  const row = out.view.q('library-row-claude:unimported')
  expect(row.querySelector('.chip.home')?.textContent?.trim()).toBe("in Fern's folder")
  expect(row.textContent).toContain("in Fern's own folder, not imported")
  expect(out.view.q('library-row-claude:a').querySelector('.chip.ours')?.textContent?.trim()).toBe(
    'ours',
  )
  expect(
    out.view.q('library-row-codex:behind').querySelector('.chip.imported')?.textContent?.trim(),
  ).toBe('imported')
  expect(out.raw.catalogue).not.toHaveBeenCalled()
  expect(out.raw.listLibrary).not.toHaveBeenCalled()
})

it('names a completed gone result after a late answer without rerunning rebuild or load, even across filter changes', async () => {
  const out = await library('Fern', true)
  out.view.q('library-rebuild-codex:behind').click()
  await vi.waitFor(() =>
    expect(out.selected.rebuildLedger).toHaveBeenCalledExactlyOnceWith({ sessionId: 'sess_1' }),
  )
  await filter(out, 'claude')
  out.rebuilding.resolve({ outcome: 'gone', status: null })
  await vi.waitFor(() => expect(out.selected.listLibrary.mock.calls.length).toBe(3))
  await filter(out, 'codex')
  await vi.waitFor(() => expect(out.view.all('library-outcome-codex:behind')).toHaveLength(1))
  const note = out.view.q('library-outcome-codex:behind')
  expect(note.textContent?.trim()).toBe(
    "The provider's file for this conversation is gone, so it can't be rebuilt.",
  )
  expect(note.dataset.outcome).toBe('unreadable')
  const reads = out.selected.listLibrary.mock.calls.length
  out.answer()
  await vi.waitFor(() =>
    expect(note.textContent?.trim()).toBe(
      "Birch's file for this conversation is gone, so it can't be rebuilt.",
    ),
  )
  expect(out.selected.rebuildLedger).toHaveBeenCalledExactlyOnceWith({ sessionId: 'sess_1' })
  expect(out.selected.listLibrary).toHaveBeenCalledTimes(reads)
  expect(out.raw.rebuildLedger).not.toHaveBeenCalled()
  expect(out.raw.listLibrary).not.toHaveBeenCalled()
})

it('keeps two clients distinct and preserves the exact supplied import note and provider payload', async () => {
  const one = await library('Fern')
  const two = await library('Willow')
  expect(
    one.view.q('library-row-claude:unimported').querySelector('.chip.home')?.textContent?.trim(),
  ).toBe("in Fern's folder")
  expect(
    two.view.q('library-row-claude:unimported').querySelector('.chip.home')?.textContent?.trim(),
  ).toBe("in Willow's folder")
  two.view.q('library-import-claude:unimported').click()
  await vi.waitFor(() =>
    expect(two.view.q('library-outcome-claude:unimported').textContent?.trim()).toBe(
      'Native Claude import note: exact words.',
    ),
  )
  expect(two.selected.importUserHomeSession).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    providerSessionId: 'thread-1',
  })
  expect(one.selected.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(two.selected.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(one.raw.catalogue).not.toHaveBeenCalled()
  expect(two.raw.importUserHomeSession).not.toHaveBeenCalled()
})

it('keeps an actual rejected rebuild cause verbatim with no refresh or raw fallback', async () => {
  const out = await library()
  out.selected.rebuildLedger.mockRejectedValueOnce(new Error('Native Claude failure: exact words.'))
  out.view.q('library-rebuild-codex:behind').click()
  await vi.waitFor(() =>
    expect(out.view.q('library-outcome-codex:behind').textContent?.trim()).toBe(
      'Native Claude failure: exact words.',
    ),
  )
  expect(out.selected.listLibrary).toHaveBeenCalledTimes(1)
  expect(out.raw.rebuildLedger).not.toHaveBeenCalled()
})
