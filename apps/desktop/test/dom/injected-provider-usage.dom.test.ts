import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, type ShallowRef } from 'vue'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import {
  useProviderUsage,
  type ProviderUsage,
} from '../../src/renderer/src/composables/useProviderUsage'
import { usageClient } from '../lib/provider-usage-client'
import { mount, unmountAll } from './harness'

function answer(usedPercent: number): ProviderUsage {
  return {
    claude: [
      {
        window: 'seven_day',
        period: { word: 'Fern minute', durationMs: 60_000, bucket: false, bucketName: null },
        usedPercent,
        resetsAt: null,
        at: 17,
      },
    ],
    codex: [],
  }
}
function pending() {
  let resolve!: (value: ProviderUsage) => void
  const promise = new Promise<ProviderUsage>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
function surface(api: ClientProviderApi) {
  let held!: Readonly<ShallowRef<ProviderUsage | null>>
  const child = defineComponent({
    setup() {
      held = useProviderUsage()
      return () => h('span', { 'data-cy': 'usage' }, JSON.stringify(held.value))
    },
  })
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(child)
      },
    }),
    {},
  )
  return { m, held: () => held }
}
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('shares one read/listener, retains its last answer on dispose and invalidates pending answers across remount', async () => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Injected usage reached desktop globals')
    },
  })
  const f = usageClient()
  const first = pending()
  f.read.mockReturnValueOnce(first.promise)
  const a = surface(f.api)
  const b = surface(f.api)
  expect(a.held()).toBe(b.held())
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(f.subscribe).toHaveBeenCalledTimes(1)
  expect(f.listeners.size).toBe(1)
  expect(a.held().value).toBeNull()
  const current = answer(37)
  first.resolve(current)
  await settle()
  expect(a.held().value).toBe(current)
  expect(b.m.q('usage').textContent).toContain('Fern minute')
  f.notice('key')
  expect(f.read).toHaveBeenCalledTimes(1)
  a.m.unmount()
  expect(f.off).not.toHaveBeenCalled()
  const old = pending()
  f.read.mockReturnValueOnce(old.promise)
  f.notice('login')
  expect(f.read).toHaveBeenCalledTimes(2)
  b.m.unmount()
  expect(f.off).toHaveBeenCalledTimes(1)
  expect(f.listeners.size).toBe(0)
  const remount = pending()
  f.read.mockReturnValueOnce(remount.promise)
  const c = surface(f.api)
  expect(c.held()).toBe(a.held())
  expect(c.held().value).toBe(current)
  expect(f.read).toHaveBeenCalledTimes(3)
  expect(f.subscribe).toHaveBeenCalledTimes(2)
  old.resolve(answer(99))
  await settle()
  expect(c.held().value).toBe(current)
  const latest = answer(61)
  remount.resolve(latest)
  await settle()
  expect(c.held().value).toBe(latest)
  const afterDispose = pending()
  f.read.mockReturnValueOnce(afterDispose.promise)
  f.notice('usage')
  c.m.unmount()
  afterDispose.resolve(answer(88))
  await settle()
  expect(c.held().value).toBe(latest)
  expect(f.off).toHaveBeenCalledTimes(2)
})

it('isolates distinct clients, out-of-order generations and refusals without changing supplied facts', async () => {
  const a = usageClient()
  const b = usageClient()
  const oldA = pending()
  const firstB = pending()
  a.read.mockReturnValueOnce(oldA.promise)
  b.read.mockReturnValueOnce(firstB.promise)
  const left = surface(a.api)
  const right = surface(b.api)
  expect(left.held()).not.toBe(right.held())
  const nextA = pending()
  a.read.mockReturnValueOnce(nextA.promise)
  a.notice('usage')
  const factsA = answer(24)
  nextA.resolve(factsA)
  await settle()
  expect(left.held().value).toBe(factsA)
  expect(right.held().value).toBeNull()
  const factsB = answer(72)
  firstB.resolve(factsB)
  oldA.resolve(answer(1))
  await settle()
  expect(left.held().value).toBe(factsA)
  expect(right.held().value).toBe(factsB)
  a.read.mockRejectedValueOnce(new Error('Fictional read refused'))
  a.notice('login')
  await settle()
  expect(left.held().value).toBe(factsA)
  expect(right.held().value).toBe(factsB)
  expect(b.read).toHaveBeenCalledTimes(1)
  left.m.unmount()
  expect(a.off).toHaveBeenCalledTimes(1)
  expect(b.off).not.toHaveBeenCalled()
  expect(b.listeners.size).toBe(1)
  const recovered = answer(73)
  b.read.mockResolvedValueOnce(recovered)
  b.notice('usage')
  await settle()
  expect(right.held().value).toBe(recovered)
})
