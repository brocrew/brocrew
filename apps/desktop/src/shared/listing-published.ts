/**
 * The listing as one publication: both halves from one composition, under one `{epoch, seq}`. A
 * window keeps one scope for it, keyed by each row's `sessionId` whichever half it is in; a states
 * push keys its rows by the same conversation id.
 */
import type { Published, PublicationEpoch } from './data-version'
import type { ResumableSessionInfo, UnresumableSessionInfo } from './conversation-listing-contracts'

export interface PublishedListing {
  readonly resumable: readonly ResumableSessionInfo[]
  readonly unresumable: readonly UnresumableSessionInfo[]
  /** A worker listing uses its dispatch publication floor, not its later completion time. */
  readonly published: Published
  /** Shared read order, independent of publication ticks; repeated use of a snapshot keeps it. */
  readonly readAsOf?: number
  /** Ordinary writes overtook the snapshot; show it, then ask once more. */
  readonly refresh?: boolean
}

/** The listing could not be answered at all, said at the stamp it failed against. */
export interface ListingRefused {
  readonly refused: string
  readonly published: { readonly epoch: PublicationEpoch; readonly seq: number }
}

export type ListingAnswer = PublishedListing | ListingRefused
