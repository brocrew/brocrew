import { type Provider } from '@brobot2/shared'
import type { SessionStore } from '../db/session-store'
import { FileEdits } from '@brobot2/runtime'
import { isConversation } from './transcript-types'
import type { ResolveImagePath } from './transcript-types'
import { providerDefinitions } from '../providers/definitions'
import type { LineChunk } from './native-file'
import { NORMALIZER_VERSION } from './normalizer'

/**
 * **Project a provider's own file into the conversation the app renders** — once, or again.
 *
 * The provider's file is the record; `events` is the product's reading of it. This is the one place
 * that turns the first into the second, and the one place that REBUILDS one. Nothing of the file is
 * kept: a conversation whose file is gone keeps what was read from it and can't be read again.
 *
 * A generation is built into `active + 1`, **beside** the one being read, in bounded batches that
 * yield and ask whether they may continue. Nothing it writes is ever read, because reads are scoped
 * to the active generation — so a failure, a crash or a quit costs disk and nothing else, and the
 * previous projection stays whole and current. Only when the build has finished does one small
 * transaction make it the active one.
 *
 * A file of nothing but the provider's own bookkeeping ends as `nothing-readable`: its entries are
 * written as they are parsed and the generation is simply never promoted.
 *
 * ## It does not decide to rebuild
 *
 * `rebuild` is a parameter and it is always the caller's. Nothing here re-derives a session because
 * it noticed it was stale. A rebuild happens when a session is named.
 */

/**
 * Where a derive reads the provider's lines: at most `maxLines` from a position, and the position to
 * carry on from. A file's position is a byte offset ({@link readLines}).
 */
export type ProviderLines = (from: number, maxLines: number) => LineChunk

/** What a derive did. Every ending is named; none of them is silent. */
export type DeriveOutcome =
  /** A projection was built and promoted. */
  | 'imported'
  /** The file holds no line of conversation. Nothing was promoted. */
  | 'nothing-readable'
  /** The final record was unfinished. Nothing was promoted; another import can retry. */
  | 'still-writing'
  /** Already projected, and not a rebuild. */
  | 'skipped'
  /**
   * Asked to stop — before a batch, or between the write slices inside one (073). The previous
   * projection is untouched, and the next pass retries.
   *
   * The boundary is named precisely because it moved: it used to be only "between batches", which
   * meant a derive small enough to fit in one was never asked at all.
   */
  | 'stopped'
  /** It threw. The previous projection is untouched, and the reason is on the session's record. */
  | 'failed'
  /**
   * 🔴 **Everything was built and the flip was REFUSED** (293 §4, from 289 rank 3) — another writer
   * had replaced the `building` marker, so `promoteGeneration`'s `building = ?` guard changed zero
   * rows and nothing this pass wrote is readable.
   *
   * ⚠️ **Not `failed`**, which puts a reason on the session's record and reads as *"your conversation
   * is broken"*; nothing is broken and the projection that IS active is somebody else's, built from
   * the same file. ⚠️ **Not `refused`** either — that word already means *"the app was shutting
   * down and started nothing"*, and this one started everything and lost. ⚠️ **And not `stale`**,
   * which is taken: `LedgerStatus.derived === 'stale'` means an older version of the app read it,
   * which is a different sentence about a different object.
   */
  | 'superseded'

export interface DeriveTally {
  eventsWritten: number
  unreadableLines: number
}

export interface DeriveOptions {
  /** Only if the file names no time at all does this stand in. */
  fallbackAt: number
  /**
   * The ceiling on one step, applied in BOTH directions — lines read, and rows written in one
   * transaction. One Claude assistant record with a long `content` array becomes many rows, so a
   * bound on the reading alone would leave the writing, which holds the main process, unbounded.
   *
   * ⚠️ **One number, two units, and a caller tuning either one tunes both.** It is `n` lines per
   * read and `n` events per commit, which are not the same quantity — a fan-out line crosses the
   * two. That is deliberate rather than overlooked: a second knob would be a second thing every
   * caller has to get right, and there is no caller today that wants the two apart. If one ever
   * does, it needs its own field and this comment is where to say so.
   */
  batchSize?: number
  /** Counters the caller is accumulating. */
  tally?: DeriveTally
  /**
   * Turn a Codex image item's claim into a path we are willing to serve, or null (065/067). Absent
   * means no image event carries a path at all — which is the honest answer when the caller has no
   * home to check a claim against, and never a reason to pass the provider's string through unread.
   */
  resolveImage?: ResolveImagePath
  /**
   * Asked BEFORE every batch and between the write slices within one; true stops the build (062's
   * coordinator signal, unchanged). Stopping loses nothing — the file is still there and the
   * previous projection is still active.
   *
   * ⚠️ **The longest uninterruptible span is therefore one read plus one parse plus one slice**, not
   * zero — the question has to be asked somewhere, and everything between the asking and the next
   * ask is committed. Stated rather than rounded up to "always interruptible", because a bound that
   * overstates itself is the class of claim 068 finding 6 was about in the first place.
   *
   * Optional here and REQUIRED of the callers, which is not a contradiction: the imports and
   * `rebuildLedger` all run under the coordinator and all pass theirs, and a test that derives a
   * fixture directly has nobody to ask.
   */
  cancelled?: () => boolean
  /**
   * Rebuild a session that ALREADY has a projection.
   *
   * False everywhere an import calls this, which is what makes "mark stale, rebuild on request" a
   * property of the code rather than a promise in a comment.
   */
  rebuild?: boolean
}

/** How many rows one bounded collection step deletes. See {@link SessionStore.discardGeneration}. */
const DISCARD_BATCH = 2_000
const DEFAULT_DERIVE_BATCH = 2_000

