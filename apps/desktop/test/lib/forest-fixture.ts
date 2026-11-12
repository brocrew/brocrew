import type { TaskState } from '../../src/shared/task-contracts'
import type { RailSays } from '../../src/renderer/src/lib/agent-state'
import { forestView, type ForestView } from '../../src/renderer/src/lib/the-forest'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'

import type { ForestNode, TheWholeForest, ForestReading, ForestScope } from '../../src/shared/the-whole-forest'

/**
 * # ⚑ A forest to draw — for the surfaces that draw `TeamForest` outside the Team page
 *
 * The main panel’s Graph tab and Team page share the same forest. Graph suites therefore
 * build the same `TheWholeForest` fixture as the Team suites, using the shapes written inline
 * in `who-called-whom-as-generations.dom.test.ts`.
 */

const NOW = 1_800_000_000_000

/** ⚑ One conversation, under the person (`parent` null) or under another conversation. */
export const conv = (
  id: string,
  parent: string | null,
  over: Record<string, unknown> = {},
): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
    under: parent === null ? { is: 'the-person' } : { is: 'a-conversation', conversation: parent },
    identity: id.replace('sess_', ''),
    provider: 'claude',
    status: 'idle',
    running: 'not-running',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  }) as ForestNode

/** ⚑ One piece of work, held by `holder` and given by `giver` (null is a person). */
export const task = (
  holder: string,
  piece: string,
  label: string,
  title: string,
  giver: string | null,
  state: TaskState = 'working',
): ForestNode =>
  ({
    node: 'a-task',
    under: { is: 'a-conversation', conversation: holder },
    givenBy: giver === null ? { is: 'the-person' } : { is: 'a-conversation', conversation: giver },
    work: {
      piece,
      label,
      title,
      from: giver,
      fromIdentity: giver?.replace('sess_', '') ?? null,
      to: holder,
      toIdentity: holder.replace('sess_', ''),
      state,
      givenAt: NOW - 30_000,
      endedAt: null,
    },
  }) as unknown as ForestNode

export const forestOf = (rows: readonly ForestNode[]): TheWholeForest =>
  ({
    readAt: NOW,
    nodes: {
      rows,
      walk: 'every-conversation-this-app-placed',
      ledgers: rows.filter((row) => row.node === 'a-conversation').length,
      rowsUnread: 0,
    },
    conversations: rows.filter((row) => row.node === 'a-conversation').length,
    heldByNoAgent: 0,
  }) as unknown as TheWholeForest

/** ⚑ The forest, folded as the screen folds it for both drawings. */
export const viewOf = (
  rows: readonly ForestNode[],
  identities: readonly AgentIdentity[] | null = null,
  said?: ReadonlyMap<string, RailSays> | null,
): ForestView =>
  forestView({
    forest: forestOf(rows),
    atWork: null,
    waits: null,
    identities,
    held: new Set<string>(),
    ...(said === undefined ? {} : { said }),
  })!

/** One supplied read, with explicit fixture membership and no renderer window filtering. */
export function readingOf(
  rows: readonly ForestNode[],
  scope: ForestScope = { is: 'the-workspace', window: 'day' },
  over: Partial<ForestReading> = {},
): ForestReading {
  const forest = forestOf(rows)
  const admitted = rows.flatMap((row) => row.node === 'a-conversation' ? [row.conversation] : [])
  const count = admitted.length
  return {
    id: 'fictional-reading',
    scope,
    measuredFrom: NOW,
    counts: scope.is === 'the-workspace' ? { active: count, hour: count, day: count, week: count, all: count } : null,
    root: scope.is === 'the-tree-of' ? admitted[0] ?? null : null,
    members: { total: count, admitted },
    context: [],
    behind: [],
    nodes: forest.nodes,
    unfolded: [],
    heldByNoAgent: 0,
    readAt: NOW,
    ...over,
  }
}
