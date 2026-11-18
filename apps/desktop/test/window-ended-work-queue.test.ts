import { afterEach, expect, it, vi } from 'vitest'
import { endedWindowWork, type EndedWorld } from './helpers/ended-window-work'

const worlds: EndedWorld[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const world of worlds.splice(0)) await world.cleanUp()
})
function world() {
  const w = endedWindowWork()
  worlds.push(w)
  return w
}

it.each(['answered', 'withdrawn', 'closed'] as const)(
  'reuses clean %s proof under byte eviction without dropping walked ledgers',
  (ending) => {
    const w = world()
    w.seed(ending)
    const { canonical, reused } = w.compare()
    expect(reused.firstAdmitted).toBe(true)
    expect(reused.firstEvicted).toBe(true)
    const queue = reused.answer.queue!
    for (const fact of [queue.stalls, queue.stops]) {
      expect(fact).toEqual({
        value: {
          walk: 'every-conversation-that-was-given-work',
          ledgers: 16,
          rowsUnread: 0,
          rows: [],
        },
        skipped: [],
      })
    }
    expect(canonical.reads.stalls.length).toBeGreaterThan(0)
    expect(canonical.reads.stops.length).toBeGreaterThan(0)
    expect(reused.reads).toEqual({ stalls: [], stops: [] })
  },
)
