import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { aQueueReadEmpty } from './a-queue-read-empty'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { COMMAND_PERMISSION, homeConversation, queueOf } from './conversation-records'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * ⛔ **One screen, one truth** (305 §1, from `304`'s BROKEN row) — ⚑ **D-016 · Home is gone, and
 * the half of this file that was about it went too.**
 *
 * `304` used the app as a person, with `pnpm seed` loaded, and read a screen that disagreed with
 * itself: project cards and four decision rows beside a header saying *"Nothing needs you"*.
 * ⚑ **606** split that screen in two — the seeded Home and *Waiting on you* — and this file held
 * each to counting what it draws. ⛔ **D-016 deleted the demo seed, Home, its project cards and
 * its seeded decisions**, so every case that mounted `HomeSurface` or read the seed went with it.
 *
 * ⚑ **What stays is the screen that is left**: *Waiting on you* counts the live requests it draws,
 * and with nothing open it may still say so. ⚠️ **In the DOM project, and it has to be** — every
 * claim below is text read off a painted element (`brobot2-ssr-tests-pass-vacuously`).
 */

const NOW = 1_700_000_000_000

const conversation = (sessionId: string, at: number): unknown =>
  homeConversation(sessionId, COMMAND_PERMISSION, at)

const text = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

let view: Mounted | null = null
afterEach(() => {
  view = null
  usePersonsQueue().forget()
  unmountAll()
})

describe('Waiting on you counts what it draws', () => {
  it('⛔ a live request is counted and drawn, and the intro speaks of nothing else', async () => {
    aQueueReadEmpty(NOW)
    view = mount(
      WaitingOnYou,
      { needsYou: queueOf(conversation('sess_a', NOW - 63_000)), clock: NOW },
      { width: 1351, height: 1000 },
    )
    await nextTick()

    // ⛔ **468 · ONE item, and its list counts the live request it draws** — the number and the
    // rows are one population on one screen, which is `304`'s rule where it can still fail.
    expect(text(view.host.querySelector('[data-cy="waiting-pill-count-approvals"]'))).toBe('1')
    // The request is painted, and it is still answerable here.
    expect(view.host.querySelectorAll('[data-cy^="attention-request-"]')).toHaveLength(1)
    // ⚑ **The intro names what the one item is** — a permission — asserted whole so no clause
    // about another population can ride along in it.
    expect(text(view.host.querySelector('[data-cy="waiting-intro"]'))).toBe(
      '1 request needs your permission.',
    )
  })

  it('✅ a genuinely empty queue is still allowed to say so, ring and all', async () => {
    // ⚠️ **The paired positive for the whole file.** A fix that simply deleted "All clear" would
    // pass the count above and be a worse screen: the good state has to remain sayable, and it is
    // the ONLY state in which the whole-screen claim may appear.
    aQueueReadEmpty(NOW)
    view = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1351, height: 1000 })
    await nextTick()

    expect(text(view.host.querySelector('[data-cy="waiting-intro"]'))).toBe('Nothing needs you.')
    const clear = view.host.querySelector('[data-cy="waiting-list-none"]')
    expect(clear).not.toBeNull()
    expect(text(clear)).toBe('No questions for you.')
    // Before its first read the page claims nothing: grey cards, no words.
    unmountAll()
    usePersonsQueue().forget()
    view = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1351, height: 1000 })
    await nextTick()
    expect(view.host.querySelector('[data-cy="loading-cards"]')).not.toBeNull()
    expect(view.host.querySelector('[data-cy="waiting-intro"]')).toBeNull()
    expect(view.host.querySelector('[data-cy="waiting-list-none"]')).toBeNull()
  })
})
