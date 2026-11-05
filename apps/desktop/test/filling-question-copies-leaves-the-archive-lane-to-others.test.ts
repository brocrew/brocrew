import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * Filling the copies of older questions takes one job of the archive lane per slice, so other
 * archive work queued meanwhile runs between two slices; a slice that finds the write lock taken
 * is tried again later, and the fill stops once done.
 */
describe('filling question copies leaves the archive lane to others', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  const lane = () =>
    (host as unknown as { archives: { background<T>(work: () => Promise<T>): Promise<T> } })
      .archives

  beforeEach(() => {
    world = aServiceWorld()
    host = world.aHost({ servicesOn: false })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('another archive job queued during the fill runs between two slices', async () => {
    const order: string[] = []
    let slices = 0
    vi.spyOn(world.store, 'fillQuestionCopies').mockImplementation(() => {
      slices++
      order.push(`slice ${String(slices)}`)
      if (slices === 1)
        void lane().background(async () => {
          order.push('other')
        })
      return slices < 3
        ? { state: 'filled', visited: 1, matched: 0 }
        : { state: 'done', visited: 0, matched: 0 }
    })
    host.fillQuestionCopies()
    await vi.waitFor(() => expect(slices).toBe(3))
    expect(order).toEqual(['slice 1', 'other', 'slice 2', 'slice 3'])
  })

  it('a slice that finds the write lock taken is tried again, and the fill stops once done', async () => {
    const states = ['busy', 'busy', 'filled', 'done'] as const
    let at = 0
    const fill = vi.spyOn(world.store, 'fillQuestionCopies').mockImplementation(() => {
      const state = states[Math.min(at++, states.length - 1)]!
      return state === 'busy' || state === 'done'
        ? { state, visited: 0, matched: 0 }
        : { state, visited: 1, matched: 0 }
    })
    host.fillQuestionCopies()
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(4))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fill).toHaveBeenCalledTimes(4)
  })
})
