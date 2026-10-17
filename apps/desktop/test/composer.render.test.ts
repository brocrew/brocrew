import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PromptComposer, {
  canSend,
  interruptKeyLabel,
  isSendShortcut,
  sendIntentFor,
  sendKeyLabel,
} from '../src/renderer/src/components/PromptComposer.vue'
import { createAttachmentBook } from '../src/renderer/src/lib/drafts'
import type { HandedPath } from '../src/shared/runtime-ipc'
import { shouldRestoreDraft } from '../src/renderer/src/components/NewConversation.vue'
import { firstMessageBelongsTo } from '../src/renderer/src/components/RuntimeScreen.vue'

/**
 * The multi-line composer (Slice 2 · 015). The contract under test: Enter is a NEWLINE, sending
 * is deliberate — the button or ⌘/Ctrl-Enter — and none of the non-idle states regressed. The
 * keydown decision is a pure exported function because these tests run in node with no DOM to
 * type into; the live smoke types into the real one.
 */

/**
 * ⛔ **`attachments` became a draft TRANSACTION at 292 §2**, so an SSR render that wants something
 * staged says so by seeding a book. ⚑ Translated here rather than at every call site: the eight
 * assertions below are about what the composer DRAWS for a staged file, and none of them is about
 * how the caller keeps it.
 */
const render = (props: Record<string, unknown>): Promise<string> => {
  const staged = props['attachments'] as HandedPath[] | undefined
  const rest = { ...props }
  delete rest['attachments']
  const book = createAttachmentBook()
  if (staged !== undefined) book.write('session:alpha', staged)
  return renderToString(
    createSSRApp({
      render: () => h(PromptComposer as never, { ...rest, handing: book.handing('session:alpha') }),
    }),
  )
}

/**
 * The opening `<button …>` tag for a `data-cy`, so its attributes can be inspected without
 * depending on the order SSR emits them in.
 *
 * Asserts the tag EXISTS before returning it: an empty string would make an absent button read as
 * one with no attributes, so `not.toContain('disabled')` would pass over a control that was never
 * rendered at all.
 */
