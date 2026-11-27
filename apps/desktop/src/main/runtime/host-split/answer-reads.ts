import { type RuntimeEventSink } from '../conversation-caller'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import type { RowsUnread } from '../../db/rows-unread'
import type { PublicationEpoch } from '../../../shared/data-version'

/**
 * `own`, whose notes also reach `answer`: a read that decides from what it alone could not read,
 * and is part of an answer that says how much it could not read.
 */
function notedInBoth(own: RowsUnread, answer: RowsUnread): RowsUnread {
  return {
    in: (sessionId) => {
      const mine = own.in(sessionId)
      const theirs = answer.in(sessionId)
      return (ordinal) => {
        mine(ordinal)
        theirs(ordinal)
      }
    },
    get count() {
      return own.count
    },
    get ledgersSkipped() {
      return own.ledgersSkipped
    },
  }
}

/** Each slice filling question copies visits at most this many ledger rows, starting at `first`. */
const COPY_SLICE_ROWS = { first: 200, least: 50, most: 2000 } as const
/** And stops once it has visited this many payload bytes; the row that crosses it is its last. */
const COPY_SLICE_BYTES = 256 * 1024
/** What a slice aims to take; the row bound halves or doubles toward it. Not a preemption. */
const COPY_SLICE_TARGET_MS = 4
const COPY_BUSY_WAIT_MS = { least: 10, most: 1000 } as const
const SAY_COPY_PROGRESS_EVERY_MS = 60_000

/**
 * ⚑ **D-037 · hand the main process back** between pages of a search — `setImmediate` and not
 * `await null`, `sweep.ts`'s reason: a resolved promise runs before anything else waiting does.
 */
function handBackTheMainProcess(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * ⚑ **D-017 · R11 — what every card in one answer is read against** — see
 * `RuntimeHost.cardReads`: the roster that names each conversation, and the conversations whose
 * asks against their rules wait on a person.
 */
interface CardReads {
  readonly roster: readonly AgentIdentity[]
  readonly askingForRules: ReadonlySet<string>
  /** Rows of the asks against agents' rules the read could not take: a reading that skipped any is short. */
  readonly asksUnread: number
  readonly nameOf?: (conversation: string) => string
}

/**
 * ⚑ **One window's look at a conversation nothing runs** — see {@link RuntimeHost.lookingAtItsRecord}.
 * A look takes back only its own, so it is an object of its own even for the same window.
 */
interface OneLook {
  readonly sink: RuntimeEventSink
  /** The same window's look this one took the place of, until this one's page is drawn. */
  before?: OneLook
  /** It failed: never put back in the place of a look that fails after it. */
  failed?: true
}

type ListingReadFloor = {
  readonly epoch: PublicationEpoch
  readonly seq: number
  readonly read: number
}

export {
  type CardReads,
  COPY_BUSY_WAIT_MS,
  COPY_SLICE_BYTES,
  COPY_SLICE_ROWS,
  COPY_SLICE_TARGET_MS,
  handBackTheMainProcess,
  type ListingReadFloor,
  notedInBoth,
  type OneLook,
  SAY_COPY_PROGRESS_EVERY_MS,
}
