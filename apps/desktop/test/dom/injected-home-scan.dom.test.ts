import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { AdoptionReport, LibraryQuery } from '../../src/shared/runtime-ipc'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { mount, unmountAll } from './harness'
import { page, REPORT, stub, stubbed } from './library-filter-fixture'

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

it('both scan surfaces capture the injected sessions capability and share its pending adoption', async () => {
  stub()
  stubbed().api!.runtime.adoptSessions = () => {
    throw new Error('global adoption must not be used')
  }
  let release!: (value: AdoptionReport) => void
  const pending = new Promise<AdoptionReport>((resolve) => {
    release = resolve
  })
  stubbed().api!.runtime.listLibrary = () => {
    throw new Error('global library reads must not be used')
  }
  stubbed().api!.runtime.listResumable = () => {
    throw new Error('global resumable reads must not be used')
  }
  stubbed().api!.runtime.listUnresumable = () => {
    throw new Error('global unresumable reads must not be used')
  }
  let calls = 0
  let reads = 0
  let adoptionCaptures = 0
  const libraryReads: LibraryQuery[] = []
  const listReads = { open: 0, closed: 0 }
  const completed = new Map<number, Set<'open' | 'closed'>>()
  let completedPairs = 0
  async function list(which: 'open' | 'closed'): Promise<never[]> {
    const ordinal = ++listReads[which]
    await Promise.resolve()
    const pair = completed.get(ordinal) ?? new Set<'open' | 'closed'>()
    pair.add(which)
    completed.set(ordinal, pair)
    if (pair.size === 2) completedPairs++
    return []
  }
  const sessions = {
    get adoptSessions() {
      adoptionCaptures++
      return function (this: unknown) {
        expect(this).toBe(sessions)
        calls++
        return pending
      }
    },
    listResumable() {
      expect(this).toBe(sessions)
      return list('open')
    },
    listUnresumable() {
      expect(this).toBe(sessions)
      return list('closed')
    },
    listLibrary(input: LibraryQuery) {
      expect(this).toBe(sessions)
      expect(input.query).toBe('')
      libraryReads.push(structuredClone(input))
      return Promise.resolve(page())
    },
  }
  const client = createDesktopProviderApi(
    () => {
      throw new Error('no provider read expected')
    },
    () => undefined,
    () => undefined,
    () => {
      reads++
      return sessions as ClientSessionApi
    },
  )
  const root = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, client)
      return () => h(SessionLibrary)
    },
  })
  const m = mount(root, {}, { width: 1100, height: 900 })
  await nextTick()
  await nextTick()
  const captured = adoptionCaptures
  expect(captured).toBe(2)
  expect(listReads).toEqual({ open: 1, closed: 1 })
  expect(completedPairs).toBe(1)
  expect(reads - completedPairs).toBe(3)
  expect(libraryReads).toHaveLength(1)
  expect(m.all('library-row-claude:unimported')).toHaveLength(1)
  m.q('library-check-homes').click()
  m.q('scan-sessions').click()
  expect(calls).toBe(1)
  release(REPORT)
  await nextTick()
  await nextTick()
  await nextTick()
  expect(m.q('library-scan-note').textContent).toContain('8 descents recorded')
  expect(m.q('scan-summary').textContent).toContain('8 descents recorded')
  expect(adoptionCaptures).toBe(captured)
  expect(calls).toBe(1)
  expect(listReads).toEqual({ open: 2, closed: 2 })
  expect(completedPairs).toBe(2)
  expect(reads - completedPairs).toBe(4)
  expect(libraryReads).toEqual([libraryReads[0], libraryReads[0]])
  expect(m.all('library-error')).toHaveLength(0)
  expect(m.all('resumable-error')).toHaveLength(0)
  expect(m.all('library-row-claude:unimported')).toHaveLength(1)
})
