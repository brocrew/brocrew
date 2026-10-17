import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import type { HandedPath, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * # ⛔ Putting a queued message back returns the WORDS AND THE PATHS (292 §2)
 *
 * ## Why this file exists at all
 *
 * ⚠️ **The hop was untested, and 292 changed the line it lands on.** `attach-path.dom.test.ts`
 * drives `QueuedMessage`'s own button and asserts what it EMITS; nothing drove the emission through
 * `TranscriptView` and `ConversationPane` into the place a draft is actually kept. So the pane's
 * handler — which this dispatch rewrote from an `update:attachments` emit into a write on the
 * draft's transaction — had no test on either side of the change.
 *
 * ⚑ **It is the same argument `drafts.ts` makes about `restore()` and `liveDraftSlots`**: nothing in
 * this repository mounts `RuntimeScreen` (`211` §11, `212` §9, `214` §8), so a rule that can only be
 * reached from there is a rule nobody is checking. The pane CAN be mounted, so this is where the
 * hop is measured.
 */

const QUEUED: HandedPath = { path: '/work/checkout/notes.md', kind: 'file', outsideCwd: false }

/**
 * A message that was queued and then CANCELLED — the only state that offers a way back.
 *
 * ⚠️ **`waiting()` is what decides which control the card draws**: a message still waiting offers
 * *Cancel it*, and only one that has an outcome offers *Put it back in the composer*. A record
 * without the second event would render the wrong button and every assertion below would be about
 * an element that is not there.
 */
function queuedRecord(): ReturnType<typeof record> {
  return record([
    {
      type: 'message_queued',
      text: 'when you get a moment',
      attachments: [QUEUED],
    } as unknown as TranscriptEvent,
    { type: 'message_unqueued', reason: 'cancelled' } as unknown as TranscriptEvent,
  ])
}

afterEach(unmountAll)

describe('a queued message put back in the composer (292 §2)', () => {
  it('🔴 lands in THIS conversation’s draft — the words through the emit, the paths in the book', async () => {
    const book = createAttachmentBook()
    const key = draftKey('sess_1')
    const drafted: string[] = []
    const Host = defineComponent({
      name: 'QueuedPaneHost',
      setup() {
        return () =>
          h(ConversationPane as Component, {
            ...paneProps({
              record: queuedRecord(),
              handing: book.handing(key),
            }),
            'onUpdate:draft': (text: string) => drafted.push(text),
          })
      },
    })
    const view = mount(Host, {}, { width: 1100, height: 800 })
    await nextTick()

    // Non-vacuity: the message really is on screen, with its attachment strip.
    expect(view.q('queued-message').textContent).toContain('when you get a moment')
    expect(book.read(key), 'the draft was not empty to begin with').toEqual([])

    ;(view.q('restore-queued') as HTMLButtonElement).click()
    await nextTick()

    // ⛔ Both halves, because they were one message.
    expect(drafted).toEqual(['when you get a moment'])
    expect(
      book.read(key),
      'the words came back and the attachment was silently dropped — 216’s defect',
    ).toEqual([QUEUED])
  })

  it('⚑ …and into THIS draft’s slot, not into whichever one the screen is showing', async () => {
    // ⚠️ **The reason the pane writes through the handle rather than emitting upward.** An emit is
    // answered by `RuntimeScreen` reading `draftKeyForActive` at CALL time; the handle carries the
    // key it was bound to. Both are correct while the pane is the active one — which is the only
    // state this can be driven in — so what is asserted is the property that makes it true: the
    // paths land under the key this pane was HANDED, and nowhere else.
    const book = createAttachmentBook()
    const mine = draftKey('sess_1')
    const other = draftKey('sess_other')
    // ⚠️ A REAL list in the other slot, not an empty one: `write` forgets an empty list, so
    // `keys()` would have read `[mine]` either way and the negative below would prove nothing.
    const theirs: HandedPath = { path: '/elsewhere/theirs.md', kind: 'file', outsideCwd: true }
    book.write(other, [theirs])
    const Host = defineComponent({
      name: 'KeyedQueuedHost',
      setup() {
        return () =>
          h(ConversationPane as Component, {
            ...paneProps({ record: queuedRecord(), handing: book.handing(mine) }),
          })
      },
    })
    const view = mount(Host, {}, { width: 1100, height: 800 })
    await nextTick()

    ;(view.q('restore-queued') as HTMLButtonElement).click()
    await nextTick()

    expect(book.read(mine)).toEqual([QUEUED])
    expect(book.read(other), 'a restore reached a conversation it was not about').toEqual([theirs])
    expect(book.keys().sort()).toEqual([mine, other].sort())
  })

  /**
   * 🔴 **D-010 · it APPENDS** — several messages may wait now, so a person may put back one while
   * the composer already holds words (another put back, or the start of the next message). ⛔ It
   * set the draft to the returned words, which erased them.
   */
  it('🔴 D-010 · into a composer that already holds words and a file: both kept, the words after a blank line', async () => {
    const book = createAttachmentBook()
    const key = draftKey('sess_1')
    const already: HandedPath = { path: '/work/checkout/plan.md', kind: 'file', outsideCwd: false }
    book.write(key, [already])
    const drafted: string[] = []
    const Host = defineComponent({
      name: 'AppendingQueuedHost',
      setup() {
        return () =>
          h(ConversationPane as Component, {
            ...paneProps({
              record: queuedRecord(),
              handing: book.handing(key),
              draft: 'half a thought',
            }),
            'onUpdate:draft': (text: string) => drafted.push(text),
          })
      },
    })
    const view = mount(Host, {}, { width: 1100, height: 800 })
    await nextTick()

    ;(view.q('restore-queued') as HTMLButtonElement).click()
    await nextTick()

    expect(drafted).toEqual(['half a thought\n\nwhen you get a moment'])
    expect(book.read(key)).toEqual([already, QUEUED])
  })
})
