import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { isAwaitingAnswer } from '../../src/renderer/src/lib/transcript'
import { META, mount, paneProps, record, permission, unmountAll, visible } from './harness'

/**
 * **147 · what the user is told when the machine sign-in moves, and what it does NOT cost them.**
 *
 * ⚑ **The acceptance criterion the PM said he cared most about is the last describe block.** An
 * automatic resume would have settled every open card — `markReopened` → `settlePending` — which is
 * 146 §1 arriving by a second road. The app does not resume; it draws a bar. So the card a user was
 * halfway through answering is still there, still awaiting, still answerable, with the bar above it.
 *
 * ⚠️ **The default `paneProps()` record is already a session with a card open** (one
 * `permission_request`, status `waiting_permission`), which is what makes that assertion cost
 * nothing to set up — and is why the bar has to be asserted separately on a session WITHOUT one, or
 * "it rendered" would never have been about the bar.
 *
 * ## 149 · what changed, and why
 *
 * A shared token renewed by another Claude client is indistinguishable here from a replaced
 * sign-in. The bar therefore describes renewal, states its cost, and waits while a turn or
 * card is live. Offering the button during that work would destroy it (148 M3), so “Nothing
 * here is lost” would be false.
 */

afterEach(unmountAll)

/** A session record whose liveness says the sign-in has been replaced (or has not). */
const withSignIn = (superseded: boolean, events = [permission('req_1')]) => {
  const r = record(events as never)
  r.meta = { ...META, liveness: { ...META.liveness, signInSuperseded: superseded } }
  return r
}

/** …and one with nothing live in it at all: no card, no running turn. The button's free case. */
const quiet = (superseded = true) =>
  withSignIn(superseded, [{ type: 'status', state: 'idle' } as never])

function pane(over: Record<string, unknown> = {}): {
  m: ReturnType<typeof mount>
  reopens: () => number
} {
  const seen: string[] = []
  const m = mount(ConversationPane, paneProps({ onReopenSignIn: () => seen.push('r'), ...over }), {
    width: 1200,
  })
  return { m, reopens: () => seen.length }
}

