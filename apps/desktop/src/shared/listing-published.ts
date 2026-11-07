/**
 * The listing as one publication: both halves from one composition, under one `{epoch, seq}`. A
 * window keeps one scope for it, keyed by each row's `sessionId` whichever half it is in; a states
 * push keys its rows by the same conversation id.
 */
import type { Published, PublicationEpoch } from './data-version'
import type { ResumableSessionInfo, UnresumableSessionInfo } from './runtime-ipc'

export interface PublishedListing {
  readonly resumable: readonly ResumableSessionInfo[]
  readonly unresumable: readonly UnresumableSessionInfo[]
  readonly published: Published
}

/** The listing could not be answered at all, said at the stamp it failed against. */
export interface ListingRefused {
  readonly refused: string
  readonly published: { readonly epoch: PublicationEpoch; readonly seq: number }
}

export type ListingAnswer = PublishedListing | ListingRefused
