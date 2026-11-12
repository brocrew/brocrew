import {
  FOREST_PAGE,
  type ForestReading,
  type ForestListed,
  type ForestNodesPage,
  type ForestScope,
  type TheWholeForest,
} from '../../../shared/the-whole-forest'
import type { LedgerWalk } from '../../../shared/question-contracts'
import type { ForestNode } from '../../../shared/the-whole-forest'

export interface ForestSnapshot {
  readonly reading: ForestReading
  readonly forest: TheWholeForest
  readonly loaded: number
  readonly expected: number
  readonly complete: boolean
}

export interface ForestReader {
  forestReading(scope: ForestScope): Promise<ForestReading | null>
  forestNodes(
    reading: ForestListed,
    conversations: readonly string[],
  ): Promise<ForestNodesPage | null>
}

/** Publish each page with its original membership and clock; stop asking when the view moves. */
export async function readForestPages(
  reader: ForestReader,
  scope: ForestScope,
  current: () => boolean,
  publish: (snapshot: ForestSnapshot) => void,
): Promise<boolean> {
  const reading = await reader.forestReading(scope)
  if (!current() || reading === null) return false
  let nodes = reading.nodes
  const expected = reading.members.admitted.length + reading.context.length + reading.behind.length
  let loaded = nodes.ledgers
  const send = (complete: boolean): void =>
    publish({
      reading,
      loaded,
      expected,
      complete,
      forest: {
        readAt: reading.readAt,
        conversations: expected,
        heldByNoAgent: reading.heldByNoAgent,
        nodes,
      },
    })
  send(reading.unfolded.length === 0)
  // The first answer supplies the page order, so a page never re-applies a moving time window.
  for (let offset = 0; offset < reading.unfolded.length; offset += FOREST_PAGE) {
    if (!current()) return false
    const page = await reader.forestNodes(
      { members: reading.members, context: reading.context, behind: reading.behind },
      reading.unfolded.slice(offset, offset + FOREST_PAGE),
    )
    if (!current() || page === null || page.gone.length > 0) return false
    nodes = appendNodes(nodes, page.nodes)
    loaded += page.nodes.ledgers
    send(offset + FOREST_PAGE >= reading.unfolded.length)
  }
  return true
}

function appendNodes(
  left: LedgerWalk<ForestNode>,
  right: LedgerWalk<ForestNode>,
): LedgerWalk<ForestNode> {
  return {
    ...left,
    rows: [...left.rows, ...right.rows],
    ledgers: left.ledgers + right.ledgers,
    rowsUnread: left.rowsUnread + right.rowsUnread,
    ...((left.ledgersSkipped ?? 0) + (right.ledgersSkipped ?? 0) > 0
      ? { ledgersSkipped: (left.ledgersSkipped ?? 0) + (right.ledgersSkipped ?? 0) }
      : {}),
  }
}
