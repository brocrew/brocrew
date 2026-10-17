import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { CLOSING_BLOCK, SIGN_IN_SUPERSEDED_BLOCK } from '../../src/renderer/src/lib/send-refusals'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import { META, mount, paneProps, permission, record, unmountAll, visible } from './harness'

/**
 * # ⛔ The one send path left un-gated (219 §1, from 217 §9)
 *
 * `ConversationPane` never passed `blocked`, so it defaulted to `null` and **Send was lit in every
 * state the composer believed was idle** — including the one the pane already knew made a send
 * impossible. `canGoAhead`, the pane's OTHER send control, has carried `!signInSuperseded` since
 * `149` with a comment reading *"This button SENDS, so everything true of the composer is true of
 * it"*. The composer was the exception, and it is the one with a prop built for the job.
 *
 * **What it cost:** another Claude client renews the shared token. Your next message is refused and
 * the amber bar appears. You read it, decide to finish the thought, type it — and Send is still lit
 * and full-accent. You press. Nothing goes out, the words come back, a red error appears. It repeats
 * for every press until you reopen.
 *
 * ## ⚑ The first press is not the bug, and this file says so out loud
 *
 * A supersession is *discovered* by a gesture: `checkSignIn` is a `security` subprocess run at the
 * turn boundary, so the fact does not exist until a send has already been refused once. The bar
 * cannot exist before the press that creates it. **The gap is the second press onward**, and the
 * sequence test below is written as exactly that — one press that goes, then the fact arriving, then
 * a press that cannot.
 *
 * ⚠️ **In the DOM project, because every claim here is about a rendered control and a click.** A
 * disabled attribute and a tooltip have no SSR shadow worth asserting, and `blocked`'s whole job is
 * to be READ by someone about to press something.
 *
 * ⚠️ **Nothing here touches a real sign-in.** The state is a `liveness.signInSuperseded` flag on a
 * fixture record — which is all the renderer ever sees of it.
 */

afterEach(unmountAll)

const TYPED = 'one more thing before I go'

/** A session record whose liveness says the machine sign-in has moved — or has not. */
function withSignIn(superseded: boolean | undefined, events: unknown[]): SessionRecord {
  const r = record(events as never)
  r.meta = {
    ...META,
    liveness: {
      ...META.liveness,
      // ⚠️ **Absent, not `false`, when nothing has looked yet** (150, 148 L3) — which is the state
      // every conversation is in before the first press, and therefore the state acceptance 3 is
      // about. `undefined` here reproduces it exactly rather than approximating it with `false`.
      ...(superseded === undefined ? {} : { signInSuperseded: superseded }),
    },
  }
  return r
}

const idle = (superseded?: boolean) => withSignIn(superseded, [{ type: 'status', state: 'idle' }])
const working = (superseded?: boolean) =>
  withSignIn(superseded, [{ type: 'status', state: 'working' }])
const frozen = (superseded?: boolean) =>
  withSignIn(superseded, [permission('req_1'), { type: 'status', state: 'waiting_permission' }])

/**
 * The pane, mounted under a parent that HOLDS the record in a ref.
 *
 * ⚑ **The ref is what acceptance 3 needs**, and a plain props object could not give it: the point of
 * that test is that the same mount behaves differently before and after the fact arrives, which is
 * what a person experiences. Two mounts would prove two components, not one transition.
 */
function open(initial: SessionRecord, draft = TYPED) {
  const held = ref(initial)
  const sent: unknown[][] = []
  // ⛔ **Captured since 234 §2** (found in review): this helper wired only `onSend`, so a test could
  // not observe an `interrupt` emit at all — and the Escape guard 234 adds had nothing pinning it.
  const interrupts: unknown[][] = []
  const Host = defineComponent({
    name: 'PaneHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: held.value, draft }),
          onSend: (...args: unknown[]) => sent.push(args),
          onInterrupt: (...args: unknown[]) => interrupts.push(args),
        })
    },
  })
  const view = mount(Host, {}, { width: 1200 })
  const move = async (next: SessionRecord): Promise<void> => {
    held.value = next
    await nextTick()
  }
  return { view, sent, interrupts, move }
}

const send = (view: ReturnType<typeof open>['view']) => view.q('send-prompt') as HTMLButtonElement
const hint = (view: ReturnType<typeof open>['view']) =>
  view.q('composer-hint').textContent?.replace(/\s+/g, ' ').trim() ?? ''

