import type { SessionStore, ForestedNode } from './session-store'
import type { LedgerWalk } from '../../shared/question-contracts'
import { FOREST_PAGE } from '../../shared/the-whole-forest'
import type { ForestListing, ForestListingAsked } from './forest-listing'

/** A reading's first answer: its conversations and the first page of their nodes. */
export interface ForestFirstRead {
  readonly listing: ForestListing
  readonly nodes: LedgerWalk<ForestedNode>
  /** The listed conversations whose nodes are still to be read, in the order to ask. */
  readonly unfolded: readonly string[]
  readonly heldByNoAgent: number
}

/**
 * Every conversation a listing names, in the order its nodes are read: a tree's root first, then
 * the replaced and the connecting ancestors, then the members newest first.
 */
export function listedInOrder(listing: ForestListing): string[] {
  const root = listing.root === null ? [] : [listing.root]
  return [
    ...root,
    ...listing.behind,
    ...listing.context,
    ...listing.admitted.filter((id) => id !== listing.root),
  ]
}

/** Lists a reading and reads the nodes of its first {@link FOREST_PAGE} conversations. */
export function readTheForestFirst(
  store: Pick<SessionStore, 'forestListing' | 'forestNodesOf' | 'conversationsHeldByNoAgent'>,
  asked: ForestListingAsked,
): ForestFirstRead {
  const listing = store.forestListing(asked)
  const listed = listedInOrder(listing)
  const first = listed.slice(0, FOREST_PAGE)
  return {
    listing,
    // Read in the same snapshot as the listing, so none of the first page is gone.
    nodes: store.forestNodesOf(first, new Set(listed), asked.hidden).nodes,
    unfolded: listed.slice(FOREST_PAGE),
    heldByNoAgent: store.conversationsHeldByNoAgent(),
  }
}