function buttonTag(html: string, cy: string): string {
  const tag = html.match(new RegExp(`<button[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(tag, `no <button data-cy="${cy}"> was rendered`).not.toBe('')
  return tag
}

describe('the send shortcut decision', () => {
  const plain = { metaKey: false, ctrlKey: false, isComposing: false }

  it('plain Enter is NOT a send — it is how a message gets its second line', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter' })).toBe(false)
  })

  it('Enter with ⌘ or Ctrl held is a send', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter', metaKey: true })).toBe(true)
    expect(isSendShortcut({ ...plain, key: 'Enter', ctrlKey: true })).toBe(true)
  })

  it('the modifier alone, or on any other key, is not', () => {
    expect(isSendShortcut({ ...plain, key: 'a', metaKey: true })).toBe(false)
    expect(isSendShortcut({ ...plain, key: 'Meta', metaKey: true })).toBe(false)
  })

  it('an Enter that commits an IME composition never sends, modifier or not', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter', metaKey: true, isComposing: true })).toBe(false)
    expect(isSendShortcut({ ...plain, key: 'Enter', ctrlKey: true, isComposing: true })).toBe(false)
  })
})

describe('the send guard both paths run through', () => {
  it('whitespace-only text — spaces, tabs, bare newlines — never sends', () => {
    expect(canSend('', 'idle')).toBe(false)
    expect(canSend('   ', 'idle')).toBe(false)
    expect(canSend(' \n\t\n ', 'idle')).toBe(false)
  })

  it('real text sends from idle AND mid-turn (077) — never frozen', () => {
    expect(canSend('hello', 'idle')).toBe(true)
    // ⚠️ **This line read `false` until 077 and is the ticket in one assertion.** Sending mid-turn
    // is the whole feature; what it MEANS mid-turn is `sendIntentFor`'s job, not this guard's.
    expect(canSend('hello', 'busy')).toBe(true)
    // Still refused, for a reason 077 did not touch: a card wants a specific answer that a
    // message would not give (063). ⚑ D-017b · there is no `ended` state any more: every
    // conversation takes a message, and sending continues it.
    expect(canSend('hello', 'frozen')).toBe(false)
  })

  it('⛔ a caller’s own blocker refuses both paths, whatever the state says (169 §1)', () => {
    // The launcher knows something no state can: that the profile name typed above the box is not a
    // name a folder can have, so there is nowhere for the launch to run. Before this it let the
    // press happen and declined it afterwards — 106's *"no control that cannot act"*, and the exact
    // shape 103 removed from this component once already.
    expect(canSend('hello', 'idle', 'that profile name cannot be used')).toBe(false)
    expect(canSend('hello', 'busy', 'that profile name cannot be used')).toBe(false)
    // …and it is a REFUSAL, never a permission: it cannot make a state that already says no say yes.
    expect(canSend('hello', 'frozen', null)).toBe(false)
    // The pairing, and the default: every existing caller passes nothing and nothing changes.
    expect(canSend('hello', 'idle', null)).toBe(true)
    expect(canSend('hello', 'idle')).toBe(true)
    // ⚠️ An empty string is a sentence nobody wrote, and it still BLOCKS — `null` is the only word
    // for "nothing is wrong". Fail closed: a caller that computed a reason and lost it refuses the
    // send rather than launching under a blocker it could not name.
    expect(canSend('hello', 'idle', '')).toBe(false)
  })
})

describe('what a send MEANS depends on the state and the chord (077)', () => {
  it('idle sends now, whatever the modifier — there is no turn to interrupt or wait behind', () => {
    expect(sendIntentFor('idle', false)).toBe('now')
    expect(sendIntentFor('idle', true)).toBe('now')
  })

  it('mid-turn, the plain chord QUEUES and Shift interrupts — the safe one is the reflex', () => {
    expect(sendIntentFor('busy', false)).toBe('queue')
    expect(sendIntentFor('busy', true)).toBe('interrupt')
  })

  it('frozen never produces a destructive intent, since it never sends at all', () => {
    // `canSend` refuses it, so this is unreachable — pinned anyway, because "unreachable" is a
    // property of the CALLER, and a future caller that forgot the guard should not silently get
    // "interrupt the running turn" out of a state that has no running turn.
    expect(sendIntentFor('frozen', true)).toBe('now')
  })
})

describe('the hint names the modifier this platform has', () => {
  it('⌘ on a Mac, Ctrl everywhere else', () => {
    expect(sendKeyLabel('MacIntel')).toBe('⌘↵')
    expect(sendKeyLabel('Win32')).toBe('Ctrl↵')
    expect(sendKeyLabel('Linux x86_64')).toBe('Ctrl↵')
    // The SSR/no-navigator fallback is the non-Mac wording, not a crash.
    expect(sendKeyLabel('')).toBe('Ctrl↵')
  })

  it('and the interrupting chord adds Shift, on both platforms (077)', () => {
    // Held to the same bar as its neighbour, which is why this exists: the chord reaches the user
    // through the hint AND the button tooltip, and the render tests assert the surrounding sentence
    // rather than the symbol — so a typo in either the modifier or the platform test would ship.
    expect(interruptKeyLabel('MacIntel')).toBe('⇧⌘↵')
    expect(interruptKeyLabel('Win32')).toBe('Shift+Ctrl↵')
    expect(interruptKeyLabel('')).toBe('Shift+Ctrl↵')
    // The two must never collide: they sit side by side in the hint and mean opposite things — one
    // keeps the running turn, the other destroys it.
    expect(interruptKeyLabel('MacIntel')).not.toBe(sendKeyLabel('MacIntel'))
    expect(interruptKeyLabel('Win32')).not.toBe(sendKeyLabel('Win32'))
  })
})

describe('a failed launch hands the message back (015), to the slot it came from (019)', () => {
  const attempt = {
    busy: false,
    wasBusy: true,
    error: 'no such directory',
    lastTried: 'the paragraphs I typed',
    current: '',
  }

  it('restores when a launch attempt ENDS having failed with something to give back', () => {
    expect(shouldRestoreDraft(attempt)).toBe(true)
  })

  it('does not restore while the launch is still running', () => {
    expect(shouldRestoreDraft({ ...attempt, busy: true })).toBe(false)
  })

  it('does not restore a launch that SUCCEEDED — the text became the first message', () => {
    expect(shouldRestoreDraft({ ...attempt, error: null })).toBe(false)
  })

  it('does not fire on the rising edge, or with nothing to restore', () => {
    expect(shouldRestoreDraft({ ...attempt, wasBusy: false })).toBe(false)
    expect(shouldRestoreDraft({ ...attempt, lastTried: '' })).toBe(false)
  })

  it('never overwrites what is being typed now — the launch flag is shared with REOPENING', () => {
    // A failed reopen also ends a "launch", and this surface is still mounted through one. Handing
    // back an older message over live typing would be the same class of bug 019 exists to kill.
    expect(shouldRestoreDraft({ ...attempt, current: 'something I am typing' })).toBe(false)
  })
})

/**
 * # …and so does a CANCELLED one (102, found by review)
 *
 * `shouldRestoreDraft` above keys on there being an error, because until 102 that was the only way
 * to tell "the launch ended without opening anything" from "it opened". A cancel is an ending with
 * no error on it — so the message was typed, sent, cleared from the composer, and then wiped from
 * `lastTried` by the very watcher that declined to hand it back. Nothing anywhere still held it.
 */
describe('a cancelled launch hands the message back too (102)', () => {
  // ⚠️ **These were `shouldReturnFirstMessage`'s until 221 §2 retired it into
  // {@link firstMessageBelongsTo}.** It had no production caller left once both endings of a launch
  // were decided in one place, and an exported predicate nothing calls is a rule nobody enforces —
  // 217 §9 (c)'s dead prop, one layer up. The claims are unchanged.
  const goesBack = (opened: string | null, launchError: string | null): boolean =>
    firstMessageBelongsTo({ opened, launchError, sendError: null }) === 'launcher'

  it('gives it back when nothing opened and nothing failed', () => {
    expect(goesBack(null, null)).toBe(true)
  })

  it('leaves it to the launcher when the launch FAILED — one hand-back, not two', () => {
    // `shouldRestoreDraft` owns this ending and has since 015; doing it here as well would write
    // the same text twice, and the second write is the one that could land over newer typing.
    expect(goesBack(null, 'no such directory')).toBe(false)
  })

  it('never gives it back when a conversation DID open — it became the first message', () => {
    // The paired positive for the negative above, and the one that matters: handing it back here
    // would leave the words in the launcher AND in the conversation that has just said them.
    expect(goesBack('sess_1', null)).toBe(false)
    expect(goesBack('sess_1', 'a later failure')).toBe(false)
  })
})

/**
 * # ⛔ Both endings of one launch, and the row a failed first send leaves (221 §2)
 *
 * `220`'s report ends *"raw schema language plus an empty rail row"*. §2 asks what should happen to
 * a launch whose opening message never reached the provider, and the answer written on
 * {@link firstMessageBelongsTo} is: **the conversation is kept, and the words go back into it.**
 *
 * ⛔ **Closing it cannot remove the row.** `store.create` writes the ledger row before a first
 * message exists, and `close()` moves the record to `ended` and KEEPS it, for the reopen list — so
 * the trade is a live empty conversation you can act on for a dead one you cannot, which the
 * library then holds for good. What actually removes this state for an ordinary person is §1,
 * upstream of it.
 *
 * ⚠️ **Pinned as branches of one function, because it used to be two `if`s at two points of an
 * `async` continuation** — a shape nothing can mount and nothing was checking.
 */
describe('a launch that opened and could not speak keeps its conversation (221 §2)', () => {
  it('🔴 sends the words back to the CONVERSATION when the first message was refused', () => {
    expect(
      firstMessageBelongsTo({
        opened: 'sess_1',
        launchError: null,
        sendError: 'that message has no words and nothing attached, so there is nothing to send',
      }),
    ).toBe('conversation')
  })

  it('⚑ …and nowhere at all when it got out — the words are in the transcript now', () => {
    // ⛔ The paired negative, and it is the one that would double the message: restoring here would
    // put the first message back in a composer belonging to a conversation that has just said it.
    expect(firstMessageBelongsTo({ opened: 'sess_1', launchError: null, sendError: null })).toBe(
      'nowhere',
    )
  })

  it('⛔ the launcher only gets them back when NOTHING opened, and nothing else reported it', () => {
    // 102's ending — cancelled, so no error — and 015's, where `shouldRestoreDraft` owns the
    // hand-back and a second one could land over newer typing.
    expect(firstMessageBelongsTo({ opened: null, launchError: null, sendError: null })).toBe(
      'launcher',
    )
    expect(
      firstMessageBelongsTo({ opened: null, launchError: 'no such directory', sendError: null }),
    ).toBe('nowhere')
  })

  it('⛔ …and a launch that opened is NEVER sent back to the launcher, whatever went wrong', () => {
    // ⚠️ The one combination that would be 211 §1's defect from the other end: words returned to a
    // page whose provider, profile and folder this very launch has already emptied.
    for (const sendError of [null, 'that file has been moved or deleted since']) {
      expect(firstMessageBelongsTo({ opened: 'sess_1', launchError: null, sendError })).not.toBe(
        'launcher',
      )
    }
  })
})

describe('the field shows the conversation’s draft, and owns none of its own (019)', () => {
  it('renders the draft it is handed', async () => {
    const html = await render({ state: 'idle', draft: 'what A was saying' })
    expect(html).toContain('what A was saying')
  })

  it('a different draft renders a different field — the value is the prop, nothing else', async () => {
    // Compared against each OTHER, not against a string that was never passed: asserting the
    // absence of text nobody supplied would pass against any implementation at all.
    const a = await render({ state: 'idle', draft: 'what A was saying' })
    const b = await render({ state: 'idle', draft: 'what B was saying' })
    expect(a).toContain('what A was saying')
    expect(b).toContain('what B was saying')
    expect(b).not.toContain('what A was saying')
  })

  it('no draft means an empty field, never the last one', async () => {
    const html = await render({ state: 'idle' })
    expect(html).toMatch(/<textarea[^>]*>\s*<\/textarea>/)
  })
})

describe('the composer renders as a multi-line field', () => {
  it('idle: a textarea (newlines can exist), the send button, and the new hint', async () => {
    const html = await render({ state: 'idle' })
    expect(html).toContain('<textarea')
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).toContain('data-cy="send-prompt"')
    // The old contract's copy must be GONE — a hint that still says Enter sends is a lie now.
    expect(html).not.toContain('Enter</strong> sends')
    expect(html).toContain('to send')
    expect(html).toContain('for a new line')
  })

  it('busy with an EMPTY box: typing is allowed (077) and the only button is the stop', async () => {
    const html = await render({ state: 'busy', who: 'Codex' })
    // ⚠️ **The field is no longer disabled, and that is the premise of the whole dispatch.** It read
    // `toMatch(/<textarea[^>]* disabled/)` before 077.
    expect(html).not.toMatch(/<textarea[^>]* disabled/)
    // Paired positive (086): proving the attribute is absent proves nothing unless the element is
    // there at all — this test would otherwise pass against a composer that rendered no textarea.
    expect(html).toContain('data-cy="prompt-input"')
    // Nothing typed, so there is nothing to send and neither send control exists yet.
    expect(html).toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('data-cy="send-prompt"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    // And the placeholder invites the typing the field now accepts, instead of describing a lock.
    expect(html).toContain('type to queue a message')
  })

  it('busy WITH a draft: both outcomes are buttons, so neither hides behind a chord (077)', async () => {
    const html = await render({ state: 'busy', who: 'Codex', draft: 'do this next' })
    expect(html).toContain('data-cy="queue-prompt"')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    // The stop button steps aside: with text in the box, "interrupt and send" is the interrupting
    // gesture, and two controls that both stop the turn would be the duplication 076 forbade.
    expect(html).not.toContain('data-cy="interrupt-session"')
    // The hint names both, and which chord is which.
    expect(html).toContain('to send after Codex finishes')
    // ⚑ **Re-aimed at `739`** (rule 26): it pinned *"to interrupt and send now"*; `739` Draw 5 says
    // the interrupting chord as an ask — `737` F-7: *"Interrupt-and-send still claims a stop"* — and
    // `739`'s review round 1 put the host's limit in the same clause (`739` #2, #25).
    expect(html).toContain(
      'is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds',
    )
  })

  /**
   * # ⛔ Busy, a file staged, and NOTHING typed (234 §2, from `227` M4 / `228` M1)
   *
   * ⚠️ **This is the case the render census jumped over.** The two tests above cover busy-empty and
   * busy-with-text; nobody had asked what busy-with-an-ATTACHMENT does, and the selector required
   * `text.trim() !== ''` — so the app offered neither Queue nor Interrupt-and-send and fell through
   * to the plain stop. ⌘↵ sent it perfectly well, which is exactly why it went unseen: the feature
   * worked, and only for people who knew the chord.
   */
  it('🔴 busy with an ATTACHMENT and no words: both outcomes are still offered (234 §2)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      attachments: [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }],
    })
    expect(html).toContain('data-cy="queue-prompt"')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    // …and the stop steps aside exactly as it does for text, because the message is a message.
    expect(html).not.toContain('data-cy="interrupt-session"')
    // The hint agrees with the buttons — 223's tooltip defect was a second reading of one rule.
    expect(html).toContain('to send after Codex finishes')
  })

  /**
   * ⚑ **The paired negative, and without it the test above is satisfied by a composer that always
   * offers the pair.** Busy, no words, and nothing staged is still the plain stop.
   */
  it('⚑ …and with neither words nor an attachment, busy is still only the stop (234 §2)', async () => {
    const html = await render({ state: 'busy', who: 'Codex', attachments: [] })
    expect(html).toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
  })

  /**
   * ⛔ **`blocked` still outranks it** (219 §1, which 223 §6 forbids weakening). The new predicate
   * is `canSendNow`, which already refuses when a reason is in hand — so a staged file must NOT
   * bring the pair back on a conversation the pane has blocked.
   */
  it('⛔ …and a blocked conversation gets neither, attachment or not (219 §1 kept)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      blocked: 'This conversation is closing — nothing more can be sent to it.',
      attachments: [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }],
    })
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    expect(html).toContain('nothing more can be sent to it')
  })

  it('busy with a draft and one already waiting: queueing is OFFERED, behind it (077, D-010)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      draft: 'a second one',
      hasQueued: true,
    })
    // ⚑ **D-010** — this was refused ON the control until several messages could wait; now the
    // control queues this one behind what already waits, and says so.
    //
    // ⚠️ The tag is EXTRACTED before being inspected, because SSR emits attributes in TEMPLATE
    // order — so a regex that expects one attribute before another fails against a perfectly
    // correct component. Same trap 076 hit on a `<select>`.
    //
    // ⚑ **D-027 moved what it says**: what waits no longer goes first, one turn each — this one
    // goes WITH it, in one turn, oldest first, and only a command goes alone. So the title says
    // *"…then send this with what is already waiting — a command goes alone"*, where it said
    // *"…finish and take what is already waiting, then send this"*.
    expect(buttonTag(html, 'queue-prompt')).not.toContain('disabled')
    expect(buttonTag(html, 'queue-prompt')).toContain(
      'with what is already waiting — a command goes alone',
    )
    expect(buttonTag(html, 'queue-prompt')).not.toContain('take what is already waiting')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    expect(html).not.toContain('A message is already waiting')
  })

  it('frozen: disabled, and the hint still says why a message will not help', async () => {
    const html = await render({ state: 'frozen' })
    expect(html).toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('A message won&#39;t answer it')
  })
})

/**
 * 094 · P2 — a turn frozen on a card was the one turn you could not walk away from.
 *
 * Every stop affordance in the app was gated on `busy`, and `ConversationPane` returns `frozen` the
 * moment a permission or a question is waiting. So the state where the turn is guaranteed not to
 * end on its own was the one state with no way to end it: answer the card, or close the whole
 * conversation. 093 measured it — pressing stop with a card open threw
 * `no [data-cy=interrupt-session]`.
 */
describe('a frozen turn can be abandoned without answering it (094)', () => {
  it('offers the stop button, and says so in the hint', async () => {
    const html = await render({ state: 'frozen' })
    expect(html).toContain('data-cy="interrupt-session"')
    // ⚑ **737 · `730` F-3 — in R43's words**: it said *"Esc stops the turn"* and *"Stop the turn
    // instead of answering"*, and a press only ASKS (`A_STOP_ASKS_THE_TURN`).
    expect(html).toContain('Esc</strong> is Stop: the turn is asked to stop')
    // The title is the one place the button explains the choice it is offering.
    expect(html).toContain('Stop instead of answering — the turn is asked to stop (Esc)')
    // ⚠️ The old words as they RENDERED — the component's own comments quote them, and SSR keeps comments.
    expect(html).not.toContain('Esc</strong> stops the turn')
  })

  it('⚠️ and 034 is untouched — a message still cannot be the answer', async () => {
    // **The rule that must not regress, asserted rather than assumed.** 034 is about a MESSAGE
    // looking like an answer; removing the stop button was never what enforced it. So: the field
    // stays disabled, the send controls stay absent, and `canSend` still refuses. If this test ever
    // goes green with a typable frozen composer, the fix above went too far.
    const html = await render({ state: 'frozen', draft: 'let me just say something' })
    expect(html).toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('data-cy="prompt-input"') // paired positive (086)
    expect(html).not.toContain('data-cy="send-prompt"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    expect(canSend('let me just say something', 'frozen')).toBe(false)
    expect(html).toContain('A message won&#39;t answer it')
    // ⚠️ Paired positive, and it is the one combination nothing else covers (review): frozen WITH
    // text falls past the busy-and-typed branch, so what it lands on has to be asserted here or
    // the three absences above are the whole test.
    expect(html).toContain('data-cy="interrupt-session"')
  })

  it('a composer told it is not interruptible offers no way to interrupt', async () => {
    // ⚠️ **The prose here used to say "the launcher", and 102 moved the launcher off this path** —
    // it passes `interruptible` now, because a launch really can be stopped. What is pinned is the
    // PROP's contract, which did not change and is still the thing that must not get a version of
    // itself: a caller that says no must get no stop button, in every state including `frozen`.
    const html = await render({ state: 'frozen', interruptible: false })
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('Esc</strong> is Stop')
    expect(html).toContain('A message won&#39;t answer it')
  })

  it('a launch is stoppable under its OWN name, never the turn one (102, re-homed by 103)', async () => {
    // ⚠️ **The `data-cy` is the load-bearing half.** A quarter of the live smoke waits on
    // `interrupt-session` to mean *"a turn is running"*, and `startSession` returns while the app is
    // still on the launcher — so a launcher rendering that name while busy would satisfy those
    // waits on a surface with no turn on it. The paired positive is what makes the absence mean
    // something: the button IS there, under its own name.
    //
    // ⚠️ **The claim is 102's, unchanged; what moved is where the answer comes from.** 102 asked
    // for it with a `stop: { cy, title }` descriptor on top of `state: 'busy'`. 103 made the
    // difference a STATE, so the name is no longer something a caller can pass in — which is
    // strictly stronger, because there is now no way for a caller to get `interrupt-session` onto a
    // surface that has no turn.
    const html = await render({ state: 'starting' })
    expect(html).toContain('data-cy="cancel-launch"')
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(buttonTag(html, 'cancel-launch')).toContain('Stop opening this conversation')
  })

  it('…and a launch cannot be sent to, which is what makes it not a turn (103)', async () => {
    // The pair for the test above, and the boundary between the two busy-ish states. `busy` means a
    // turn is running and a message QUEUES behind it (077); `starting` means the conversation does
    // not exist yet, and a second send would start a second one — 102's review measured that, and
    // the launch it started took the name the first was cancellable by.
    const html = await render({ state: 'starting', draft: 'the second thought', who: 'BroBot' })
    expect(canSend('the second thought', 'starting')).toBe(false)
    // Disabled rather than absent: the button is where the eye is, and one that vanished mid-launch
    // would read as a broken composer rather than as "not yet".
    expect(buttonTag(html, 'send-prompt')).toContain('disabled')
    // ⚠️ **And the box locks too, which the 103 review turned around.** It was open at first — "the
    // next thought is worth keeping" — until two verifiers traced what a second thought costs: the
    // box still holds a message that is IN FLIGHT, so on a failed launch the hand-back is skipped
    // (it will not overwrite live typing, 019) and the sent message is dropped, and on a cancelled
    // one the sent message is written back over the live typing. Locking is `frozen`'s reason, not
    // 077's: there is nothing to type into yet.
    expect(html).toMatch(/<textarea[^>]* disabled/)
    // Paired positives, so the negatives above are about the STATE and not an empty render.
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).toContain('BroBot is starting this conversation…')
    expect(html).toContain('data-cy="cancel-launch"')
    // …and the same box in the state that IS a turn stays open and accepts a send (077).
    expect(canSend('the second thought', 'busy')).toBe(true)
    const busy = await render({ state: 'busy', draft: 'the second thought', who: 'BroBot' })
    expect(busy).not.toMatch(/<textarea[^>]* disabled/)
  })
})
