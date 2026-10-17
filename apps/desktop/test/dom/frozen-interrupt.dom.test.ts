import { afterEach, describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { mount, paneProps, permission, record, unmountAll } from './harness'

/**
 * **094 · P2 — a turn frozen on a card can be walked away from.**
 *
 * Every stop affordance in this app was gated on `composerState === 'busy'`, and the pane returns
 * `frozen` — not `busy` — the moment a card is waiting. So the one state where the turn is
 * guaranteed never to end by itself was the one state with no way to end it. The only exits were to
 * answer the card or to close the whole conversation. 093 measured it: pressing stop with a card
 * open threw `no [data-cy=interrupt-session]`.
 *
 * ⚠️ **In the DOM project rather than beside the SSR composer tests, because the third affordance is
 * a KEY.** `composer.render.test.ts` can see the button; it cannot press Escape, and the Escape
 * binding lives on `window` in this component — a different file from the button, which is precisely
 * how the two came to disagree in the first place. Asserting one and not the other would leave
 * exactly the gap 094 exists to close.
 *
 * `paneProps()`'s default record is already the frozen case: one permission request, status
 * `waiting_permission`.
 */

afterEach(unmountAll)

/**
 * The pane, plus a count of every `interrupt` it emitted — emits arrive as `onInterrupt` props.
 *
 * ⚠️ `interrupts` is a FUNCTION, not a getter. The first version returned a getter and every test
 * destructured the result, which evaluates it once at spread time and freezes it at zero — three
 * green-looking failures that had nothing to do with the component.
 */
function pane(over: Record<string, unknown> = {}): {
  m: ReturnType<typeof mount>
  interrupts: () => number
} {
  const seen: string[] = []
  const m = mount(ConversationPane, paneProps({ onInterrupt: () => seen.push('i'), ...over }), {
    width: 1200,
  })
  return { m, interrupts: () => seen.length }
}

const esc = (): void =>
  void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('a card is waiting on you, and you are allowed to stop the turn instead', () => {
  it('the stop button is there, and pressing it asks for the interrupt', () => {
    const { m, interrupts } = pane()
    // Positive first: this only means something if the pane really is frozen. A `busy` pane would
    // render the same button for the ordinary reason and this test would be about nothing.
    expect(m.q('composer-hint').textContent).toContain("A message won't answer it")
    m.q('interrupt-session').click()
    expect(interrupts()).toBe(1)
  })

  it('and so does Escape — the binding that was gated on `busy` alone', () => {
    const { m, interrupts } = pane()
    expect(m.q('prompt-input').hasAttribute('disabled'), 'positive: still frozen').toBe(true)
    esc()
    expect(interrupts()).toBe(1)
  })

  it('⚠️ 034 holds: the field is still locked and no send control exists', () => {
    // **The rule that must not regress.** 034 says a typed message must never become the answer to
    // a card — which is about the MESSAGE. Removing the stop button was never what enforced it, and
    // this asserts the enforcement is still where it always was.
    const { m } = pane({ draft: 'let me just say something instead' })
    expect(m.q('prompt-input').hasAttribute('disabled')).toBe(true)
    expect(m.all('send-prompt')).toHaveLength(0)
    expect(m.all('queue-prompt')).toHaveLength(0)
    expect(m.all('interrupt-send-prompt')).toHaveLength(0)
    // Paired positive (review): three absences say nothing about what IS offered instead.
    expect(m.q('interrupt-session')).toBeTruthy()
  })

  it('⚠️ 063 holds: the card is still on screen, still asking', () => {
    // The other rule. A stop button that removed the card would be a question the user cannot know
    // was asked — 063's failure in the other direction.
    const { m } = pane()
    expect(m.all('permission-card')).toHaveLength(1)
  })

  it('an idle conversation offers no stop, and Escape does nothing', () => {
    // The boundary. `frozen` joined `busy`; `idle` did not, and a stop button with no turn behind
    // it would be the one control on this surface that lies.
    const { m, interrupts } = pane({ record: record([{ type: 'status', state: 'idle' } as never]) })
    expect(m.all('interrupt-session')).toHaveLength(0)
    expect(m.q('send-prompt'), 'positive: the idle composer really did render').toBeTruthy()
    esc()
    expect(interrupts()).toBe(0)
  })

  it('⚠️ and the UNATTENDED case, which is the one 063 went out of its way to make reachable', () => {
    // An auto-approved session raises no permission card — but it can still raise a QUESTION, and
    // 063 made those reachable in launched-auto precisely so an unattended run cannot sit on one
    // invisibly. That session is frozen by the same `panel.waiting > 0`, so it must be stoppable by
    // the same button: the whole point of an unattended run is that nobody is watching it, which
    // makes "answer the card or close the conversation" the worst possible pair of only options.
    const asked: TranscriptEvent = {
      type: 'user_input_request',
      id: 'number:0',
      prompt: 'Which theme?',
      questions: [
        {
          id: 'ui_theme',
          prompt: 'Which theme?',
          options: [{ label: 'Midnight' }, { label: 'Daylight' }],
        },
      ],
    } as never
    const { m, interrupts } = pane({
      record: record([asked, { type: 'status', state: 'waiting_permission' } as never]),
    })
    expect(m.all('user-input-card'), 'positive: the question really is on screen').toHaveLength(1)
    expect(m.q('prompt-input').hasAttribute('disabled'), 'positive: frozen on a question').toBe(
      true,
    )
    m.q('interrupt-session').click()
    expect(interrupts()).toBe(1)
    esc()
    expect(interrupts()).toBe(2)
  })

  it('a SECOND card does not need a second press to become stoppable', () => {
    // Two pending requests is the ordinary shape of a frozen turn — `panel.waiting` counts them —
    // and the predicate is `> 0`, not `=== 1`. Pinned because a future reader may be tempted to
    // make the button depend on which card is on top.
    const events: TranscriptEvent[] = [
      permission('req_1'),
      permission('req_2'),
      { type: 'status', state: 'waiting_permission' } as never,
    ]
    const { m, interrupts } = pane({ record: record(events) })
    m.q('interrupt-session').click()
    expect(interrupts()).toBe(1)
  })
})
