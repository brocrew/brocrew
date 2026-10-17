import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  GO_AHEAD_MESSAGE,
  GO_AHEAD_SENDER,
  GO_AHEAD_AUTHORSHIP,
} from '../../src/renderer/src/lib/plan-mode'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META, mount, paneProps, record, unmountAll, visible } from './harness'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'

/**
 * 🔴 **What the go-ahead button actually EMITS, and what the conversation shows afterwards**
 * (278 §3).
 *
 * ⛔ **This file exists because nothing measured the payload.** `plan-go-ahead.render.test.ts`
 * proves the button is drawn, disabled at the right moments, and worded honestly; every one of
 * those assertions is satisfied by a build whose click emits `endPlanMode()` with no message at all
 * — which is 276's shape A, measured against real Codex at **0/2** turns and **0/2** files. The one
 * fact that keeps plan mode working on that provider was the one fact no test read.
 *
 * ⚠️ **A DOM test rather than SSR, because the claim is about a CLICK.** SSR renders the markup and
 * never runs the handler, so the emitted payload is not reachable from there — which is exactly how
 * it went unmeasured.
 */

afterEach(unmountAll)

/** A planning conversation, with the one turn a plan follows and nothing else. */
function planning(events: TranscriptEvent[] = []): SessionRecord {
  const r = record([])
  r.meta = { ...META, provider: 'codex', planNeedsGoAhead: true }
  r.transcript.items.length = 0
  applyEvent(r.transcript, { type: 'user_turn', text: 'plan a thing' }, 1_000)
  for (const event of events) applyEvent(r.transcript, event, 2_000)
  return r
}

describe('pressing the go-ahead (278 §3)', () => {
  it('🔴 hands the host the message — the half 276 measured at 0/2 without it', () => {
    const sent: unknown[][] = []
    const m = mount(
      ConversationPane,
      paneProps({ record: planning(), onEndPlanMode: (...args: unknown[]) => sent.push(args) }),
    )
    const button = m.q('plan-go-ahead-button') as HTMLButtonElement
    expect(visible(button), 'the button is on screen to be pressed').toBe(true)
    expect(button.disabled, 'an idle planning conversation can take the go-ahead').toBe(false)

    button.click()

    // ⛔ The whole argument of the feature, in one assertion: the command carries a message, and it
    // is the same string the bar promised. `setPlanMode(false)` alone records a phase for a turn
    // that never starts.
    expect(sent).toEqual([[GO_AHEAD_MESSAGE]])
  })

  it('…while Leave sends nothing, which is the difference between the two outcomes', () => {
    // The paired negative, and it is a real behaviour rather than a control: one gesture, two
    // outcomes (076/085). Without this the assertion above would be satisfied by a build that
    // attached a message to BOTH buttons — putting words in the mouth of somebody walking away
    // from a plan, which is the defect 085 was written to end.
    const sent: unknown[][] = []
    const m = mount(
      ConversationPane,
      paneProps({ record: planning(), onEndPlanMode: (...args: unknown[]) => sent.push(args) }),
    )
    ;(m.q('plan-leave-button') as HTMLButtonElement).click()
    expect(sent).toEqual([[]])
  })

  it('⚑ and what lands in the conversation is signed by BroBot, not by the person', () => {
    // The other end of the same gesture (278 §1). Both halves in one file on purpose: the message
    // must still go, AND it must stop being attributed to somebody who never wrote it — a build
    // that fixed either one alone is a build this dispatch would not accept.
    const m = mount(
      ConversationPane,
      paneProps({
        record: planning([
          { type: 'user_turn', text: GO_AHEAD_MESSAGE, attribution: 'app_authored' },
        ]),
      }),
    )
    const entry = m.q('continuation')
    expect(visible(entry)).toBe(true)
    expect(m.q('continuation-sender').textContent).toBe(GO_AHEAD_SENDER)
    expect(m.q('continuation-message').textContent).toBe(GO_AHEAD_MESSAGE)
    expect(m.q('continuation-why').textContent).toBe(GO_AHEAD_AUTHORSHIP)
    // ⛔ The bubble is drawn on this very page — for the prompt the person really typed — and NOT
    // for the sentence they did not. The negative means something only because the positive is
    // beside it on the same render.
    const bubbles = m.all('user-message')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.textContent).toBe('plan a thing')
    // ⚠️ And the words BroBot wrote are not inside the person's message — `214`'s defect, from the
    // other end: `user-message`'s text stays exactly what they typed.
    expect(bubbles[0]?.textContent).not.toContain(GO_AHEAD_MESSAGE)
  })
})
