import type { ForestConversation, ForestTask } from '../../shared/the-whole-forest'
import type { LedgerWalk } from '../../shared/question-contracts'
import type { ForestListing, ForestListingAsked } from './forest-listing'

export type ForestedConversation = Omit<
  ForestConversation,
  'running' | 'standsInFor' | 'inItsPlace'
>

export type ForestedNode = ForestedConversation | ForestTask

export interface ForestStore {
  /** One forest reading's conversations, read structurally (`forest-listing.ts`). */
  forestListing(asked: ForestListingAsked): ForestListing
  /**
   * The nodes of the asked conversations that are still in a reading, in the order asked, each
   * parent and giver named as drawn when `drawn` holds it; the others asked are `gone`.
   */
  forestNodesOf(
    conversations: readonly string[],
    drawn: ReadonlySet<string>,
    hidden: readonly string[],
  ): { readonly nodes: LedgerWalk<ForestedNode>; readonly gone: readonly string[] }
}

export const EMPTY_FOREST_STORE: ForestStore = {
  forestListing: () => ({
    counts: null,
    root: null,
    total: 0,
    admitted: [],
    context: [],
    behind: [],
  }),
  forestNodesOf: (conversations) => ({
    nodes: { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 },
    gone: [...conversations],
  }),
}
