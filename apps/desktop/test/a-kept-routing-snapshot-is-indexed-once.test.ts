import { describe, expect, it, vi } from 'vitest'
import { WindowRoutingReads } from '../src/main/db/window-routing-reads'
import type { SessionStore } from '../src/main/db/session-store'
import type { RoutingReading, WindowRoutes } from '../src/main/db/window-read-protocol'

const reading = (sessionId: string): RoutingReading =>
  ({ sessionId, requests: [], skipped: [] }) as unknown as RoutingReading

describe('a kept routing snapshot is indexed once', () => {
  it('answers read over the same kept snapshot index its routes once, and give the same answer', () => {
    const routes = [reading('a'), reading('b')]
    const snapshot: WindowRoutes = {
      kind: 'routes',
      routes,
      questions: [] as never,
      decisions: [] as never,
    }
    const indexed = vi.spyOn(routes, 'map')
    const reads = new WindowRoutingReads()
    const store = reads.store({ routedRequestsOf: () => [] } as unknown as SessionStore)
    const first = reads.run(snapshot, () => store.routedRequestsOf('a'))
    const second = reads.run(snapshot, () => store.routedRequestsOf('b'))
    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(indexed).toHaveBeenCalledTimes(1)
  })

  it('a new snapshot is indexed afresh', () => {
    const reads = new WindowRoutingReads()
    const store = reads.store({ routedRequestsOf: () => ['live'] } as unknown as SessionStore)
    const one = [reading('a')]
    const two = [reading('b')]
    const spyOne = vi.spyOn(one, 'map')
    const spyTwo = vi.spyOn(two, 'map')
    reads.run({ kind: 'routes', routes: one, questions: [] as never, decisions: [] as never }, () =>
      store.routedRequestsOf('a'),
    )
    reads.run({ kind: 'routes', routes: two, questions: [] as never, decisions: [] as never }, () =>
      store.routedRequestsOf('b'),
    )
    expect(spyOne).toHaveBeenCalledTimes(1)
    expect(spyTwo).toHaveBeenCalledTimes(1)
  })
})
