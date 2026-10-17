import { graphlib, layout } from '@dagrejs/dagre'
import type { GraphNode } from './forest-graph'

/** Dagre receives measured cards and parent links; Vue Flow uses their top-left positions. */
export function rightwardForest(
  nodes: readonly GraphNode[],
  heights: ReadonlyMap<string, number>,
  width: number,
  rankGap: number,
  siblingGap: number,
  unmeasuredHeight: number,
): ReadonlyMap<string, { x: number; y: number }> {
  const graph = new graphlib.Graph()
    .setGraph({ rankdir: 'LR', ranksep: rankGap, nodesep: siblingGap })
    .setDefaultEdgeLabel(() => ({}))
  for (const node of nodes) {
    graph.setNode(node.row.conversation, {
      width,
      height: heights.get(node.row.conversation) ?? unmeasuredHeight,
    })
  }
  for (const node of nodes) {
    if (node.parent !== null) graph.setEdge(node.parent, node.row.conversation)
  }
  layout(graph)
  return new Map(
    nodes.map(({ row }) => {
      const placed = graph.node(row.conversation)
      return [row.conversation, { x: placed.x - width / 2, y: placed.y - placed.height / 2 }]
    }),
  )
}
