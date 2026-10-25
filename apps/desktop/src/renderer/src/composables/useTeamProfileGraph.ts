import { inject, onScopeDispose, provide, shallowRef, watch, type InjectionKey } from 'vue'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  graphUnavailable,
  teamProfileGraphResult,
  type GraphNode,
  type GraphEdge,
  type GraphUnavailable,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
} from '../../../shared/team-profile-graph'

export type GraphHeader = Extract<TeamProfileGraphResult, { type: 'snapshot' }>
export type GraphReading = {
  header: GraphHeader
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
}
const key: InjectionKey<TeamProfileGraphController> = Symbol('team-profile-graph')
export function provideTeamProfileGraph(controller: TeamProfileGraphController): void {
  provide(key, controller)
}
export function useTeamProfileGraph(): TeamProfileGraphController | undefined {
  return inject(key, undefined)
}
export type TeamProfileGraphController = ReturnType<typeof createTeamProfileGraph>

export function createTeamProfileGraph(options: {
  read: (request: TeamProfileGraphRequest) => Promise<unknown>
  workspace: () => string | null
}) {
  const reading = shallowRef<GraphReading | null>(null)
  const error = shallowRef<GraphUnavailable | null>(null)
  const busy = shallowRef(false)
  const stale = shallowRef(false)
  const retryAt = shallowRef(0)
  let generation = 0,
    mutation = 0,
    attempted = false,
    active = false,
    disposed = false
  let expiry: ReturnType<typeof setTimeout> | undefined
  let cooldown: ReturnType<typeof setTimeout> | undefined
  let releases: Promise<unknown> = Promise.resolve()
  const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length
  const release = (): void => {
    releases = releases.then(() => options.read({ operation: 'release' })).catch(() => undefined)
  }
  function markStale(): void {
    mutation++
    if (reading.value) stale.value = true
  }
  function cancel(): void {
    generation++
    busy.value = false
    release()
  }
  async function refresh(): Promise<void> {
    if (disposed || !active || !options.workspace() || retryAt.value > Date.now()) return
    cancel()
    const serial = generation,
      revision = mutation
    busy.value = true
    attempted = true
    error.value = null
    markStale()
    const started = performance.now()
    const current = (): void => {
      if (serial !== generation || !active || disposed) throw graphUnavailable('cancelled')
      if (performance.now() - started > 6500) throw graphUnavailable('worker')
    }
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      watchdog = setTimeout(() => {
        if (serial !== generation) return
        cancel()
        error.value = graphUnavailable('worker')
      }, 6500)
      await releases
      current()
      const read = async (request: TeamProfileGraphRequest): Promise<TeamProfileGraphResult> => {
        current()
        const raw = await options.read(request)
        current()
        if (bytes(raw) > B.replyBytes) throw graphUnavailable('metadata')
        const parsed = teamProfileGraphResult.safeParse(raw)
        if (!parsed.success) throw graphUnavailable('metadata')
        if (parsed.data.type === 'unavailable') throw parsed.data
        return parsed.data
      }
      const header = await read({ operation: 'snapshot' })
      if (
        header.type !== 'snapshot' ||
        header.expiresAt < header.readAt ||
        header.expiresAt - header.readAt > B.ttlMs ||
        header.todaySince > header.readAt ||
        header.recentSince > header.readAt
      )
        throw graphUnavailable('metadata')
      const nodes: GraphNode[] = [],
        edges: GraphEdge[] = []
      const ids = new Set<string>(),
        pairs = new Set<string>()
      let projected = bytes(header),
        isStale = header.stale
      for (const operation of ['nodes', 'edges'] as const) {
        let cursor: string | undefined
        const cursors = new Set<string>()
        do {
          const page = await read({
            operation,
            snapshot: header.snapshot,
            ...(cursor ? { cursor } : {}),
          })
          if (
            page.type !== operation ||
            page.snapshot !== header.snapshot ||
            page.readAt !== header.readAt ||
            page.expiresAt !== header.expiresAt
          )
            throw graphUnavailable('metadata', 'page')
          isStale ||= page.stale
          projected += bytes(page)
          if (projected > B.aggregateBytes) throw graphUnavailable('budget', 'page')
          if (page.type === 'nodes') {
            for (const node of page.nodes) {
              if (ids.has(node.id) || node.createdAt > header.readAt)
                throw graphUnavailable('metadata', 'page')
              ids.add(node.id)
              nodes.push(node)
            }
            if (nodes.length > header.nodeCount || (page.next !== null && page.nodes.length === 0))
              throw graphUnavailable('metadata', 'page')
          } else {
            for (const edge of page.edges) {
              const pair = JSON.stringify([edge.source, edge.target])
              if (!ids.has(edge.source) || !ids.has(edge.target) || pairs.has(pair))
                throw graphUnavailable('metadata', 'page')
              pairs.add(pair)
              edges.push(edge)
            }
            if (edges.length > header.edgeCount || (page.next !== null && page.edges.length === 0))
              throw graphUnavailable('metadata', 'page')
          }
          cursor = page.next ?? undefined
          if (cursor && cursors.has(cursor)) throw graphUnavailable('invalid-cursor', 'page')
          if (cursor) cursors.add(cursor)
          // Yield between pages so an explicit cancel can discard staged data.
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          current()
        } while (cursor)
      }
      if (nodes.length !== header.nodeCount || edges.length !== header.edgeCount)
        throw graphUnavailable('metadata', 'page')
      for (const node of nodes) {
        Object.freeze(node.configured)
        Object.freeze(node)
      }
      for (const edge of edges) Object.freeze(edge)
      Object.freeze(header.coverage)
      Object.freeze(header.metrics)
      Object.freeze(header)
      reading.value = Object.freeze({
        header,
        nodes: Object.freeze(nodes),
        edges: Object.freeze(edges),
      })
      stale.value = isStale || mutation !== revision + 1
      clearTimeout(expiry)
      expiry = setTimeout(markStale, Math.max(0, B.ttlMs - (performance.now() - started)))
      release()
    } catch (failure) {
      if (serial !== generation) return
      const parsed = teamProfileGraphResult.safeParse(failure)
      error.value =
        parsed.success && parsed.data.type === 'unavailable'
          ? parsed.data
          : graphUnavailable('worker')
      const delay = error.value.retryAfterMs ?? 0
      if (delay > 0) {
        retryAt.value = Date.now() + delay
        clearTimeout(cooldown)
        cooldown = setTimeout(() => {
          retryAt.value = 0
        }, delay)
      }
      release()
    } finally {
      clearTimeout(watchdog)
      if (serial === generation) busy.value = false
    }
  }
  function setActive(value: boolean): void {
    active = value
    if (!value) {
      if (busy.value) cancel()
    } else if (!attempted) void refresh()
  }
  const stop = watch(options.workspace, () => {
    cancel()
    clearTimeout(expiry)
    reading.value = null
    error.value = null
    stale.value = false
    attempted = false
    if (active) void refresh()
  })
  function dispose(): void {
    disposed = true
    cancel()
    clearTimeout(expiry)
    clearTimeout(cooldown)
    stop()
  }
  onScopeDispose(dispose, true)
  return { reading, error, busy, stale, retryAt, refresh, setActive, markStale, dispose }
}
