import { nextTick } from 'vue'
import type { RailSays } from '../../src/renderer/src/lib/agent-state'
import { forestView, type ForestView } from '../../src/renderer/src/lib/the-forest'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import type { TaskState } from '../../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'

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

/** ⚑ **Vue Flow draws its cards a frame after the mount** — wait for that frame, then the next tick. */
export async function forestDrawn(): Promise<void> {
  await nextTick()
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  await nextTick()
}
