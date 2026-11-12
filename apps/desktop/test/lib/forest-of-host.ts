import { readForestPages, type ForestSnapshot } from '../../src/renderer/src/lib/forest-reading'
import type { ForestScope, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import type { ForestedNode, SessionStore } from '../../src/main/db/session-store'
import { listedInOrder } from '../../src/main/db/forest-first-read'
import type { LedgerWalk } from '../../src/shared/question-contracts'

/** Every conversation this app's agents hold, as the workspace's `all` window reads it. */
export const THE_WHOLE_WORKSPACE: ForestScope = { is: 'the-workspace', window: 'all' }

/** A host's forest for one scope, every page read, as the window puts it together. */
export async function forestSnapshotOf(
  host: Pick<RuntimeHost, 'forestReading' | 'forestNodes'>,
  scope: ForestScope = THE_WHOLE_WORKSPACE,
): Promise<ForestSnapshot> {
  let last: ForestSnapshot | null = null
  await readForestPages(
    {
      forestReading: (asked) => host.forestReading(asked),
      forestNodes: (reading, conversations) =>
        host.forestNodes(
          [...reading.members.admitted, ...reading.context, ...reading.behind],
          conversations,
        ),
    },
    scope,
    () => true,
    (snapshot) => {
      last = snapshot
    },
  )
  if (last === null) throw new Error('the forest reading answered nothing')
  return last
}

/** A host's forest for one scope, every page read. */
export async function forestOf(
  host: Pick<RuntimeHost, 'forestReading' | 'forestNodes'>,
  scope: ForestScope = THE_WHOLE_WORKSPACE,
): Promise<TheWholeForest> {
  return (await forestSnapshotOf(host, scope)).forest
}

/** A store's nodes for every conversation its agents hold, folded in one walk. */
export function storeForestOf(store: SessionStore): LedgerWalk<ForestedNode> {
  const listing = store.forestListing({
    scope: THE_WHOLE_WORKSPACE,
    measuredFrom: Date.now(),
    running: [],
    hidden: [],
    insteadOf: [],
  })
  const listed = listedInOrder(listing)
  return store.forestNodesOf(listed, new Set(listed), []).nodes
}