describe('219 · Send is dark on a superseded sign-in, and says why', () => {
  it('🔴 the button is disabled, and its tooltip is the reason rather than "Send"', () => {
    const { view, sent } = open(idle(true))
    const button = send(view)
    expect(visible(button), 'the control is not even on screen — this asserts nothing').toBe(true)
    expect(button.disabled, 'Send was offered over a send the host refuses').toBe(true)
    // ⛔ 118: a greyed button still says "this is the thing to do here, later"; there is no later
    // unless the reason travels with the refusal. The `title` is where the pointer already is.
    expect(button.title).toBe(SIGN_IN_SUPERSEDED_BLOCK)
    expect(hint(view)).toBe(SIGN_IN_SUPERSEDED_BLOCK)
    // …and the press really is inert now, rather than merely looking it.
    button.click()
    expect(sent).toEqual([])
  })

  it('🔴 the remedy it names is ON SCREEN — 106, one step further', () => {
    // A disabled control must say what would let it act; a sentence naming a control that is not
    // there would be the same defect wearing a remedy. `blocked` is only ever set while
    // `signInSuperseded` is true, which is the bar's own `v-if`, so this is structural — and pinned.
    const { view } = open(idle(true))
    expect(hint(view)).toMatch(/reopen/i)
    expect(visible(view.q('sign-in-superseded'))).toBe(true)
    const reopen = view.q('sign-in-reopen-button') as HTMLButtonElement
    expect(visible(reopen)).toBe(true)
    expect(reopen.disabled, 'nothing is live here, so the remedy must be pressable').toBe(false)
    // ⛔ **And it really is ABOVE, because the sentence says the word** (148 L6's lesson: this file
    // claimed an order in prose and checked three independent facts, any permutation of which
    // passed). "reopen it on the current one, above" is a positional claim about the layout, so it
    // is measured as one — the bar's box must end before the composer's begins.
    expect(hint(view)).toContain('above')
    const bar = view.q('sign-in-superseded').getBoundingClientRect()
    const foot = view.q('composer-hint').getBoundingClientRect()
    expect(bar.height, 'the bar has no box to be above anything').toBeGreaterThan(0)
    expect(
      bar.bottom,
      'the remedy is not above the sentence that points up at it',
    ).toBeLessThanOrEqual(foot.top)
  })

  it('⚑ …and an ordinary conversation still sends — the paired positive', () => {
    // ⛔ Without this, every assertion above is satisfied by a composer that never sends at all.
    const { view, sent } = open(idle(false))
    const button = send(view)
    expect(button.disabled).toBe(false)
    expect(button.title).not.toBe(SIGN_IN_SUPERSEDED_BLOCK)
    expect(hint(view)).not.toContain('reopen')
    expect(view.all('sign-in-superseded')).toHaveLength(0)
    button.click()
    expect(sent).toHaveLength(1)
    expect(sent[0]![0]).toBe(TYPED)
  })
})

describe('219 §2 · a conversation being CLOSED is the second one the pane knew about', () => {
  /** The state `sessionStore.close()` puts a record in before it awaits the host (089). */
  const closing = (): SessionRecord => {
    const r = idle(false)
    r.phase = 'closing'
    return r
  }

  it('🔴 Send is dark while a close is in flight, and says so in its own words', () => {
    // ⛔ Found by 219 §2's enumeration rather than by the ticket, and it is the SAME defect: the
    // header plate beside this composer has drawn the word "closing" from `record.phase` all along
    // (`agent-state.ts` → `sessionBeing`), and Send stayed lit next to it. A press reached
    // `assertAcceptsMessages` and came back "cannot send: session … is still closing".
    const { view, sent } = open(closing())
    const button = send(view)
    expect(button.disabled, 'Send was offered on a conversation on its way out').toBe(true)
    expect(button.title).toBe(CLOSING_BLOCK)
    expect(hint(view)).toBe(CLOSING_BLOCK)
    button.click()
    expect(sent).toEqual([])
  })

  it('⚑ …and an OPEN conversation with the same record is unaffected — the paired positive', () => {
    // The only difference between these two mounts is one word of `phase`. Without this, the
    // assertion above is satisfied by a composer that refuses everything.
    const { view, sent } = open(idle(false))
    expect(send(view).disabled).toBe(false)
    send(view).click()
    expect(sent).toHaveLength(1)
  })

  it('🔴 closing OUTRANKS the sign-in, because reopening cannot save this conversation', async () => {
    // ⚠️ Both facts at once, which is a real state: a supersession is discovered by a gesture, and
    // closing is a gesture. The sign-in sentence names a remedy — "reopen it on the current one" —
    // that is about carrying THIS conversation on, and this one is not going to carry on.
    const both = closing()
    both.meta = { ...both.meta!, liveness: { ...both.meta!.liveness, signInSuperseded: true } }
    const { view } = open(both)
    await nextTick()
    expect(hint(view)).toBe(CLOSING_BLOCK)
    expect(hint(view)).not.toBe(SIGN_IN_SUPERSEDED_BLOCK)
    // …and the bar is still drawn, because the standing condition is still true — this is about
    // which sentence the COMPOSER carries, not about hiding the other one.
    expect(visible(view.q('sign-in-superseded'))).toBe(true)
  })
})

