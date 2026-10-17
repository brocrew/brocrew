import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue } from '../../src/renderer/src/lib/attention'
import { mount, paneProps, permission, record, unmountAll } from './harness'

/**
 * # ⛔ Open, on the overview, lands on the CARD (236 §2, from `231` #5)
 *
 * `205`'s subject was *"everything that needs you in one place"*, and its row emits the whole
 * request — `sessionId`, `requestId`, and the `itemId` whose own comment says *"the transcript item,
 * so opening the conversation can scroll to the card itself"*.
 *
 * ⛔ **`RuntimeScreen.openRequest` used the session id alone.** Open the older of two pending
 * requests and you arrived at ordinary scroll position, in a conversation with two cards, with
 * nothing saying which one you had asked for.
 *
 * ⚠️ **Two halves were each waiting for the other.** `205` wrote `ConversationPane.focus(itemId)`
 * for exactly this and wired only the panel's Navigate to it; `<script setup>` exposes nothing by
 * default, so the screen could not have called it even had `openRequest` carried the id. Neither
 * half is a defect on its own, which is how both survived ten dispatches.
 *
 * ## What this file proves, and where the other half is
 *
 * ⚑ **Nothing in this repository mounts `RuntimeScreen`** (`211` §11, `212` §9, `214` §8), so the
 * screen's half is a source census — in `attention-answer.test.ts`, because this project runs in a
 * real browser and cannot read a file. The BEHAVIOUR — that the id the queue emits is one this pane
 * can act on, and that it marks the right card of two — is driven here against that engine.
 */

afterEach(unmountAll)

/** Two conversations' worth of cards in one pane, and the queue built from the same record. */
function twoWaiting(): {
  pane: ReturnType<typeof mount>
  ids: string[]
} {
  const waiting = record([
    permission('req_older'),
    permission('req_newer'),
    { type: 'status', state: 'waiting_permission' } as never,
  ])
  const queue = attentionQueue([waiting], () => 'waiting: permission')
  // ⛔ **The ids come from the QUEUE, not from the fold.** The whole finding is a value that
  // travels from that row to this pane, so a test that read the item ids off the transcript would
  // be asserting over a path the app does not take.
  expect(queue).toHaveLength(2)
  return {
    pane: mount(ConversationPane, paneProps({ record: waiting }), { width: 1200 }),
    ids: queue.map((request) => request.itemId),
  }
}

function flashed(pane: ReturnType<typeof mount>): string[] {
  return [...pane.host.querySelectorAll('.entry.flash')].map(
    (node) => node.getAttribute('data-item') ?? '',
  )
}

describe('236 §2 · the pane can be sent to one card', () => {
  it('🔴 marks the card that was asked for, and only that one', () => {
    const { pane, ids } = twoWaiting()
    // The paired negative: nothing is marked until something asks, or the assertion below would
    // hold over a pane that flashes everything.
    expect(flashed(pane)).toEqual([])

    const found = (pane.vm['focus'] as (itemId: string) => boolean)(ids[0]!)

    expect(found).toBe(true)
    expect(flashed(pane)).toEqual([ids[0]])
  })

  it('⛔ …and the OTHER one, which is the case a session-id-only Open could not tell apart', () => {
    const { pane, ids } = twoWaiting()

    ;(pane.vm['focus'] as (itemId: string) => boolean)(ids[1]!)

    expect(flashed(pane)).toEqual([ids[1]])
    expect(ids[0]).not.toBe(ids[1])
  })

  it('🔴 `focus` is EXPOSED, and answers false for a card this window does not hold', () => {
    // ⛔ The boolean is the reason the screen can say something instead of landing silently at an
    // arbitrary scroll position — which is the defect, and must not be the fallback either. The
    // queue walks `control.items`; the transcript renders `window.entries`, a PAGE of that fold, so
    // a card old enough to have left the window is a real miss rather than a hypothetical one.
    const { pane } = twoWaiting()

    expect(typeof pane.vm['focus']).toBe('function')
    expect((pane.vm['focus'] as (itemId: string) => boolean)('nothing_like_this')).toBe(false)
    expect(flashed(pane)).toEqual([])
  })
})
