import { nextTick, ref, type Ref } from 'vue'
import { readableError } from '../lib/session-record'
import { anchorAfterPrepend, anchorAfterShift, shouldLoadOlder } from '../lib/transcript-window'

/**
 * Fetch the page before the one on screen, and keep the reader looking at the same words (054).
 *
 * ## Why the scroll restore is not optional
 *
 * A browser preserves `scrollTop` across a DOM change, not position. Inserting a page above the
 * viewport pushes everything down by the height it added, so a reader who was part-way through a
 * message is suddenly hundreds of pixels further on — and because the top is now further away, the
 * "near the top" trigger fires again, and again, and the view walks backwards through the
 * conversation on its own. A jumping scroll is worse than a slow one; this one is also self-feeding.
 *
 * ## ⛔ A prepend that also RELEASES, and why the height difference was the wrong signal
 *
 * (299 §2, from 297 finding 4.) `anchorAfterPrepend` is `scrollTop + (afterHeight − beforeHeight)`,
 * and every number in its tests was hand-written for a PURE prepend. Inside one awaited call
 * `prependPage` inserts a page at the top **and deletes from the bottom** once the window is over
 * its cap — `keep` is pinned at `WINDOW_MAX_EVENTS − WINDOW_RELEASE_CHUNK`, so from the second page
 * back onwards it inserts ~1,900 entries and releases ~1,950 **in the same patch**. The container
 * therefore grows by A at the top and shrinks by R at the bottom, `A ≈ R`, the difference is ≈ 0,
 * and the anchor moves the reader **nowhere** while ~1,900 events slide down beneath them. They are
 * left inside the 400px trigger band, so the next scroll event fetches again, and the view walks
 * backwards on its own — paying one re-fold per page.
 *
 * ⚑ **The fix is to stop deriving A from a total that also contains R, and measure A directly.**
 * The row a reader was looking at is still on screen after the patch; what changed is where it sits.
 * So this remembers the topmost rendered row and puts the scroll back by exactly how far that row
 * moved. Anything deleted below it is then irrelevant by construction, which is the property the
 * height difference never had.
 *
 * ⚠️ **The handle is the ledger ORDINAL and it could not have been `item.id`.** A prepend re-folds,
 * and a fresh fold renumbers every item — the row that was `assistant_1` comes back as
 * `assistant_1901` — so an id remembered across this call names a different row. `transcript.ts`'s
 * `Placed` is where that number comes from and why it exists.
 *
 * ## One at a time
 *
 * `loading` guards re-entry. Scroll fires continuously, so without it a single flick to the top
 * would launch a dozen overlapping fetches, each prepending onto an array the others are also
 * prepending onto.
 */
export function useOlderHistory(options: {
  /** The scroll container. */
  el: Ref<HTMLElement | null>
  /** Whether there is anything before what is loaded. */
  hasOlder: () => boolean
  /** Fetch and prepend one page. Resolves when the store has been updated. */
  load: () => Promise<void>
  /**
   * Stop following the newest line, because this gesture says the reader is going the other way
   * (299 §2, from 297 4b). Optional so a caller that has no follow to release — a test, a panel
   * with no live tail — does not have to invent one.
   */
  releaseFollow?: () => void
}) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Where a row sits inside the scroll CONTENT — not `offsetTop`, which is measured from whichever
   * ancestor happens to be positioned and would silently change meaning if the layout around this
   * container did.
   */
  function contentTop(node: HTMLElement, row: HTMLElement): number {
    return row.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop
  }

  /** The topmost rendered row that carries a ledger ordinal, and where it is now. */
  function anchorRow(node: HTMLElement): { ordinal: string; top: number } | null {
    const row = node.querySelector<HTMLElement>('.entry[data-ordinal]')
    const ordinal = row?.dataset['ordinal']
    return row && ordinal ? { ordinal, top: contentTop(node, row) } : null
  }

  async function loadOlder(): Promise<void> {
    const node = options.el.value
    if (loading.value || !options.hasOlder() || !node) return
    loading.value = true
    error.value = null
    // ⛔ **Before anything else**, because the follow and this composable write the same property
    // and nothing else orders them. See {@link useStickToBottom.release}.
    options.releaseFollow?.()
    // Captured BEFORE the await: by the time it resolves the DOM has not changed yet, but the
    // component may have re-rendered for an unrelated reason, and the pair has to come from the
    // same moment to describe the same layout.
    const before = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight }
    const anchor = anchorRow(node)
    try {
      await options.load()
      await nextTick() // after the older page is in the DOM
      const after = options.el.value
      if (!after) return
      const moved =
        anchor === null
          ? null
          : after.querySelector<HTMLElement>(`.entry[data-ordinal="${CSS.escape(anchor.ordinal)}"]`)
      // ⚠️ **The fallback is the old arithmetic, and it is reached exactly where it is still
      // right.** No anchor means no row on screen carried an ordinal — a synthetic fold, or a page
      // whose rows were all built by carried events — and a released anchor means the release took
      // the entire window the reader was in, which `prependPage` only does when one page is itself
      // larger than the retained slab. Neither is the case this exists for, and a height difference
      // is still the best available answer for both.
      after.scrollTop =
        anchor !== null && moved !== null
          ? anchorAfterShift(before.scrollTop, contentTop(after, moved) - anchor.top)
          : anchorAfterPrepend(before, after.scrollHeight)
    } catch (cause) {
      error.value = readableError(cause)
    } finally {
      loading.value = false
    }
  }

  /** Bind alongside the panel's own `scroll` handler. */
  function onScroll(): void {
    const node = options.el.value
    if (!node || !shouldLoadOlder(node)) return
    void loadOlder()
  }

  return { loading, error, loadOlder, onScroll }
}
