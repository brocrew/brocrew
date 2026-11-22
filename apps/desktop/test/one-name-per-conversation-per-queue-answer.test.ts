import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aGiverAndHelper, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * Card 91 · the stalled, stopped and waiting-on-who-wrote rows name each conversation once per
 * answer, and a rename shows in the next answer.
 */
describe('each queue answer names a conversation once', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  const composed = () => {
    const fresh = host as unknown as Record<string, () => { rows: Record<string, unknown>[] }>
    return [
      fresh.stalledWorkForAPersonComposed!.call(host).rows,
      fresh.stoppedWorkForAPersonComposed!.call(host).rows,
      fresh.waitingOnWhoWroteForAPersonComposed!.call(host).rows,
    ]
  }

  beforeEach(async () => {
    ;({ world, host } = await aGiverAndHelper())
    const walk = (rows: object[]) => ({ walk: 'complete', ledgers: 1, rowsUnread: 0, rows })
    const stalled = ['p1', 'p2'].map((piece) => ({
      piece,
      label: piece,
      title: null,
      owner: 'worker',
      giver: 'boss',
      state: 'stalled',
      stalledBecause: 'turn_interrupted',
      stalledBy: null,
      stalledAt: 1,
    }))
    const waiting = ['p1', 'p2'].map((piece) => ({
      piece,
      label: piece,
      title: null,
      owner: 'worker',
      answeredAPersonAt: 1,
    }))
    vi.spyOn(world.store, 'stalledWorkNobodyWasToldAbout').mockReturnValue(walk(stalled) as never)
    vi.spyOn(world.store, 'stalledWorkItsGiverWasToldAbout').mockReturnValue(walk(stalled) as never)
    vi.spyOn(world.store, 'piecesWaitingOnWhoWrote').mockReturnValue(walk(waiting) as never)
    const stopped = host as unknown as { itsHolderIsStopped: () => boolean }
    vi.spyOn(stopped, 'itsHolderIsStopped').mockReturnValue(true)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('names each conversation once in each answer', () => {
    const named = vi.spyOn(host, 'whatToCallTheConversation').mockImplementation((id) => `N-${id}`)
    const [stalled, stopped, waiting] = composed()
    expect(stalled!.map((row) => [row.ownerName, row.giverName])).toEqual([
      ['N-worker', 'N-boss'],
      ['N-worker', 'N-boss'],
    ])
    expect(stopped!.map((row) => [row.holderName, row.giverName])).toEqual([
      ['N-worker', 'N-boss'],
      ['N-worker', 'N-boss'],
    ])
    expect(waiting!.map((row) => row.ownerName)).toEqual(['N-worker', 'N-worker'])
    // Two for the stalled answer, two for the stopped one, one for the waiting one.
    expect(named.mock.calls.map(([id]) => id)).toEqual([
      'worker',
      'boss',
      'worker',
      'boss',
      'worker',
    ])
  })

  it('a rename shows in the next answer', () => {
    const name = vi.spyOn(host, 'whatToCallTheConversation').mockReturnValue('Ana')
    composed()
    name.mockReturnValue('Bea')
    const [stalled, stopped, waiting] = composed()
    expect(stalled![0]!.ownerName).toBe('Bea')
    expect(stopped![0]!.holderName).toBe('Bea')
    expect(waiting![0]!.ownerName).toBe('Bea')
  })
})
