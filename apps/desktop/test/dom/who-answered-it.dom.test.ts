import { afterEach, describe, expect, it } from 'vitest'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  type PermissionItem,
  type TranscriptItem,
  type UserInputItem,
} from '../../src/renderer/src/lib/transcript'
import type { ActedBy } from '../../src/shared/who-did-it'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { contrast, mount, paintedInk, parseColor, permission, unmountAll, visible } from './harness'

/**
 * 🔴 **503 · what a person reads on a settled request** — HO-037 §2, in a browser.
 *
 * ## ⛔ Why this file is a mount and not a source census
 *
 * ⚠️ **`who-answered-it.test.ts` measures the row, the fold, the words and the map.** None of that
 * can say the clause is on screen: an SSR assertion sees markup and not a rendered box, and this
 * project's own rule is that a renderer test which never mounts is measuring a string
 * (`brobot2-ssr-tests-pass-vacuously`). ⛔ **The one thing this file adds is that a person can
 * actually read it** — painted, sized, and with ink against the ground it sits on.
 *
 * ## ⚑ Every item here comes out of the real fold
 *
 * ⛔ **No hand-built `by` on an item.** The events go through `applyEvent`, so what the card is
 * handed is what the ledger would hand it; the THIRD population goes through `markReadOnly`, which
 * is the door that settles a card nobody answered.
 *
 * 🔴 **Three populations, and the whole point is that they draw three different things**: an actor,
 * `465`'s sentence, and nothing at all.
 */

afterEach(unmountAll)