/**
 * Hand the event loop back. `setImmediate` and not `await null`: a resolved promise runs on the
 * microtask queue, which is drained before any I/O or paint, so it would yield to nothing.
 */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function deriveLedger(
  store: SessionStore,
  sessionId: string,
  provider: Provider,
  read: ProviderLines,
  options: DeriveOptions,
): Promise<DeriveOutcome> {
  // Two producers writing one ledger would show the conversation twice, which is worse than not
  // importing at all — so a session with a projection is left alone unless a rebuild was asked for.
  if (options.rebuild !== true && store.ledgerStatus(sessionId).present) return 'skipped'

  const batchSize = options.batchSize ?? DEFAULT_DERIVE_BATCH
  const tally = options.tally ?? { eventsWritten: 0, unreadableLines: 0 }

  // Clear what an earlier attempt abandoned BEFORE starting, in bounded steps that yield, so a
  // session that fails repeatedly does not accumulate a projection's worth of dead rows per attempt.
  await collectDeadGenerations(store, sessionId, options.cancelled)

  const generation = store.beginGeneration(sessionId)
  let carriedAt = options.fallbackAt
  // The file edits still awaiting a result, carried across batches exactly like `carriedAt`: a
  // `file_change` spans two records, so a batch boundary between them must not drop it.
  let carriedEdits: FileEdits | undefined
  let ordinal = 0
  let linesRead = 0
  let sawConversation = false

  try {
    for (let from = 0; ;) {
      // Asked BEFORE the batch, so a derive that fits in one batch is still asked.
      if (options.cancelled?.() === true) {
        // Null, not a message: being asked to stop during a quit is not a fault.
        store.abandonGeneration(sessionId, generation, null)
        return 'stopped'
      }
      const chunk = read(from, batchSize)
      from = chunk.offset
      // Both providers terminate finished records. An observed unfinished tail leaves this
      // attempt unpublished, so the next import can read the completed record too.
      if (chunk.done && chunk.partial) {
        store.abandonGeneration(sessionId, generation, null)
        return 'still-writing'
      }
      const lines = chunk.lines
      linesRead += lines.length
      if (lines.length > 0) {
        // The timestamp each importer carries forward is threaded between calls — that is why a
        // batched parse equals a whole-file one.
        const parsed = providerDefinitions[provider].transcripts.parse(lines, carriedAt, {
          edits: carriedEdits,
          resolveImage: options.resolveImage,
        })
        carriedAt = parsed.lastAt
        carriedEdits = parsed.edits
        tally.unreadableLines += parsed.unreadable
        // Only the NEW entries are scanned: every earlier batch was already found to hold none.
        if (!sawConversation) {
          sawConversation = parsed.entries.some((entry) => isConversation(entry.event))
        }
        // ⚠️ **The bound is on events WRITTEN, not on lines read.** One line can become many rows,
        // and `appendGeneration` is one synchronous transaction per call, so the rows are sliced to
        // the same ceiling, with the same yield and the same question between slices.
        for (let start = 0; start < parsed.entries.length; start += batchSize) {
          if (start > 0) {
            await yieldToLoop()
            if (options.cancelled?.() === true) {
              store.abandonGeneration(sessionId, generation, null)
              return 'stopped'
            }
          }
          const slice = parsed.entries.slice(start, start + batchSize)
          store.appendGeneration(
            sessionId,
            generation,
            slice.map((entry) => ({
              ordinal: ordinal++,
              event: entry.event,
              at: entry.at,
            })),
          )
          tally.eventsWritten += slice.length
        }
      }

      if (chunk.done) break
      // Once per batch: better-sqlite3 is synchronous, so the batch is the real bound on how long one
      // step holds the thread, and the question that follows is at the top of the next iteration.
      await yieldToLoop()
    }
  } catch (error) {
    store.abandonGeneration(sessionId, generation, errorMessage(error))
    return 'failed'
  }

  if (!sawConversation) {
    // A ledger of nothing but the file's own bookkeeping is not a transcript, and promoting it would
    // leave the row claiming a conversation it cannot show.
    store.abandonGeneration(sessionId, generation, null)
    return 'nothing-readable'
  }

  const promoted = store.promoteGeneration(sessionId, generation, {
    normalizerVersion: NORMALIZER_VERSION,
    derivedThrough: linesRead,
  })
  // ⛔ **Collected either way, and the outcome is the flip's answer.** A generation that was not
  // promoted is unreachable by construction, so it is exactly what {@link collectDeadGenerations}
  // exists to delete.
  await collectDeadGenerations(store, sessionId, options.cancelled)
  return promoted ? 'imported' : 'superseded'
}

/**
 * Delete what the promotion made unreachable, in bounded steps.
 *
 * AFTER the flip and never inside it, which is the whole point of the column: the promotion is one
 * small write whatever the size of the conversation, and the cost of tidying up is paid where it can
 * be interrupted. Stopping early costs disk, never correctness — nothing here is readable.
 *
 * ⚠️ **It cannot fail the derive.** The projection is already active and already correct by the time
 * this runs; a delete that throws means some rows are still on disk, which is a housekeeping problem
 * and not a reason to tell the caller their conversation did not import.
 */
async function collectDeadGenerations(
  store: SessionStore,
  sessionId: string,
  cancelled?: () => boolean,
): Promise<void> {
  try {
    for (const dead of store.deadGenerations(sessionId)) {
      for (;;) {
        if (store.discardGeneration(sessionId, dead, DISCARD_BATCH) === 0) break
        await yieldToLoop()
        if (cancelled?.() === true) return
      }
    }
  } catch {
    // Deliberately swallowed — see the note above.
  }
}
