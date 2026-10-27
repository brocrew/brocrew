import { afterEach, expect, it, vi } from 'vitest'
import { armRecoveryExpiry } from '../../src/main/recovery/retention-timer'

afterEach(() => vi.useRealTimers())

it('expires at the three-day boundary even when the app stays open', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const expire = vi.fn()
  const timer = armRecoveryExpiry('2026-01-04T00:00:00.000Z', expire)
  expect(timer).toBeDefined()
  await vi.advanceTimersByTimeAsync(3 * 86_400_000 - 1)
  expect(expire).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(expire).toHaveBeenCalledTimes(1)
})

it('does not repeatedly retry a copy that safety checks kept after its expiry', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const expiresAt = '2026-01-01T00:00:01.000Z'
  const attempt = vi.fn<() => void>(() => {
    armRecoveryExpiry(expiresAt, attempt)
  })
  armRecoveryExpiry(expiresAt, attempt)
  await vi.advanceTimersByTimeAsync(86_400_000)
  expect(attempt).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