/**
 * # ⛔ Closing a conversation with a card open (234 §2, from `228` M2)
 *
 * ⚠️ **`219` gated Send on `closing` and left the state check ABOVE it**, so `sendBlocked` returned
 * `null` for every state but `idle` and `busy` — and a conversation closed with a permission card
 * open kept the whole frozen apparatus: *"Answer the request above to continue"*, about a request
 * `close()` settles at teardown start, and a stop button for a turn the close is already ending.
 *
 * ⚑ **The precedence argument is the one that block already makes for the sign-in**: a conversation
 * on its way out cannot be repaired by the remedy the state names, so naming it first would name a
 * later that does not exist. ⚑ **D-017b** — `ended` was the one it did NOT outrank, and it is gone:
 * every conversation takes a message, so there is no *"reopen it under Closed conversations"* left
 * to survive the close.
 */
describe('234 §2 · closing outranks the frozen card as well', () => {
  const closingFrozen = (): SessionRecord => {
    const r = frozen(false)
    r.phase = 'closing'
    return r
  }

  it('🔴 the advice is the close, not "answer the request above"', () => {
    const { view } = open(closingFrozen())
    expect(hint(view), 'the composer still pointed at a card the close has settled').toBe(
      CLOSING_BLOCK,
    )
    expect(hint(view)).not.toMatch(/answer the request/i)
    // ⛔ **And the PAINT follows the sentence** (found in review). `tokens.css` reserves this amber
    // for "an in-flight run is frozen on YOU"; wearing it over a sentence that says the opposite is
    // the composer disagreeing with itself in two registers at once.
    expect(
      view.q('composer-hint').classList.contains('frozen'),
      'the closing sentence is painted in the frozen-on-you register',
    ).toBe(false)
    expect(view.q('composer-band').querySelector('form')?.classList.contains('frozen')).toBe(false)
  })

  it('⚑ …and the SAME record still frozen says the frozen thing — the paired positive', () => {
    // The only difference between these two mounts is one word of `phase`. Without this, the
    // assertion above is satisfied by a pane that has stopped saying anything about a card.
    const { view } = open(frozen(false))
    expect(hint(view)).toMatch(/answer the request/i)
    expect(hint(view)).not.toBe(CLOSING_BLOCK)
    // ⚑ …and it really does wear the amber here, or the assertion above passes over a composer
    // that has simply stopped using the class.
    expect(view.q('composer-hint').classList.contains('frozen')).toBe(true)
  })

  it('🔴 the stop affordance goes with it — a turn the close is already ending', () => {
    // ⛔ `interruptible` was a DEAD PROP from 102/103 — the launcher passed `false` until 102
    // flipped it and 103 removed it, and nothing replaced it, so two branches of `canInterrupt`
    // became unreachable. This is its first caller.
    const { view } = open(closingFrozen())
    expect(view.all('interrupt-session')).toHaveLength(0)
    // …and the paired positive on the same state: not closing, the stop is there.
    const open2 = open(frozen(false))
    expect(visible(open2.view.q('interrupt-session'))).toBe(true)
  })

  /**
   * ⛔ **The KEY, not only the button** (234 §2, found in review — the guard shipped with nothing
   * pinning it). Escape is the third stop affordance and `ConversationPane` owns it; 094 is the
   * dispatch about what happens when they are gated one at a time, and a key that still stopped the
   * turn while the button had gone would be that finding upside down.
   */
  it('🔴 Escape stops the turn on a frozen conversation, and does NOT on a closing one', () => {
    const still = open(frozen(false))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(still.interrupts, 'Escape stopped working on an ordinary frozen turn').toHaveLength(1)

    const going = open(closingFrozen())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    // ⚠️ The FIRST mount is still listening — `onKey` is a window listener — so the assertion is
    // that the closing one added nothing, not that the count is zero.
    expect(
      going.interrupts,
      'Escape stopped a turn the close is already ending — one affordance gated, the others not',
    ).toHaveLength(0)
  })
})

