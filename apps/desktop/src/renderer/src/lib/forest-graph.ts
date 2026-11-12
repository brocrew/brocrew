import type { ForestRow, ForestView } from './the-forest'

/** Fold the pre-order rows into cards, and place Team's tree in rows of generations. */

/** ⚑ One conversation in the graph, with the tasks it holds. */
export interface GraphNode {
  /** The representative row; group members retain their original conversation ids. */
  readonly row: ForestRow
  /** ⚑ **The tasks this conversation holds**, in the list's order — the rows that followed it. */
  readonly tasks: readonly ForestRow[]
  readonly members?: readonly GraphNode[]
  readonly waitingOnParent?: boolean
  /** 0 for a conversation a person started (or whose starter this reading did not draw). */
  readonly generation: number
  /** Its centre in slots for Team's row layout; unused for Dagre. */
  readonly centre: number
  /** The conversation that started it, or `null` for a node in the first generation. */
  readonly parent: string | null
}

/** ⚑ A line from a parent to one conversation it started. */
export interface GraphEdge {
  /** The generation the CHILD is in — the edge is drawn in the band above that row. */
  readonly generation: number
  readonly from: number
  readonly to: number
  readonly child: string
}

export interface ForestGraph {
  /** ⚑ **Row by row, top to bottom**; within a row, left to right. */
  readonly generations: readonly (readonly GraphNode[])[]
  readonly edges: readonly GraphEdge[]
  /** ⚑ **How many slots wide the widest arrangement is** — at least one. */
  readonly slots: number
}

interface Building {
  readonly row: ForestRow
  readonly tasks: ForestRow[]
  readonly children: Building[]
  parent: Building | null
  readonly generation: number
  span: number
  centre: number
  members?: readonly GraphNode[]
  waitingOnParent?: boolean
}

/** Rebuild parent links from the pre-order rows without recursion. */
function buildForest(view: ForestView, grouped = false): { all: Building[]; roots: Building[] } {
  const all: Building[] = []
  const roots: Building[] = []
  // ⛔ **The stack holds the open ancestors** — a conversation row at depth d closes every open
  // row at depth ≥ d, and its parent is what is left on top.
  const open: Building[] = []
  let last: Building | null = null
  for (const row of view.rows) {
    if (row.kind === 'a-task') {
      // ⚑ **A task belongs to the conversation row before it** — the fold emits each conversation's
      // tasks straight after it, and before any child.
      last?.tasks.push(row)
      continue
    }
    while (open.length > 0 && open[open.length - 1]!.row.depth >= row.depth) open.pop()
    const parent = open[open.length - 1] ?? null
    const node: Building = {
      row,
      tasks: [],
      children: [],
      parent,
      generation: parent === null ? 0 : parent.generation + 1,
      span: 1,
      centre: 0,
    }
    if (parent === null) roots.push(node)
    else parent.children.push(node)
    all.push(node)
    open.push(node)
    last = node
  }

  if (!grouped) return { all, roots }

  const buckets = new Map<string, Building[]>()
  for (const node of all) {
    if (node.row.identity === null || node.row.conversationRow?.context) continue
    const key = JSON.stringify([node.parent?.row.conversation ?? null, node.row.identity])
    const bucket = buckets.get(key)
    if (bucket) bucket.push(node)
    else buckets.set(key, [node])
  }
  const replacement = new Map<Building, Building>()
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue
    const members = bucket
      .map(asGraphNode)
      .sort(
        (a, b) =>
          (b.row.conversationRow?.updatedAt ?? 0) - (a.row.conversationRow?.updatedAt ?? 0) ||
          b.row.conversation.localeCompare(a.row.conversation),
      )
    const latest = members[0]!
    const group: Building = {
      ...bucket[0]!,
      row: { ...latest.row, conversation: `group:${key}`, key: `group:${key}` },
      tasks: [],
      children: [],
      members,
      waitingOnParent: members.some(waitsOnIt),
    }
    for (const member of bucket) replacement.set(member, group)
  }
  const groupedNodes: Building[] = []
  const groupedRoots: Building[] = []
  const seen = new Set<Building>()
  for (const original of all) {
    const node = replacement.get(original) ?? {
      ...original,
      children: [],
      waitingOnParent: waitsOnIt(asGraphNode(original)),
    }
    replacement.set(original, node)
    if (seen.has(node)) continue
    seen.add(node)
    groupedNodes.push(node)
  }
  for (const original of all) {
    const node = replacement.get(original)!
    if (!seen.delete(node)) continue
    const parent = original.parent === null ? null : replacement.get(original.parent)!
    // The original parent relation is retained even when its card groups several conversations.
    node.parent = parent
    if (parent) parent.children.push(node)
    else groupedRoots.push(node)
  }
  return { all: groupedNodes, roots: groupedRoots }
}

function asGraphNode(node: Building): GraphNode {
  return {
    row: node.row,
    tasks: node.tasks,
    generation: node.generation,
    centre: node.centre,
    parent: node.parent?.row.conversation ?? null,
    ...(node.members ? { members: node.members } : {}),
    ...(node.waitingOnParent === undefined ? {} : { waitingOnParent: node.waitingOnParent }),
  }
}

/** Cards and parent links without placement, for a library to lay out. */
export function forestNodes(view: ForestView, grouped = false): GraphNode[] {
  return buildForest(view, grouped).all.map(asGraphNode)
}

export function forestGraph(view: ForestView, grouped = false): ForestGraph {
  const { all, roots } = buildForest(view, grouped)
  // ⚑ **Spans, children first** — pre-order reversed visits every child before its parent.
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const node = all[i]!
    node.span = Math.max(
      1,
      node.children.reduce((sum, child) => sum + child.span, 0),
    )
  }

  // ⚑ **Places, parents first** — each node's children share its span, left to right.
  const leftOf = new Map<Building, number>()
  let cursor = 0
  for (const root of roots) {
    leftOf.set(root, cursor)
    cursor += root.span
  }
  for (const node of all) {
    const left = leftOf.get(node) ?? 0
    node.centre = left + node.span / 2
    let childLeft = left
    for (const child of node.children) {
      leftOf.set(child, childLeft)
      childLeft += child.span
    }
  }

  const generations: GraphNode[][] = []
  const edges: GraphEdge[] = []
  for (const node of all) {
    const row = (generations[node.generation] ??= [])
    row.push(asGraphNode(node))
    if (node.parent !== null) {
      edges.push({
        generation: node.generation,
        from: node.parent.centre,
        to: node.centre,
        child: node.row.conversation,
      })
    }
  }
  // ⚑ Left to right within a row — pre-order already is, and a sort says so rather than trusting it.
  for (const row of generations) row.sort((a, b) => a.centre - b.centre)
  return { generations, edges, slots: Math.max(1, cursor) }
}

/**
 * A dashed link means the child still holds open work its parent gave it, including stalled and waiting states. Do not count work from another giver or a root. Neither conversation's current activity changes that relationship.
 */
export function waitsOnIt(node: GraphNode): boolean {
  if (node.waitingOnParent !== undefined) return node.waitingOnParent
  return (
    node.parent !== null &&
    node.tasks.some((task) => task.taskRow?.open === true && task.taskRow.giver === node.parent)
  )
}
