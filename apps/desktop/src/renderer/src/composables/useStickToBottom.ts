import { nextTick, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue'

/**
 * Keep a scrolling panel pinned to its newest line while the user is at the
 * bottom, and stop the moment they scroll up to read something. A live stream
 * that does not follow is worse than no stream at all — the agent can be frozen
 * on a permission card that never comes into view.
 *
 * ## 🔴 504 · it followed CHANGES and never anchored at the START
 *
 * Scroll to the bottom when mounting with existing content, as well as when the watched signal changes. A change-only watch leaves a reopened history at its first row.
 *
 * ⚑ **It is exactly the population a person opens.** `ConversationPane` keys `TranscriptView` by
 * `sessionId`, so switching conversations builds a fresh one over a full transcript; a reopen awaits
 * `store.resume()` and shows the record afterwards. ⛔ A conversation that is mid-turn hid the
 * defect, because the first delta to arrive moves the signal and the follow catches up — so the
 * ones that looked right were the busy ones.
 *
 * ⛔ **This is NOT a second rule beside {@link release}'s.** The rule is *follow while the reader is
 * at the bottom, stop the moment they leave it* — and a reader who has not scrolled yet has not
 * left it: `stuck` starts `true`, and the mount hook asks the same flag the watcher asks.
 * ⚠️ **A mount-time scroll that ignored `stuck` would be a writer of `scrollTop` the release cannot
 * stop** — exactly the unordered pair `299` spent a dispatch removing, and it would fight
 * `useOlderHistory` on the one gesture that means the opposite.
 */
export function useStickToBottom(signal: () => unknown, thresholdPx = 40) {
  const el = ref<HTMLElement | null>(null)
  let stuck = true

  /**
   * 🔴 **UI-010 (F053) · whether the END of the content is on screen** — measured, never released.
   *
   * ⛔ **Not {@link stuck}, which answers a different question.** `stuck` is *will the next line be
   * followed*, and {@link release} sets it false with no scroll at all — pressing *Load earlier
   * messages* in a conversation that fits the box leaves its newest line in plain view. This is
   * only *can the reader see the newest line*, read off the box's own position.
   *
   * ⚑ **Measured on every scroll and after every {@link toNewest}**, because the end leaves the
   * view two ways: the reader scrolls up, or the content grows below a reader who is not followed —
   * and the second fires no `scroll` at all. ⚠️ `true` until the first measurement: a box nobody
   * has laid out (an SSR render) has not lost its end.
   */
  const endInView = ref(true)

  function measure(node: HTMLElement): boolean {
    endInView.value = node.scrollHeight - node.scrollTop - node.clientHeight <= thresholdPx
    return endInView.value
  }

  /** Bound to the panel's `scroll`: leaving the bottom releases the follow. */
  function onScroll(): void {
    const node = el.value
    if (!node) return
    stuck = measure(node)
  }

  /**
   * ⛔ **Stop following, on a gesture rather than on a scroll** (299 §2, from 297 finding 4b).
   *
   * ⚠️ **`stuck` had exactly one writer — a scroll event — and that is not the only way a reader
   * says they are not watching the end.** Pressing *Load earlier messages* is the plainest statement
   * there is, and it arrives without a scroll: the button lives INSIDE this container, so in a
   * conversation whose filtered content does not fill the viewport it is visible and clickable
   * without any scrolling ever having happened, and in a container that is not scrollable `stuck`
   * can never be released. The prepend then changed the signal, this watcher fired with
   * `stuck === true`, and `scrollTop = scrollHeight` **threw the reader to the newest line** — the
   * one gesture whose whole purpose is to go the other way, and its only visible effect was a
   * longer scrollbar.
   *
   * ⚑ **It also settles an ordering that nothing ordered.** `TranscriptView` hands the same element
   * to this composable and to `useOlderHistory`, and both write `node.scrollTop` after their own
   * `await nextTick()`. Released first, this watcher returns at `if (!stuck) return` and the anchor
   * is the only writer — so the two no longer race for the same property.
   */
  function release(): void {
    stuck = false
  }

  /**
   * ⛔ **The one place `scrollTop` is written, and the ONE place `stuck` is read** — both triggers
   * come through here.
   *
   * 🔴 **The watcher used to guard it as well, and that second read was a line no mutation could
   * kill** — found by verifying `504`'s own mutation rows: deleting the flag from here left the
   * watcher's copy standing, the arriving-line rule went on being enforced, and the row came back a
   * SURVIVOR. ⛔ *A line no mutation can make fail is not carrying its rule.*
   *
   * ⚑ **And one reader is the better code as well as the measurable one.** Asked AFTER the tick, a
   * {@link release} that lands while the DOM is being patched now wins; asked before it, the flag
   * was read once and the write went ahead regardless.
   */
  function toNewest(): void {
    const node = el.value
    if (!node) return
    // ⛔ **Never a write where the box is already at its end** (UI-011): a same-value write moves
    // nothing for the follow, but it cancels a press's smooth scroll in flight — the mount's pin and
    // the resize observer's first call both landed exactly there, and threw a reader who had pressed
    // their way to a brief or a question back to the newest line.
    if (stuck && node.scrollHeight - node.clientHeight - node.scrollTop >= 1)
      node.scrollTop = node.scrollHeight
    measure(node)
  }

  watch(signal, async () => {
    await nextTick() // after the new content is in the DOM
    toNewest()
  })

  // 🔴 **504 · the FIRST paint, for a panel whose content is already there.**
  //
  // ⛔ **`onMounted` and not `{ immediate: true }`:** an immediate watcher runs inside `setup`,
  // where the template ref this writes through is still null, so it would be a no-op that looked
  // like a fix. ⚑ It does not run under `renderToString`, which has no DOM to scroll.
  //
  // ⚠️ **Synchronous, unlike the watcher, and the difference is not cosmetic.** The watcher waits a
  // tick because its signal fires BEFORE the DOM is patched; by `mounted` every child is mounted and
  // the rows are laid out, so there is nothing to wait for — and waiting would put the write after
  // whatever the first frame does, which is how a reader who scrolls immediately gets yanked back.
  //
  // 🔴 **UI-006 · …and the first paint it could not make while HIDDEN.** A conversation selected
  // from the Graph tab mounts inside the main panel's `v-show`, where `scrollTop` and `scrollHeight`
  // are both 0 — so the mount's write was a no-op, and showing the tab changes no signal: the reader
  // landed on the first line (measured: 4 786px from the newest). ⚑ The panel's own box changing
  // size is when it can be pinned again — revealed, or a window or drawer resized — and it goes
  // through {@link toNewest}, so a reader who scrolled up is left where they are.
  let resized: ResizeObserver | null = null
  onMounted(() => {
    toNewest()
    if (el.value && typeof ResizeObserver !== 'undefined') {
      resized = new ResizeObserver(toNewest)
      resized.observe(el.value)
    }
  })
  onBeforeUnmount(() => resized?.disconnect())

  return { el, onScroll, release, endInView: readonly(endInView) }
}
