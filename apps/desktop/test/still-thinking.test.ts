import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { stillThinkingSays, useStillThinking } from '../src/renderer/src/lib/still-thinking'

/** The thinking line's count: whole minutes since the silence began, moved by a fake clock. */

const MIN = 60_000
const START = Date.UTC(2026, 9, 13, 12, 0, 0)

afterEach(() => vi.useRealTimers())

describe('what the thinking line says', () => {
  it('whole minutes, at least one', () => {
    expect(stillThinkingSays(0)).toBe('Still thinking (1 min).')
    expect(stillThinkingSays(2 * MIN)).toBe('Still thinking (2 min).')
    expect(stillThinkingSays(3 * MIN - 1)).toBe('Still thinking (2 min).')
    expect(stillThinkingSays(3 * MIN)).toBe('Still thinking (3 min).')
  })
})

describe('the count, kept current', () => {
  it('moves on each whole minute since the silence began, and stops when it ends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START + 2 * MIN + 20_000)
    const since = ref<number | null>(START)
    const scope = effectScope()
    const said = scope.run(() => useStillThinking(() => since.value))!
    expect(said.value).toBe('Still thinking (2 min).')
    vi.advanceTimersByTime(40_000 - 1)
    expect(said.value).toBe('Still thinking (2 min).')
    vi.advanceTimersByTime(1)
    expect(said.value).toBe('Still thinking (3 min).')
    vi.advanceTimersByTime(MIN)
    expect(said.value).toBe('Still thinking (4 min).')

    since.value = null
    await nextTick()
    expect(said.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  it('arms nothing while there is no silence to count', () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const said = scope.run(() => useStillThinking(() => null))!
    expect(said.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })
})
