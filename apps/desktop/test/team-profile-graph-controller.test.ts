import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref, nextTick } from 'vue'
import { createTeamProfileGraph } from '../src/renderer/src/composables/useTeamProfileGraph'
import { fictionalGraph, fictionalGraphWire } from './fixtures/team-profile-graph-view'
import type { TeamProfileGraphRequest } from '../src/shared/team-profile-graph'
import { asTheWireWouldCarry } from './lib/the-wire'
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((s) => s.stop())
})
function setup(read: (request: TeamProfileGraphRequest) => Promise<unknown>) {
  const scope = effectScope()
  scopes.push(scope)
  const workspace = ref('fictional-workspace')
  const controller = scope.run(() =>
    createTeamProfileGraph({ read, workspace: () => workspace.value }),
  )!
  return { controller, workspace }
}
it('reads once on first entry, atomically pages every node and edge, and keeps controls off the wire', async () => {
  const f = fictionalGraph(151),
    wire = fictionalGraphWire(f)
  const read = vi.fn(async (request: TeamProfileGraphRequest) =>
    wire(asTheWireWouldCarry('teamProfileGraph', request)),
  )
  const { controller: c } = setup(read)
  expect(read).not.toHaveBeenCalled()
  c.setActive(true)
  await vi.waitFor(() => expect(c.reading.value?.nodes).toHaveLength(151))
  expect(c.reading.value?.edges).toHaveLength(150)
  expect(read.mock.calls.filter(([r]) => r.operation === 'snapshot')).toHaveLength(1)
  expect(c.stale.value).toBe(false)
  c.setActive(false)
  c.setActive(true)
  await nextTick()
  expect(read.mock.calls.filter(([r]) => r.operation === 'snapshot')).toHaveLength(1)
  c.markStale()
  expect(c.stale.value).toBe(true)
})
it.each(['duplicate', 'endpoint', 'count', 'cursor', 'stamp', 'oversize'] as const)(
  'retains a visibly stale complete reading on %s failure',
  async (fault) => {
    const f = fictionalGraph(151),
      wire = fictionalGraphWire(f)
    let broken = false
    const { controller: c } = setup(async (request) => {
      const page = await wire(request)
      if (broken) {
        if (fault === 'count' && page.type === 'snapshot') page.nodeCount++
        if (
          fault === 'duplicate' &&
          page.type === 'nodes' &&
          request.operation === 'nodes' &&
          request.cursor
        )
          page.nodes[0] = f.nodes[0]!
        if (fault === 'endpoint' && page.type === 'edges') page.edges[0]!.source = 'missing'
        if (fault === 'cursor' && page.type === 'nodes') page.next = '100'
        if (fault === 'stamp' && page.type === 'nodes') page.snapshot = 'other'
        if (fault === 'oversize' && page.type === 'snapshot')
          return { ...page, extra: 'x'.repeat(600000) }
      }
      return page
    })
    c.setActive(true)
    await vi.waitFor(() => expect(c.reading.value?.nodes).toHaveLength(151))
    const retained = c.reading.value
    broken = true
    await c.refresh()
    expect(c.error.value?.complete).toBe(false)
    expect(c.reading.value).toBe(retained)
    expect(c.stale.value).toBe(true)
  },
)
it('discards late staged replies on tab exit and workspace switch, with no automatic retry', async () => {
  const f = fictionalGraph(151),
    wire = fictionalGraphWire(f)
  let unblock!: () => void
  const barrier = new Promise<void>((r) => {
    unblock = r
  })
  const { controller: c, workspace } = setup(async (request) => {
    if (request.operation === 'nodes') await barrier
    return wire(request)
  })
  c.setActive(true)
  await vi.waitFor(() => expect(c.busy.value).toBe(true))
  c.setActive(false)
  workspace.value = 'other-fictional-workspace'
  await nextTick()
  unblock()
  await new Promise((r) => setTimeout(r, 20))
  expect(c.reading.value).toBeNull()
  expect(c.busy.value).toBe(false)
})
it('does not erase a mutation announced during staging or fabricate an empty snapshot on failure', async () => {
  const f = fictionalGraph(2),
    wire = fictionalGraphWire(f)
  const result = setup(async (request) => {
    if (request.operation === 'edges') result.controller.markStale()
    return wire(request)
  })
  const c = result.controller
  c.setActive(true)
  await vi.waitFor(() => expect(c.reading.value?.nodes).toHaveLength(2))
  expect(c.stale.value).toBe(true)
})
