import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsReadDemand } from '../src/main/db/limits-read-demand'
import type { LimitsReadInput, LimitsReadResult } from '../src/main/db/limits-read-protocol'

const input = (operation: number): LimitsReadInput => ({
  operation,
  databaseEpoch: 1,
  signInEpoch: 1,
  capturedAt: 10,
  signInChangedAt: {},
  usage: {},
})
const result = (operation: number): LimitsReadResult => ({
  operation,
  databaseEpoch: 1,
  signInEpoch: 1,
  inputCapturedAt: 10,
  readStartedAt: 11,
  snapshotPinStartedAt: 11,
  snapshotPinnedAt: 12,
  evaluatedAt: 13,
  readFinishedAt: 14,
  canonical: { walk: 'every-provider-wall-recently-recorded', rows: [], ledgers: 0, rowsUnread: 0 },
  display: { walk: 'every-provider-wall-recently-recorded', rows: [], ledgers: 0, rowsUnread: 0 },
  measured: { rows: 0, bytes: 0, statements: 1 },
})

describe('limits demand keeps native ownership until settlement', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(capacity = 64) {
    const completions: ((read: LimitsReadResult) => void)[] = []
    const inputs: LimitsReadInput[] = []
    const execute = vi.fn((wanted: LimitsReadInput) => {
      inputs.push(wanted)
      return new Promise<LimitsReadResult>((resolve) => completions.push(resolve))
    })
    const demand = new LimitsReadDemand(execute, capacity)
    return {
      execute,
      inputs,
      demand,
      finish: (n: number, operation: number) =>
        completions[n]!({
          ...result(operation),
          databaseEpoch: inputs[n]!.databaseEpoch,
          signInEpoch: inputs[n]!.signInEpoch,
          inputCapturedAt: inputs[n]!.capturedAt,
        }),
    }
  }

  it('coalesces a wave into the latest queued request, without a result cache', async () => {
    const { demand, execute, finish } = setup()
    const first = demand.read(input(1))
    await vi.advanceTimersByTimeAsync(0)
    const second = demand.read(input(2))
    const third = demand.read(input(3))
    expect(execute).toHaveBeenCalledTimes(1)
    finish(0, 1)
    expect((await first).operation).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toEqual(input(3))
    finish(1, 3)
    expect((await second).operation).toBe(3)
    expect((await third).operation).toBe(3)
    const fresh = demand.read(input(4))
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(3)
    finish(2, 4)
    await fresh
    demand.close()
  })

  it('bounds all callers and drops a fully cancelled queued demand', async () => {
    const { demand, execute } = setup(1)
    const abort = new AbortController()
    const first = demand.read(input(1), abort.signal).catch((error: unknown) => error)
    await expect(demand.read(input(2))).rejects.toMatchObject({ why: 'busy' })
    abort.abort()
    expect(await first).toMatchObject({ why: 'cancelled' })
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).not.toHaveBeenCalled()
    demand.close()
  })

  it('closing does not pretend that a live native job stopped', async () => {
    const { demand, execute, finish } = setup()
    const first = demand.read(input(1)).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    demand.close()
    expect(await first).toMatchObject({ why: 'changed' })
    expect(demand.nativeBusy).toBe(true)
    await expect(demand.read(input(2))).rejects.toMatchObject({ why: 'closed' })
    expect(execute).toHaveBeenCalledTimes(1)
    finish(0, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(demand.nativeBusy).toBe(false)
  })
})
