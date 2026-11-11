import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { AdoptionReport } from '../../src/shared/runtime-ipc'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { mount, unmountAll } from './harness'
import { REPORT, stub, stubbed } from './library-filter-fixture'

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
  let calls = 0
  let reads = 0
  const sessions = {
    adoptSessions() {
      expect(this).toBe(sessions)
      calls++
      return pending
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
  const captured = reads
  expect(captured).toBe(2)
  m.q('library-check-homes').click()
  m.q('scan-sessions').click()
  expect(calls).toBe(1)
  release(REPORT)
  await nextTick()
  await nextTick()
  await nextTick()
  expect(m.q('library-scan-note').textContent).toContain('8 descents recorded')
  expect(m.q('scan-summary').textContent).toContain('8 descents recorded')
  expect(reads).toBe(captured)
})
