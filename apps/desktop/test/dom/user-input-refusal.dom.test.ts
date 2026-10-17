import { afterEach, describe, expect, it } from 'vitest'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import { sessionPanel } from '../../src/renderer/src/lib/session-panel'
import {
  markAnswerRefused,
  markRequestFailed,
  type UserInputItem,
} from '../../src/renderer/src/lib/transcript'
import { contrast, mount, paintedInk, parseColor, record, unmountAll, visible } from './harness'

/**
 * **146 §1 · a card the provider is still waiting on, with no way left to answer it.**
 *
 * ⛔ **This refutes 142's central claim.** 142 said `not-usable` *"puts the sentence on it"* and
 * leaves the card answerable. 145 measured that it does not: the adapters keep the request pending,
 * `RuntimeHost` says the card is *"STILL LIVE"*, and the renderer then sent every failed response
 * through `markRequestFailed` — which writes `note`, and **any note makes a card settled**. Answer
 * and Reject went, the waiting panel dropped it, the composer unfroze, and the provider went on
 * waiting with nothing on screen to answer it. Stop or close was the only ordinary recovery.
 *
 * ⚠️ **Reachable by an ordinary click**, which is why the whole chain is exercised here rather than
 * asserted from a hand-written refusal: a provider option label that is only whitespace is legal in
 * both pinned types, the card counts it chosen and complete, and the answer it becomes is the one
 * thing the adapter refuses.
 *
 * ⚑ **The three links, each with the real thing on both ends:** the CLICK produces a payload (the
 * card), that payload is unforwardable (`answerToForward`, the same function both adapters call),
 * and a refusal marked as still-open leaves every control alive (the transcript + the card). Which
 * mark the store chooses for which ack is the fourth link, and it is asserted in
 * `session-store.test.ts` — where the bridge is.
 */

afterEach(unmountAll)

/** The host's own sentence for a `not-usable` refusal, verbatim (`RuntimeHost.refusalOf`). */
const NOT_USABLE = 'that answer cannot be sent: every question needs one that says something'
/** …and for one that consumed the request. */
const NOT_PENDING = 'the agent is no longer waiting for an answer to this'

/**
 * A question whose FIRST option is a label of pure whitespace.
 *
 * ⛔ Legal in both pinned shapes: Claude's option is `{label: string, description: string}` and
 * Codex's `ToolRequestUserInputOption` the same, neither constraining the content. 086 is why it is
 * rendered as sent rather than tidied away — the card shows what the model wrote.
 *
 * ⚠️ **`multiSelect: true`, because that is the branch the click actually reaches.** `chosen()`
 * drops a whitespace-only STRING, so on a single-select question the chip never lights and Answer
 * never enables — nothing false is sent, but nothing happens either. The multi-select branch
 * returns the draft array unfiltered, so the blank label counts as chosen, `complete` goes true and
 * Answer goes live. That asymmetry is what makes this reachable rather than theoretical, and it is
 * the same shape `stranded-turn.test.ts` drives the host with.
 */
const WHITESPACE_LABEL: UserInputItem['request'] = {
  type: 'user_input_request',
  id: 'toolu_1',
  prompt: 'AskUserQuestion',
  questions: [
    {
      id: 'q0',
      prompt: 'Which one?',
      options: [{ label: '   ' }, { label: 'the real one' }],
      multiSelect: true,
    },
  ],
}

/** The card as the transcript holds it, with whatever a refusal has written on it. */
const item = (over: Partial<UserInputItem> = {}): UserInputItem & { at: number } => ({
  kind: 'userInput',
  id: 'ui_1',
  request: WHITESPACE_LABEL,
  answered: null,
  note: null,
  refused: null,
  at: 1_000,
  ...over,
})