describe('219 · the FIRST press is still allowed (217’s nuance)', () => {
  it('🔴 one press goes out, the fact arrives, and the next press cannot — in one mount', async () => {
    // ⚑ This is the sequence a person actually lives through, and the reason 217 refused to call the
    // first press a defect: `checkSignIn` runs at the turn boundary, so before this press there is
    // nothing to know and nothing to be dark about. The record starts with the field ABSENT, which
    // is what every liveness message carries before anything has looked.
    const { view, sent, move } = open(idle(undefined))
    expect(view.all('sign-in-superseded'), 'the bar cannot exist before the gesture').toHaveLength(
      0,
    )
    expect(
      send(view).disabled,
      'the first press was taken away — that is the opposite defect',
    ).toBe(false)
    send(view).click()
    expect(sent, 'the first message did not go').toHaveLength(1)

    // …and now the refusal lands: the host publishes the liveness before it throws, precisely so the
    // bar carrying the remedy is on screen when the error arrives.
    await move(idle(true))
    expect(visible(view.q('sign-in-superseded'))).toBe(true)
    expect(send(view).disabled, 'the SECOND press is the one 219 removed').toBe(true)
    send(view).click()
    expect(sent, 'a press got through after the app knew it could not').toHaveLength(1)
  })
})

describe('219 · the message-carrying controls while a turn runs', () => {
  it('🔴 queue and interrupt-and-send are gone, and the plain stop is back', async () => {
    // ⛔ Both of those controls CARRY A MESSAGE, and the host refuses both on the same gate
    // (`assertCanTakeTurn(session, 'queue')`; twice for the interrupting one, before it kills
    // anything). Left rendered they were lit and pressing either did nothing at all.
    const { view } = open(working(true))
    await nextTick()
    expect(view.all('queue-prompt')).toHaveLength(0)
    expect(view.all('interrupt-send-prompt')).toHaveLength(0)
    // ⚑ …and 094's lesson is not re-broken: greying them would have left a running turn with no stop
    // button at all. The one gesture that still works — interrupting needs no credential — is back.
    const stop = view.q('interrupt-session') as HTMLButtonElement
    expect(visible(stop)).toBe(true)
    expect(stop.disabled).toBe(false)
    expect(hint(view)).toBe(SIGN_IN_SUPERSEDED_BLOCK)
  })

  it('⚑ …and with the sign-in current, both are there — the paired positive', async () => {
    const { view } = open(working(false))
    await nextTick()
    expect(visible(view.q('queue-prompt'))).toBe(true)
    expect(visible(view.q('interrupt-send-prompt'))).toBe(true)
    expect(hint(view)).not.toBe(SIGN_IN_SUPERSEDED_BLOCK)
  })
})

describe('219 · the reason is withheld where the STATE has the better sentence', () => {
  it('🔴 a card waiting to be answered keeps its own hint through a supersession', async () => {
    // ⛔ `blocked` outranks every state sentence in the foot, and answering a card is NOT a turn —
    // `assertCanTakeTurn` runs at the turn boundary and nowhere else, so the host does not refuse
    // it. Saying "no message can go out" here would replace a true, actionable sentence with one
    // about a gesture the user was not making. `sign-in-superseded.dom.test.ts` holds the same line
    // from 147's side; this is the half that is about the withholding being deliberate.
    const { view } = open(frozen(true))
    await nextTick()
    expect(hint(view)).toContain("A message won't answer it")
    expect(hint(view)).not.toBe(SIGN_IN_SUPERSEDED_BLOCK)
    // The bar is still there — the standing condition is still true, and its remedy still reachable.
    expect(visible(view.q('sign-in-superseded'))).toBe(true)
  })

  it('⚑ …and the same record DOES show it once the composer is idle — the pair', async () => {
    // Without this, the assertion above is satisfied by a `blocked` that is never set anywhere,
    // which is precisely the state 219 was dispatched to fix. ⚑ D-017b · the ended conversation's
    // own hint left with the `ended` state.
    const { view } = open(idle(true))
    await nextTick()
    expect(hint(view)).toBe(SIGN_IN_SUPERSEDED_BLOCK)
  })
})
