import { afterEach, describe, expect, it } from 'vitest'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { mount, unmountAll } from './harness'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * **102 · the way out of a launcher that is still launching.**
 *
 * 100 named the door it left open: *"a slot wedged in `starting` has no in-app release… the missing
 * affordance is a Cancel on the launcher"*. The mechanism is 102's and the placement is 101's, so
 * nothing new is drawn here — the composer's own stop button, which this surface passed
 * `interruptible: false` to switch OFF, on the stated grounds that *"a stop button that did nothing
 * would be the one control on this surface that lies"*. It does something now.
 *
 * ⚠️ **In the DOM project rather than beside the SSR launcher tests, because a press is the point.**
 * An SSR test can see that a button exists; it cannot click it, and "the control is wired to the
 * thing it names" is the whole claim — the same reason `frozen-interrupt.dom.test.ts` is here.
 */

afterEach(unmountAll)

/** The launcher's required props, minus whatever a test is varying. */
const launcher = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  busy: false,
  error: null,
  debug: false,
  draft: '',
  defaultProvider: 'claude',
  // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
  // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
  // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
  // bindings, so a silently-absent one is a silently-absent control.
  models: null,
  choices: NO_LAUNCH_CHOICES,
  // Empty rather than the real map: this project runs in a browser, and `@brobot2/runtime` reaches
  // `node:fs` on import. The launcher's own tests cover what the declarations put on screen; this
  // file is about a control that does not depend on them, and "before the declarations arrive" is
  // a state the surface already has to render (`provider-capabilities.render.test.ts`).
  capabilities: {},
  // ⚑ **`models` went at `417` and came BACK at `435`** (HO-025 §5) — it is the prop two lines up,
  // and `null` is *nobody has answered*. ⚠️ **Nothing in this file was ever about it**: the cancel,
  // the send gate and the hint are all the composer's, and neither dispatch moved the composer.

  // ⛔ **The launcher's draft transaction** (292 §2) — required since the staged paths and the
  // operations that produce them became one object. A fresh book: each mount is its own app run.
  handing: createAttachmentBook().handing(NEW_CONVERSATION),
  ...over,
})

function surface(over: Record<string, unknown> = {}): {
  m: ReturnType<typeof mount>
  cancels: () => number
} {
  const seen: string[] = []
  const m = mount(NewConversation, launcher({ onCancel: () => seen.push('c'), ...over }))
  return { m, cancels: () => seen.length }
}

const esc = (): void =>
  void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('a conversation that is still opening can be walked away from (102)', () => {
  it('offers a stop while it is launching, and pressing it asks to cancel', () => {
    const { m, cancels } = surface({ busy: true })

    m.q('cancel-launch').click()

    expect(cancels()).toBe(1)
  })

  it('claims no keyboard route, because it has none', () => {
    // ⚠️ **A boundary, written down rather than discovered.** A conversation's stop button says
    // "(Esc)" and means it — `ConversationPane` binds the key. The launcher has no such binding, so
    // its title names no key: the affordance is 101's to design, and a control that advertised a
    // shortcut nobody wired would be the same lie `interruptible: false` was here to prevent.
    const { m, cancels } = surface({ busy: true })

    expect(m.q('cancel-launch').title).not.toContain('Esc')
    esc()
    expect(cancels()).toBe(0)
    // Paired positive: the button is right there, and clicking it works — the absence above is
    // about the KEY, not about a control that failed to render.
    m.q('cancel-launch').click()
    expect(cancels()).toBe(1)
  })

  it('does not promise a key it has not bound', () => {
    // ⚠️ **Found by review.** The composer's busy hint reads *"type to queue a message, or press Esc
    // to interrupt the turn"* — both halves about a TURN, and previously unreachable here because
    // this surface passed `interruptible: false`. Turning it on lit a sentence naming a key nobody
    // wired, on a surface with nothing to queue behind.
    const { m } = surface({ busy: true })

    expect(m.q('composer-hint').textContent).not.toContain('Esc')
    // Paired positive: the hint is not blank, it is the honest one.
    expect(m.q('composer-hint').textContent).toContain('starting this conversation')
  })

  it('will not start a second conversation while the first is still opening', () => {
    // ⚠️ **Found by review.** `canSend` allows a send while `busy` — 077's rule for a CONVERSATION,
    // where the second send queues behind the running turn. There is no turn here: a second press
    // starts a SECOND conversation, and its launch takes the name the first was cancellable by, so
    // the first becomes unstoppable.
    //
    // ⚠️ **The claim held; the mechanism under it got simpler in 103, so this reads the property
    // rather than the machinery.** 102 refused in `startWith`, one layer ABOVE the composer — so
    // the box cleared itself on send and the words had to be handed back, and what this asserted
    // was the hand-back (`drafted` containing the text). 103 gave the launcher its own composer
    // state, and `canSend` refuses `starting` in the predicate both send paths run through, so the
    // words never leave the box at all. That is the same promise kept more cheaply: **nothing was
    // started, and nothing was taken from the composer to be given back.** Asserting the hand-back
    // now would be asserting a round trip that no longer needs to happen.
    const started: string[] = []
    const drafted: string[] = []
    const m = mount(
      NewConversation,
      launcher({
        busy: true,
        draft: 'a second thought',
        onStart: (_input: unknown, text: string) => started.push(text),
        'onUpdate:draft': (text: string) => drafted.push(text),
      }),
    )

    m.q('prompt-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))

    expect(started).toEqual([])
    // Never cleared, so never needing to be restored — and the words are still on screen.
    expect(drafted).toEqual([])
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('a second thought')
  })

  it('…and does start one when nothing is opening, which is the pair for that', () => {
    const started: string[] = []
    const m = mount(
      NewConversation,
      launcher({
        draft: 'the first thought',
        onStart: (_i: unknown, t: string) => started.push(t),
      }),
    )

    m.q('prompt-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))

    expect(started).toEqual(['the first thought'])
  })

  it('offers nothing to stop when nothing is launching', () => {
    // The boundary, and the rule this surface was built on: a control that did nothing would be the
    // one thing here that lies. Paired with a positive, because an absence says nothing about what
    // the idle launcher DOES offer.
    const { m } = surface()

    expect(m.all('cancel-launch')).toHaveLength(0)
    expect(m.q('send-prompt'), 'positive: the idle launcher really did render').toBeTruthy()
  })

  it('does NOT answer to the name a running turn answers to', () => {
    // ⚠️ **The name is the load-bearing part.** A quarter of `ui-live-smoke.mjs` waits on
    // `interrupt-session` to mean "a turn is running", and its `startSession` returns while the app
    // is still on the launcher — so a launcher that rendered that name while busy would satisfy
    // those waits on a surface with no turn on it, and the step would type into the wrong box.
    const { m } = surface({ busy: true })

    expect(m.all('interrupt-session')).toHaveLength(0)
    // Paired positive, so the absence is about the NAME rather than about an absent button.
    expect(m.q('cancel-launch').title).toContain('Stop opening this conversation')
  })
})