const QUESTION: TranscriptEvent = {
  type: 'user_input_request',
  id: 'ui_1',
  prompt: 'AskUserQuestion',
  questions: [{ id: 'q0', prompt: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
} as never

const decision = (requestId: string, outcome: string, by?: ActedBy): TranscriptEvent =>
  ({ type: 'user_decision', requestId, outcome, ...(by === undefined ? {} : { by }) }) as never

/** Fold the events, and hand back the card the way `TranscriptView` receives it. */
function card<T extends TranscriptItem['kind']>(
  kind: T,
  events: TranscriptEvent[],
  readOnly?: string,
): Extract<TranscriptItem, { kind: T }> & { at: number } {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  if (readOnly !== undefined) markReadOnly(state, readOnly)
  const item = state.items.find((one) => one.kind === kind)
  expect(item, `the fold built no ${kind} card`).toBeDefined()
  return { ...(item as Extract<TranscriptItem, { kind: T }>), at: 1_000 }
}

const permissionCard = (by?: ActedBy, outcome = 'allow'): PermissionItem & { at: number } =>
  card('permission', [permission('req_1'), decision('req_1', outcome, by)])

const questionCard = (by?: ActedBy, outcome = 'answered'): UserInputItem & { at: number } =>
  card('userInput', [QUESTION, decision('ui_1', outcome, by)])

describe('§1 · the permission card — always a person, and it says so', () => {
  it('⛔ a decision a person took names the KIND, painted and readable', () => {
    const m = mount(PermissionCard, { item: permissionCard({ who: 'a-person' }) }, { width: 900 })
    const said = m.q('permission-answered-by')
    expect(said.textContent?.trim()).toBe('by a person')
    expect(visible(said), 'the clause is in the DOM but not on screen').toBe(true)
    const ink = paintedInk(said, parseColor(getComputedStyle(said).color)!)
    expect(contrast(ink.fg, ink.bg)).toBeGreaterThan(3)
    // ⚑ **On the SETTLED line, which is the whole of an answered card until you open it** — a
    // clause only reachable behind the disclosure would be a fact a reader has to go looking for.
    expect(m.q('permission-answered').contains(said)).toBe(true)
  })

  it('🔴 a refusal is attributed exactly as an approval is', () => {
    // ⚠️ **`cancel` is the outcome that also stops the turn**, and `whoCancelledIt` reads the same
    // field for it — so this is the cell where the card and the Stop reading describe one row.
    const m = mount(
      PermissionCard,
      { item: permissionCard({ who: 'a-person' }, 'cancel') },
      { width: 900 },
    )
    expect(m.q('permission-verdict').textContent?.trim()).toBe('Cancelled')
    expect(m.q('permission-answered-by').textContent?.trim()).toBe('by a person')
  })

  it('⛔ a row written before `477` draws `465`’s sentence, and never a blank', () => {
    const m = mount(PermissionCard, { item: permissionCard(undefined) }, { width: 900 })
    const said = m.q('permission-answered-by')
    expect(said.textContent?.trim()).toBe('Nothing in the ledger records who answered it')
    expect(visible(said)).toBe(true)
  })

  it('🔴 a card a TEARDOWN settled draws NOTHING about an actor — the third population', () => {
    // ⛔ **Neither arm is true of it.** Nobody answered it, so there is no actor to name; and the
    // ledger is not silent about an answer that was taken, so `465`'s sentence would be this app
    // saying something false about its own history.
    const item = card(
      'permission',
      [permission('req_1')],
      'settled when this conversation was last open',
    )
    const m = mount(PermissionCard, { item }, { width: 900 })
    expect(m.q('permission-verdict').textContent?.trim()).toBe('Not answered')
    expect(m.all('permission-answered-by')).toHaveLength(0)
    // ⚑ **The control, in the same cell**: the card is settled and the note IS drawn, so the
    // absence above is the clause's own and not a card that rendered nothing.
    expect(m.q('permission-note').textContent).toContain('settled when this conversation')
  })

  it('⚠️ a card still waiting has no settled line at all, so nothing can be said about its answer', () => {
    const item = card('permission', [permission('req_1')])
    const m = mount(PermissionCard, { item }, { width: 900 })
    expect(m.all('permission-answered')).toHaveLength(0)
    expect(m.all('permission-answered-by')).toHaveLength(0)
  })
})

describe('§2 · the question card — where the actor genuinely varies', () => {
  it('🔴 a PARENT AGENT’s answer says `an agent`, and the conversation id is nowhere on the card', () => {
    // ⛔ **`413 §4`**: *"the id is printed HERE and nowhere a person reads"*. The Events tab draws
    // `sess_the_parent`; this surface draws the kind. ⚑ This is the PO's own distinction — *the
    // project manager handled it* — made visible on the surface the escalation lands on.
    const item = questionCard({ who: 'an-agent', agent: 'sess_the_parent' })
    const m = mount(UserInputCard, { item }, { width: 900 })
    const said = m.q('user-input-answered-by')
    expect(said.textContent?.trim()).toBe('by an agent')
    expect(visible(said)).toBe(true)
    expect(m.host.textContent ?? '').not.toContain('sess_the_parent')
  })

  it('⛔ …and a PERSON’s answer to the same card says `a person` — the two readings diverge here', () => {
    // ⚠️ **A comparison tested where both sides agree measures nothing.** A permission can only
    // ever have a person behind it; this card is the one whose word moves, so the pair is asserted
    // on one card kind with one outcome and only the answerer changed.
    const m = mount(UserInputCard, { item: questionCard({ who: 'a-person' }) }, { width: 900 })
    expect(m.q('user-input-answered-by').textContent?.trim()).toBe('by a person')
  })

  it('⚑ a REJECTED question is attributed too, beside its own verdict word', () => {
    const item = questionCard({ who: 'a-person' }, 'rejected')
    const m = mount(UserInputCard, { item }, { width: 900 })
    expect(m.q('user-input-verdict').textContent?.trim()).toBe('Rejected')
    expect(m.q('user-input-answered-by').textContent?.trim()).toBe('by a person')
  })

  it('⛔ an old row draws the sentence, and a teardown draws nothing', () => {
    const old = mount(UserInputCard, { item: questionCard(undefined) }, { width: 900 })
    expect(old.q('user-input-answered-by').textContent?.trim()).toBe(
      'Nothing in the ledger records who answered it',
    )

    const item = card('userInput', [QUESTION], 'settled when this conversation was last open')
    const torn = mount(UserInputCard, { item }, { width: 900 })
    expect(torn.q('user-input-verdict').textContent?.trim()).toBe('Not answered')
    expect(torn.all('user-input-answered-by')).toHaveLength(0)
    // ⚑ The control: the card IS settled, so the absence is the clause's own.
    expect(torn.q('user-input-answered').textContent).toContain('settled when this conversation')
  })
})

describe('§3 · the line still fits when the sentence is the long one', () => {
  it('⛔ the settled line does not push its own card sideways at a narrow width', () => {
    // 🔴 **The absent arm is 45 characters and `white-space: nowrap`**, which is the one thing on
    // this line that could have made a settled card scroll horizontally. ⚠️ **Measured, not
    // reasoned about**: `.what` is the cell that gives way, and whether it gives way ENOUGH is a
    // question only a laid-out box can answer.
    const item = permissionCard(undefined)
    item.request = {
      ...item.request,
      detail: `git log --oneline --graph --decorate --all ${'x'.repeat(400)}`,
    }
    const m = mount(PermissionCard, { item }, { width: 420 })
    const line = m.q('permission-answered')
    const said = m.q('permission-answered-by')
    expect(line.scrollWidth, 'the settled line overflows the card').toBeLessThanOrEqual(
      line.clientWidth,
    )
    // ⚑ …and the clause itself is whole rather than clipped, which is why it is the cell that does
    // NOT give way: an actor truncated to `by a pe…` is a fact half-stated.
    expect(said.scrollWidth).toBeLessThanOrEqual(said.clientWidth)
    // ⛔ **The control**: the thing that DID give way is the one the card says gives way.
    const what = m.q('permission-what')
    expect(what.scrollWidth).toBeGreaterThan(what.clientWidth)
  })
})
