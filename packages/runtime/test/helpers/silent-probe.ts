import { expect, vi } from 'vitest'

/**
 * Starts a model probe whose provider is alive and never answers, lets `ms` of the fake clock pass,
 * and expects the probe to give up with a "did not answer" failure (card 197: the one total limit a
 * probe keeps).
 */
export async function expectSilentProbeToGiveUp(
  probe: () => Promise<unknown>,
  ms: number,
): Promise<void> {
  vi.useFakeTimers()
  try {
    const probing = probe()
    const settled = expect(probing).rejects.toThrow(/did not answer/)
    await vi.advanceTimersByTimeAsync(ms)
    await settled
  } finally {
    vi.useRealTimers()
  }
}
