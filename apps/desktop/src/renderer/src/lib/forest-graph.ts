import type { ForestRow, ForestView } from './the-forest'

/** Fold the pre-order rows into cards, and place Team's tree in rows of generations. */

/** ⚑ One conversation in the graph, with the tasks it holds. */
export interface GraphNode {
  /** ⛔ The conversation row itself, unchanged — every fact the node prints is on it. */
  readonly row: ForestRow
  /** ⚑ **The tasks this conversation holds**, in the list's order — the rows that followed it. */
  readonly tasks: readonly ForestRow[]
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
  readonly parent: Building | null
  readonly generation: number
  span: number
  centre: number
}

/** Rebuild parent links from the pre-order rows without recursion. */
function buildForest(view: ForestView): { all: Building[]; roots: Building[] } {
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

  return { all, roots }
}

/** Cards and parent links without placement, for a library to lay out. */
export function forestNodes(view: ForestView): GraphNode[] {
  return buildForest(view).all.map((node) => ({
    row: node.row,
    tasks: node.tasks,
    generation: node.generation,
    centre: 0,
    parent: node.parent?.row.conversation ?? null,
  }))
}

export function forestGraph(view: ForestView): ForestGraph {
  const { all, roots } = buildForest(view)
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
    row.push({
      row: node.row,
      tasks: node.tasks,
      generation: node.generation,
      centre: node.centre,
      parent: node.parent?.row.conversation ?? null,
    })
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
  return (
    node.parent !== null &&
    node.tasks.some((task) => task.taskRow?.open === true && task.taskRow.giver === node.parent)
  )
}