describe('a not-usable refusal leaves the card answerable (146 §1)', () => {
  it('an ordinary click on a whitespace-only label produces an answer the adapter refuses', async () => {
    const seen: UserInputResponse[] = []
    const m = mount(
      UserInputCard,
      { item: item(), onRespond: (_id: string, r: UserInputResponse) => seen.push(r) },
      { width: 900 },
    )

    const blank = m.host.querySelector<HTMLButtonElement>(
      '[data-cy="user-input-choice-q0"][data-option="   "]',
    )
    expect(
      blank,
      'the blank label reached the card as a chip — otherwise nothing here is real',
    ).not.toBeNull()
    // ⛔ **"An ordinary click" is a claim about what a PERSON can do, and this is what proves it**
    // (150, 148 L4). The test called it ordinary and only ever asserted the node exists — so CSS
    // hiding exactly this option, or collapsing it to nothing, left every assertion below green
    // while nobody could perform the gesture the test is named after. The third false green of this
    // shape; 146 LOW 3 caught two and missed this one.
    expect(visible(blank!), 'the blank chip is on screen, not merely in the DOM').toBe(true)
    expect(blank!.getBoundingClientRect().width, 'and it is big enough to click').toBeGreaterThan(0)
    blank!.click()
    await Promise.resolve()

    // ⛔ The card believes this is a complete answer, which is exactly the trap: Answer goes LIVE.
    const send = m.q('user-input-answer') as HTMLButtonElement
    expect(send.disabled, 'the card counts a whitespace label as chosen').toBe(false)
    send.click()

    // ⛔ **Sent untrimmed and unfiltered** (146 §5.1). The card used to trim every value it sent —
    // while `answerToForward`'s contract says typed text is never trimmed, so a path or a secret
    // with meaningful surrounding space was altered on one entry path and not the other. It now
    // sends what was chosen and lets the one rule decide what that means.
    expect(seen).toHaveLength(1)
    const answers = seen[0]!.kind === 'answer' ? seen[0]!.answers : {}
    expect(answers).toEqual({ q0: ['   '] })

    // ⚑ **`{q0: ['   ']}` is the seam, and it is spelled out on both sides of it.**
    // `session-store.test.ts`'s *"a whitespace-only label…"* takes this exact value, runs it through
    // the real `answerToForward` — the same function both adapters call — and follows the refusal
    // back to this card. `answerToForward` is not imported HERE because this project is a real
    // browser: pulling the runtime in drags the provider SDKs into the test bundle, and the seam
    // costs one literal instead.
  })

  it('keeps Answer, Reject and the frozen composer — and says why', () => {
    const r = record([WHITESPACE_LABEL])
    markAnswerRefused(r.transcript, 'toolu_1', NOT_USABLE)
    const card = r.transcript.items.find((i) => i.kind === 'userInput')
    expect(card?.kind === 'userInput' && card.refused).toBe(NOT_USABLE)
    // ⛔ **`note` is untouched.** The two fields are opposites, and writing the sentence into `note`
    // is precisely the defect: it is what `isAwaitingAnswer` reads to mean settled.
    expect(card?.kind === 'userInput' && card.note).toBeNull()

    // ⛔ **The composer stays frozen**, computed the way `ConversationPane` computes it — the panel
    // is the projection, and `composerState` reads `panel.waiting > 0`.
    expect(sessionPanel(r.transcript).waiting).toBe(1)

    const m = mount(UserInputCard, { item: item({ refused: NOT_USABLE }) }, { width: 900 })
    // The two controls the defect removed, still there and still pressable.
    const answer = m.q('user-input-answer') as HTMLButtonElement
    const reject = m.q('user-input-reject') as HTMLButtonElement
    expect(visible(answer)).toBe(true)
    expect(visible(reject)).toBe(true)
    expect(reject.disabled).toBe(false)
    // Answer is off only because the draft is empty, which is 064's rule and not this refusal.
    expect(answer.disabled).toBe(true)
    // The card is not wearing the settled treatment either — the verdict still asks for an answer.
    expect(m.q('user-input-verdict').textContent?.trim()).toBe('Needs your answer')
    expect(m.all('user-input-answered')).toHaveLength(0)

    // And the sentence is legible where it happened, not merely present in the markup.
    const said = m.q('user-input-refused')
    expect(said.textContent?.trim()).toBe(NOT_USABLE)
    expect(visible(said)).toBe(true)
    const ink = paintedInk(said, parseColor(getComputedStyle(said).color)!)
    expect(contrast(ink.fg, ink.bg)).toBeGreaterThan(3)
  })

  it('…while a refusal that CONSUMED the request still settles it', () => {
    // ⚠️ **The paired positive, and the reason this fix is not "no refusal ever settles anything".**
    // `not-pending` and `not-offered` are about a request that has gone: leaving that card live
    // would be the same lie the other way up, offering buttons for a question nobody is waiting on.
    const r = record([WHITESPACE_LABEL])
    markRequestFailed(r.transcript, 'toolu_1', NOT_PENDING)
    const card = r.transcript.items.find((i) => i.kind === 'userInput')
    expect(card?.kind === 'userInput' && card.note).toBe(NOT_PENDING)
    expect(card?.kind === 'userInput' && card.refused).toBeNull()
    expect(sessionPanel(r.transcript).waiting).toBe(0)

    const m = mount(UserInputCard, { item: item({ note: NOT_PENDING }) }, { width: 900 })
    expect(m.all('user-input-answer')).toHaveLength(0)
    expect(m.all('user-input-reject')).toHaveLength(0)
    expect(m.all('user-input-refused')).toHaveLength(0)
    expect(m.q('user-input-verdict').textContent?.trim()).toBe('Not answered')
  })
})
