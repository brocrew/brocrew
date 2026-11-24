import { type HistoryWindow } from '../../../shared/runtime-ipc'

/**
 * ⚑ **W4.203 · how far back a conversation's ledger is looked through for its newest context
 * reading, the first time a read names it** (`RuntimeHost.lastContextOf`). A conversation this app
 * runs records one with every reply its provider makes, so its newest sits within the last few
 * dozen rows; the bound is what keeps a ledger that holds none from being walked whole.
 */
const CONTEXT_LOOKBACK_ROWS = 2_000

/** The page a start nobody hands on carries: nothing, and everything before `next` still to read. */
function noPageBefore(next: number): HistoryWindow {
  return { entries: [], from: next, hasOlder: next > 0, turnAligned: true }
}

/** How many lines, ledger rows or archived frames one page of a turn's reading takes (W4.164). */
const TURN_AS_SENT_PAGE = 2_000

export { CONTEXT_LOOKBACK_ROWS, noPageBefore, TURN_AS_SENT_PAGE }
