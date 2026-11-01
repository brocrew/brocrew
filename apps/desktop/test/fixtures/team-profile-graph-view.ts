import {
  emptyGraphCoverage,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
} from '../../src/shared/team-profile-graph'
import type { GraphReading } from '../../src/renderer/src/composables/useTeamProfileGraph'

export function fictionalGraph(count = 100, dense = false): GraphReading {
  const readAt = Date.UTC(2026, 9, 25, 8)
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `fictional-${String(i).padStart(5, '0')}`,
    createdAt: readAt - 86400000,
    profile: i === 0 ? 'brobot' : `fictional-${i}`,
    name: i === 0 ? 'BroBot' : `Agent ${String(i).padStart(5, '0')}`,
    clipped: false,
    kind:
      i % 11 === 0
        ? ('unknown' as const)
        : i % 7 === 0
          ? ('service' as const)
          : ('normal' as const),
    kindQuality: i % 11 === 0 ? ('unknown-file' as const) : ('stable-record' as const),
    kindReadAt: readAt,
    configured: {
      provider: 'codex' as const,
      model: 'fictional',
      source: 'conversation-setting' as const,
    },
    conversations: i % 9,
    piecesHeld: i % 13,
    messagesSent: i % 31,
    recentTurns: i % 5,
    directDescendants: i % 3,
    descendants: i % 6,
    recordedWorking: i % 17 === 0 ? 1 : 0,
    lastTurnAt: i % 3 === 0 ? readAt - 3600000 : null,
    lastSavedUpdate: readAt - 60000,
  }))
  const edges = []
  for (let i = 1; i < count; i++)
    edges.push({
      source: nodes[i - 1]!.id,
      target: nodes[i]!.id,
      work: i % 4,
      messages: (i % 8) + 1,
      questions: i % 3,
    })
  if (dense)
    for (let i = 0; i < count; i++)
      for (let j = i + 2; j < count && edges.length < 5001; j++)
        edges.push({
          source: nodes[i]!.id,
          target: nodes[j]!.id,
          work: 0,
          messages: 1,
          questions: 0,
        })
  return {
    header: {
      type: 'snapshot',
      snapshot: 'fictional-snapshot',
      readAt,
      expiresAt: readAt + 60000,
      stale: false,
      semanticsVersion: 1,
      timezone: 'UTC',
      todaySince: readAt - 8 * 3600000,
      recentSince: readAt - 7 * 86400000,
      nodeCount: count,
      edgeCount: edges.length,
      coverage: emptyGraphCoverage(),
      metrics: { rows: count, projectedBytes: 0, aggregateBytes: 0, cacheBytes: 0, elapsedMs: 1 },
    },
    nodes,
    edges,
  }
}
export function fictionalGraphWire(reading: GraphReading) {
  return async (request: TeamProfileGraphRequest): Promise<TeamProfileGraphResult> => {
    if (request.operation === 'release') return { type: 'released' }
    if (request.operation === 'snapshot') return structuredClone(reading.header)
    const offset = Number(request.cursor ?? 0),
      size = request.operation === 'nodes' ? (request.size ?? 100) : (request.size ?? 256)
    const stamp = {
      snapshot: reading.header.snapshot,
      readAt: reading.header.readAt,
      expiresAt: reading.header.expiresAt,
      stale: reading.header.stale,
    }
    if (request.operation === 'nodes')
      return {
        type: 'nodes',
        ...stamp,
        nodes: structuredClone(reading.nodes.slice(offset, offset + size)),
        next: offset + size < reading.nodes.length ? String(offset + size) : null,
      }
    return {
      type: 'edges',
      ...stamp,
      edges: structuredClone(reading.edges.slice(offset, offset + size)),
      next: offset + size < reading.edges.length ? String(offset + size) : null,
    }
  }
}
