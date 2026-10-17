import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionSignal } from '../src/shared/attention-signals'
import type { ToggleStorage } from '../src/renderer/src/composables/usePersistentToggle'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
  vi.resetModules()
})

function storage() {
  const values = new Map<string, string>()
  const store: ToggleStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
  vi.stubGlobal('localStorage', store)
  return values
}

describe('the exposed window preference', () => {
  it('defaults on, is shared by Settings and the publisher, and survives a reload off', async () => {
    const values = storage()
    const { useAttentionSignals } =
      await import('../src/renderer/src/composables/useAttentionSignals')
    const enabled = useAttentionSignals()
    expect(enabled.value).toBe(true)
    expect(useAttentionSignals()).toBe(enabled)
    enabled.value = false
    await nextTick()
    expect(values.get('brobot2.attentionSignals')).toBe('false')
    vi.resetModules()
    const reloaded = await import('../src/renderer/src/composables/useAttentionSignals')
    expect(reloaded.useAttentionSignals().value).toBe(false)
  })

  it('publishes the exact page count, clears immediately on off and releases on unmount', async () => {
    storage()
    const { useAttentionSignals, syncAttentionSignals } =
      await import('../src/renderer/src/composables/useAttentionSignals')
    const reading = ref({
      count: 7,
      populations: [{ name: 'questions', ready: false, keys: ['a'] }],
    })
    const sent: AttentionSignal[] = []
    const scope = effectScope()
    scopes.push(scope)
    scope.run(() =>
      syncAttentionSignals(reading, async (signal) => {
        sent.push(signal)
      }),
    )
    expect(sent.at(-1)).toEqual({ enabled: true, count: 7, arrival: expect.any(Number) })
    const baseline = sent.at(-1)?.arrival
    reading.value = { count: 7, populations: [{ name: 'questions', ready: true, keys: ['a'] }] }
    await nextTick()
    expect(sent.at(-1)?.arrival).toBe(baseline)
    reading.value = { count: 7, populations: [{ name: 'questions', ready: true, keys: ['b'] }] }
    await nextTick()
    expect(sent.at(-1)?.arrival).toBeGreaterThan(baseline ?? -1)
    useAttentionSignals().value = false
    await nextTick()
    expect(sent.at(-1)).toEqual({ enabled: false, count: 7, arrival: expect.any(Number) })
    scope.stop()
    expect(sent.at(-1)).toEqual({ enabled: false, count: 0, arrival: expect.any(Number) })
    const length = sent.length
    reading.value.count = 8
    await nextTick()
    expect(sent).toHaveLength(length)
  })
})
