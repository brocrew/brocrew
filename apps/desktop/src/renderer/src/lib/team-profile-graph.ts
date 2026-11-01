import { DEFAULT_PROFILE_ID } from '../../../shared/runtime-ipc'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  type GraphNode,
  type GraphEdge,
} from '../../../shared/team-profile-graph'
import type { GraphReading } from '../composables/useTeamProfileGraph'

export type SizeMetric =
  'conversations' | 'piecesHeld' | 'messagesSent' | 'recentTurns' | 'descendants' | 'equal'
export type LineMetric = 'work' | 'messages' | 'questions' | 'all'
export type Scaling = 'sqrt' | 'log'
export type GraphControls = {
  size: SizeMetric
  line: LineMetric
  scaling: Scaling
  activity: 'all' | 'today' | 'week' | 'working'
  directions: boolean
  showBroBot: boolean
  badges: boolean
  proximity: 'messages' | 'selected'
  distance: number
  repulsion: number
}
export const graphDefaults = (): GraphControls => ({
  size: 'conversations',
  line: 'work',
  scaling: 'sqrt',
  activity: 'all',
  directions: false,
  showBroBot: true,
  badges: false,
  proximity: 'messages',
  distance: 90,
  repulsion: 160,
})
export const scalarCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
export const graphWords = (query: string): string[] =>
  query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
export function matchesAgent(node: GraphNode, words: readonly string[]): boolean {
  const text = `${node.name} ${node.profile}`.normalize('NFKC').toLocaleLowerCase()
  return words.every((word) => text.includes(word))
}
export function lineCount(edge: GraphEdge, line: LineMetric): number {
  return line === 'all' ? edge.work + edge.messages + edge.questions : edge[line]
}
export function normalized(value: number, maximum: number, scaling: Scaling): number {
  if (maximum <= 0) return 0
  return scaling === 'sqrt' ? Math.sqrt(value / maximum) : Math.log1p(value) / Math.log1p(maximum)
}
export type DrawnEdge = { source: string; target: string; count: number; width: number }
export type PhysicalPair = { source: number; target: number; weight: number }
export type GraphView = {
  nodes: GraphNode[]
  radii: number[]
  edges: DrawnEdge[]
  links: PhysicalPair[]
  tooLarge: boolean
  unsafe: boolean
}
export function graphView(reading: GraphReading, controls: GraphControls): GraphView {
  const nodes = reading.nodes.filter(
    (n) =>
      (controls.showBroBot || n.profile !== DEFAULT_PROFILE_ID) &&
      (controls.activity === 'all' ||
        (controls.activity === 'working'
          ? n.recordedWorking > 0
          : n.lastTurnAt !== null &&
            n.lastTurnAt >=
              (controls.activity === 'today'
                ? reading.header.todaySince
                : reading.header.recentSince))),
  )
  const refused = (unsafe = false): GraphView => ({
    nodes,
    radii: [],
    edges: [],
    links: [],
    tooLarge: true,
    unsafe,
  })
  if (nodes.length > B.layoutNodes) return refused()
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const pairs = new Map<
    string,
    { source: number; target: number; selected: number; messages: number }
  >()
  let arrows = 0
  for (const edge of reading.edges) {
    const source = index.get(edge.source),
      target = index.get(edge.target)
    if (source === undefined || target === undefined) continue
    const count = lineCount(edge, controls.line)
    if (count <= 0 && (controls.proximity !== 'messages' || edge.messages <= 0)) continue
    const key = source < target ? `${source}:${target}` : `${target}:${source}`
    let pair = pairs.get(key)
    if (!pair) {
      if (pairs.size >= B.layoutPairs) return refused()
      pair = {
        source: Math.min(source, target),
        target: Math.max(source, target),
        selected: 0,
        messages: 0,
      }
      pairs.set(key, pair)
    }
    pair.selected += count
    pair.messages += edge.messages
    if (!Number.isSafeInteger(pair.selected) || !Number.isSafeInteger(pair.messages))
      return refused(true)
    if (count > 0 && ++arrows > B.arrows) return refused()
  }
  // Draw and layout records are allocated only after the entire union is admitted.
  const max =
    controls.size === 'equal'
      ? 0
      : reading.nodes.reduce(
          (m, n) => Math.max(m, n[controls.size as Exclude<SizeMetric, 'equal'>]),
          0,
        )
  const radii = nodes.map((n) =>
    controls.size === 'equal' ? 7 : 4 + 17 * normalized(n[controls.size], max, controls.scaling),
  )
  const edges: DrawnEdge[] = []
  if (controls.directions) {
    for (const edge of reading.edges) {
      if (!index.has(edge.source) || !index.has(edge.target)) continue
      const count = lineCount(edge, controls.line)
      if (count > 0) edges.push({ source: edge.source, target: edge.target, count, width: 0 })
    }
  } else {
    for (const pair of pairs.values())
      if (pair.selected > 0)
        edges.push({
          source: nodes[pair.source]!.id,
          target: nodes[pair.target]!.id,
          count: pair.selected,
          width: 0,
        })
  }
  const lineMax = edges.reduce((m, e) => Math.max(m, e.count), 0)
  for (const edge of edges)
    edge.width = 0.35 + 2.6 * normalized(edge.count, lineMax, controls.scaling)
  const physical = [...pairs.values()]
  const proximityMax = physical.reduce(
    (m, p) => Math.max(m, controls.proximity === 'messages' ? p.messages : p.selected),
    0,
  )
  const links = physical.map((p) => ({
    source: p.source,
    target: p.target,
    weight: normalized(
      controls.proximity === 'messages' ? p.messages : p.selected,
      proximityMax,
      controls.scaling,
    ),
  }))
  return { nodes, radii, edges, links, tooLarge: false, unsafe: false }
}
export function graphPartners(
  reading: GraphReading,
  view: GraphView,
  id: string,
  line: LineMetric,
): { node: GraphNode; count: number }[] {
  const nodes = new Map(view.nodes.map((n) => [n.id, n])),
    counts = new Map<string, number>()
  for (const edge of reading.edges) {
    const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null
    if (!other || !nodes.has(other)) continue
    const count = (counts.get(other) ?? 0) + lineCount(edge, line)
    if (Number.isSafeInteger(count)) counts.set(other, count)
  }
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || scalarCompare(a[0], b[0]))
    .slice(0, 5)
    .map(([id, count]) => ({ node: nodes.get(id)!, count }))
}

export type Point = { x: number; y: number }
export class GraphBins {
  private cells = new Map<string, number[]>()
  constructor(readonly size = 64) {}
  add(index: number, x: number, y: number, radius: number): void {
    for (
      let cx = Math.floor((x - radius) / this.size);
      cx <= Math.floor((x + radius) / this.size);
      cx++
    )
      for (
        let cy = Math.floor((y - radius) / this.size);
        cy <= Math.floor((y + radius) / this.size);
        cy++
      ) {
        const key = `${cx}:${cy}`,
          bucket = this.cells.get(key) ?? []
        bucket.push(index)
        this.cells.set(key, bucket)
      }
  }
  at(x: number, y: number): readonly number[] {
    return this.cells.get(`${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`) ?? []
  }
}

export function labelBudget(
  count: number,
  badges: boolean,
): { badges: number; names: number; ordinary: number } {
  const badgeCount = badges ? Math.min(count, count <= B.labels ? count : 150) : 0
  return {
    badges: badgeCount,
    names: B.labels - badgeCount,
    ordinary: badges ? B.labels - badgeCount : 250,
  }
}