describe('the bar that says the sign-in moved', () => {
  it('is ABSENT while the sign-in is current — the paired negative', () => {
    const { m } = pane({ record: withSignIn(false) })
    expect(m.all('sign-in-superseded')).toHaveLength(0)
    expect(m.all('sign-in-reopen-button')).toHaveLength(0)
  })

  it('is absent when nothing has looked yet — an ABSENT field is not an unknown one', () => {
    // Every liveness message published before the session was described carries none of these
    // disclosures, and the frames before the host answers are the ones a flickering bar would ruin.
    const { m } = pane({ record: record([permission('req_1')] as never) })
    expect(m.all('sign-in-superseded')).toHaveLength(0)
  })

  it('says what happened, what it costs, and what to do — in that order, in one bar', () => {
    const { m } = pane({ record: quiet() })
    const bar = m.q('sign-in-superseded')
    expect(visible(bar)).toBe(true)
    const said = bar.textContent ?? ''
    // ⛔ **The ORDER, which this test claimed in its own name and did not check** (150, 148 L6).
    // Three independent `toContain`s pass for any permutation, so reordering the bar — putting the
    // remedy above what went wrong, or the cost before the cause — stayed green while the sentence
    // stopped making sense to read top to bottom. Indices, so the claim and the assertion agree.
    //
    // ⚠️ **The middle clause is the COST LINE, not a phrase from the note.** My first version of
    // this used "no more turns can go out on the old one", which lives in the same paragraph as the
    // first clause — so the two could never swap and the assertion was half a tautology. The
    // mutation table found it: reordering the bar left this green. Three clauses, three elements.
    const happened = said.indexOf('holding the Claude sign-in it started with')
    const costs = said.indexOf('Reopening keeps the transcript')
    const todo = said.indexOf('Reopen on the current sign-in')
    expect(happened, 'what happened').toBeGreaterThanOrEqual(0)
    expect(costs, 'what it costs').toBeGreaterThan(happened)
    expect(todo, 'what to do').toBeGreaterThan(costs)
    // ⛔ **It names no account, and that is deliberate.** The Keychain credential carries no
    // identity, so "you are now signed in as …" would be an invented fact (039). This pins that we
    // never start claiming one.
    expect(said).not.toMatch(/@|signed in as|account/i)
  })

  it('is true of a RENEWAL, which is what actually fired it in the field (149 §6)', () => {
    const { m } = pane({ record: quiet() })
    const said = m.q('sign-in-superseded').textContent ?? ''
    // ⛔ The one word that made this an accusation. A renewal and a switch are indistinguishable from
    // inside the app — the blob carries no identity — so a sentence that is true of only one of them
    // is a sentence that is wrong about half the time it appears.
    expect(said).not.toMatch(/replaced|somebody|someone else|switched account/i)
    // ⚑ True of a renewal and of a switch alike, on either provider: it changed.
    expect(said).toContain('that sign-in has changed since')
  })

  it('says what reopening costs, and does not promise that nothing is lost', () => {
    const { m } = pane({ record: quiet() })
    const cost = m.q('sign-in-cost').textContent ?? ''
    // ⛔ 148 M3 measured every one of these: a reopen keeps the transcript and the draft, and loses
    // this session's grants and the queued message's intent to send itself. 086: never claim more
    // than happened — which cuts both ways.
    // ⚑ **D-017 · R3 — re-aimed**: the queued message no longer loses its intent to send itself;
    // the teardown hands it on and it is sent once the conversation has reopened.
    expect(cost).toContain('keeps the transcript')
    expect(cost).toContain('“Allow for this conversation” approvals')
    expect(cost).toContain('is sent once it has reopened')
    expect(cost).not.toContain('send again')
    expect(m.q('sign-in-superseded').textContent).not.toContain('Nothing here is lost')
  })

  it('offers a control that ACTS: pressing Reopen asks for the reopen', () => {
    const { m, reopens } = pane({ record: quiet() })
    const button = m.q('sign-in-reopen-button')
    expect(visible(button)).toBe(true)
    expect((button as HTMLButtonElement).disabled).toBe(false)
    button.click()
    expect(reopens()).toBe(1)
  })

  it('is disabled while another command is in flight, so a double press cannot double-reopen', () => {
    const busy = quiet()
    busy.busy = true
    const { m, reopens } = pane({ record: busy })
    const button = m.q('sign-in-reopen-button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    expect(reopens()).toBe(0)
  })
})

describe('149 · the button cannot destroy live work — 148 M3', () => {
  it('waits while a question is open, and says that is what it is waiting for', () => {
    // The default record IS a session with a card open, which is exactly the state a supersession is
    // discovered in: it is found by a gesture — a queue, an interrupt — and those are the gestures a
    // user makes while something else is already running.
    const r = withSignIn(true)
    const card = r.transcript.items.find((item) => item.kind === 'permission')
    expect(card && isAwaitingAnswer(card)).toBe(true) // the positive half: there really is one open

    const { m, reopens } = pane({ record: r })
    const button = m.q('sign-in-reopen-button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    expect(reopens()).toBe(0)
    // ⛔ **And it says why.** 106: a control that cannot act must say what would let it. A button
    // that was simply dead here would read as the app having broken.
    // ⚠️ **`470` moved this sentence's DEIXIS and nothing else.** It opened *"Answer the question
    // ABOVE first"*, which is true of a bar bolted to one conversation and false of the second
    // surface that now offers the same gesture — a row in the grant sheet's list of open
    // conversations. ⚑ The sentence is {@link REOPENING_SAYS}.question now, and `It` is the
    // conversation named in the note directly above this line.
    expect(m.q('sign-in-cost').textContent).toContain('It has a question waiting')
    expect(m.q('sign-in-cost').textContent).toContain('reopening now would close it')
  })

  it('waits while a turn is running, and says so differently', () => {
    const { m, reopens } = pane({
      record: withSignIn(true, [{ type: 'status', state: 'working' } as never]),
    })
    const button = m.q('sign-in-reopen-button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    expect(reopens()).toBe(0)
    expect(m.q('sign-in-cost').textContent).toContain('still working')
  })

  it('…and an ENDED conversation holds nothing back, so the button is live', () => {
    // Nothing to interrupt and no card left unsettled: reopening is precisely what it is for, and
    // disabling it here would be the control that cannot act with no reason to give.
    const { m } = pane({
      record: withSignIn(true, [{ type: 'session', state: 'ended', ref: META.ref } as never]),
    })
    expect((m.q('sign-in-reopen-button') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('149 · the plan go-ahead is not live on a superseded sign-in — 148 H2', () => {
  /** A conversation waiting for a go-ahead, idle, with the sign-in either current or moved. */
  const planning = (superseded: boolean) => {
    const r = withSignIn(superseded, [{ type: 'status', state: 'idle' } as never])
    r.meta = { ...r.meta!, planNeedsGoAhead: true }
    return r
  }

  it('the button is disabled, and says what to do first', () => {
    const { m } = pane({ record: planning(true) })
    const button = m.q('plan-go-ahead-button') as HTMLButtonElement
    expect(visible(button)).toBe(true)
    expect(button.disabled).toBe(true)
    // ⛔ Not "wait for the current turn to finish" — nothing is running. A reason that is not the
    // real one is worse than none: the user would wait for something that is not going to happen.
    expect(button.title).toContain('the current sign-in first')
  })

  it('…and it is ENABLED when the sign-in is current — the paired negative', () => {
    // Without this, the assertion above would be satisfied by a button that is never enabled at all.
    const { m } = pane({ record: planning(false) })
    expect((m.q('plan-go-ahead-button') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('an open card survives the sign-in moving — 147 acceptance 7', () => {
  it('the card is still awaiting, and the composer is still frozen on it, with the bar above', () => {
    const r = withSignIn(true)
    // The positive half first: this record really does hold a card that is waiting. Without it the
    // assertions below would pass over a transcript with nothing in it (a vacuous green this suite
    // has been caught by before).
    const card = r.transcript.items.find((item) => item.kind === 'permission')
    expect(card).toBeDefined()
    expect(isAwaitingAnswer(card!)).toBe(true)

    const { m } = pane({ record: r })
    expect(visible(m.q('sign-in-superseded'))).toBe(true)
    // The card's own controls are untouched — nothing settled it, because nothing resumed.
    expect(m.all('permission-allow').length).toBeGreaterThan(0)
    expect(m.all('permission-deny').length).toBeGreaterThan(0)
    // …and the composer still says the card is what is holding the turn, not the sign-in.
    expect(m.q('composer-hint').textContent).toContain("A message won't answer it")
  })

  it('and a session with NO card open shows the bar with an ordinary composer under it', () => {
    // The other half of the pair: the bar is a property of the conversation, not of the card, so it
    // must render identically without one. If it needed a frozen composer to appear, the test above
    // would have proved nothing.
    const { m } = pane({ record: quiet() })
    expect(visible(m.q('sign-in-superseded'))).toBe(true)
    expect(m.all('permission-allow')).toHaveLength(0)
    expect(m.q('composer-hint').textContent).not.toContain("A message won't answer it")
  })
})
