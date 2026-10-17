import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index pulls in `node:fs` and the whole file
// fails to import in the browser project.
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import { nothingToSendYet, type HandedPath } from '../../src/shared/runtime-ipc'
import { CLOSING_BLOCK } from '../../src/renderer/src/lib/send-refusals'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * # ⛔ Lit, full-accent, and inert (223, from `221` §7's named gap)
 *
 * **Send was enabled whenever the box was empty and nothing was attached — the state the app spends
 * most of its life in.** `send-prompt`'s `:disabled` was `!canType || blocked !== null` and had
 * never asked about CONTENT. `221` pressed it in the running app and measured the whole of it:
 * **no conversation, no rail row, the wire never reached.** `106` in its worst form, on the
 * most-seen button in the product.
 *
 * ⚑ **`216` declined this and `221` was forbidden from folding it in**, both for the same reason:
 * nine `dom` assertions across `profile-picker.dom.test.ts` and `folder-gate.dom.test.ts` (⛔ both
 * deleted at `417` with the controls they drove) asserted
 * *"a good name/folder lights Send"* with an EMPTY prompt box — so each was testing its own gate AND
 * the absence of a content gate, in one assertion. `223` ruled: type a prompt in their setup, which
 * ISOLATES their variable rather than weakening them.
 *
 * ⚠️ **This is NOT `221` §6 reversed.** `221` forbade darkening Send for an ATTACHMENT-ONLY message
 * because that message has content, and darkening it there would have hidden a working feature
 * behind a dead control. `hasSomethingToSend` is the one predicate that tells the two states apart;
 * the third block below is what holds `221`'s ruling in place.
 *
 * ## ⚠️ The mounts HOLD the draft, and that is load-bearing
 *
 * `PromptComposer.text` is a computed over the `draft` PROP — typing emits `update:draft` and the
 * caller writes it back. A mount that passes a plain prop therefore cannot be typed into at all, so
 * every "type, then read the button" test here goes through a host that holds a `ref`. ⛔ **Found
 * the hard way**: the first version of this file set `.value` and dispatched `input`, and the button
 * never moved.
 *
 * ⚠️ **In the DOM project, and for ONE reason rather than three.** The first version of this line
 * said an SSR string has no `disabled` and no `title`; it has both — `composer.render.test.ts`
 * asserts on exactly those. ⛔ **What SSR cannot do is CHANGE**: there is no `input` event, no
 * re-render, and no click, so *"type a character and the button lights"* — the pairing that keeps
 * every negative here from being about a composer that refuses everything — is reachable only in a
 * real engine (`brobot2-ssr-tests-pass-vacuously`).
 */

afterEach(unmountAll)

const button = (m: Mounted): HTMLButtonElement => m.q('send-prompt') as HTMLButtonElement
const hint = (m: Mounted): string =>
  m.q('composer-hint').textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** Type the way a person does, so the component's own `v-model` handler runs. */
async function type(m: Mounted, value: string): Promise<void> {
  const box = m.q('prompt-input') as HTMLTextAreaElement
  box.value = value
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

/* ------------------------------------------------------------------ the two mounts */

/**
 * The launcher, under a host that keeps what is typed — see the note above.
 *
 * ⚑ **`models` came back at `435` and `profiles` did not.** `417` cut both (HO-022 §2: the front
 * door asked for neither a model nor an identity); HO-025 §5 put the model control back and left
 * the identity where `423` placed it. ⚠️ **The mount is otherwise unchanged and so is every
 * assertion below** — this file is about the composer and `hasSomethingToSend`, and neither
 * dispatch moved either. `handing` is passed because it is a REQUIRED
 * prop of the new API (292 §2); an empty book stages nothing, which is the state 223 is about.
 */
function openLauncher(draft = ''): Mounted {
  const words = ref(draft)
  // Outside the render function on purpose: a book minted per render is a new object every
  // keystroke, and this surface is typed into.
  const handing = createAttachmentBook().handing(NEW_CONVERSATION)
  const Host = defineComponent({
    name: 'LauncherHost',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          defaultProvider: 'claude',
          // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
          // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
          // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
          // bindings, so a silently-absent one is a silently-absent control.
          models: null,
          choices: NO_LAUNCH_CHOICES,
          capabilities: allProviderCapabilities(),
          handing,
          draft: words.value,
          'onUpdate:draft': (text: string) => (words.value = text),
        })
    },
  })
  return mount(Host, {}, { width: 1000, height: 900 })
}

/** An idle conversation — the resting state between turns, which is where this button lives. */
const idle = (): SessionRecord => record([{ type: 'status', state: 'idle' }] as never)

function openPane(over: Record<string, unknown> = {}, draft = ''): Mounted {
  const words = ref(draft)
  const Host = defineComponent({
    name: 'PaneHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: idle(), ...over }),
          draft: words.value,
          'onUpdate:draft': (text: string) => (words.value = text),
        })
    },
  })
  return mount(Host, {}, { width: 1200, height: 900 })
}

const MOUNTS = [
  { name: 'the launcher', open: () => openLauncher() },
  { name: 'the conversation composer', open: () => openPane() },
] as const

/* ------------------------------------------------------------------ §1 · dark, then lit */

describe('223 · Send is dark while there is nothing to send', () => {
  it.each(MOUNTS)('⛔ $name · an empty box leaves it DARK', async ({ open }) => {
    const m = open()
    await nextTick()

    expect(button(m).disabled, 'Send was lit over a box with nothing in it').toBe(true)
  })

  it.each(MOUNTS)('⚑ $name · …and ONE character lights it — the same mount', async ({ open }) => {
    // ⛔ **The pairing, and in one mount deliberately.** A composer that refused everything would
    // satisfy the test above; this is what makes it a statement about CONTENT. One character rather
    // than a sentence, because the rule is `trim() !== ''` and a boundary is where a rule goes wrong.
    const m = open()
    await nextTick()
    expect(button(m).disabled).toBe(true)

    await type(m, 'h')
    expect(button(m).disabled, 'a typed character did not light Send').toBe(false)

    // …and taking it away puts the button back, so the gate is not a one-way latch.
    await type(m, '')
    expect(button(m).disabled, 'the gate never closed again').toBe(true)
  })

  it.each(MOUNTS)('⚠️ $name · whitespace alone is not content', async ({ open }) => {
    // `hasSomethingToSend` trims, and `221` is why: the wire's `min(1)` counted CHARACTERS, so a
    // message of nothing but spaces crossed it and started a turn. The button holds the same line.
    const m = open()
    await nextTick()

    await type(m, '   \n  ')
    expect(button(m).disabled, 'spaces were treated as something to send').toBe(true)
  })
})

/* ------------------------------------------------------------------ 221 §6 still holds */

describe('223 · an ATTACHMENT is content, so 221 §6 is not reversed', () => {
  const STAGED: HandedPath = { path: '/tmp/notes.md', kind: 'file', outsideCwd: false }

  /** The composer alone — the layer the rule lives at, with the two inputs it actually reads. */
  const composer = (attachments: HandedPath[], draft: string): Mounted => {
    const book = createAttachmentBook()
    book.write('session:alpha', attachments)
    return mount(
      PromptComposer as Component,
      {
        state: 'idle',
        draft,
        handing: book.handing('session:alpha'),
        canAttach: true,
        cwd: '/tmp',
      },
      { width: 900, height: 400 },
    )
  }

  /**
   * ⛔ **THE pair that keeps 223 from undoing 221.** Both halves in one test, because the whole
   * finding is that these two states looked identical and are not.
   *
   * ⚑ **The end-to-end half already exists and is cited rather than duplicated**:
   * `attach-on-launcher.dom.test.ts`'s *"an attachment with NO words still starts a conversation"*
   * drives the same case through the real launcher and its real send, and it passes unchanged
   * across 223. A second copy here would be a second answer to one question.
   */
  it('⛔ no words and a staged file lights Send; no words and nothing does not', () => {
    expect(
      button(composer([STAGED], '')).disabled,
      '221 §6 reversed — a staged file was refused',
    ).toBe(false)
    expect(button(composer([], '')).disabled, 'the state 223 exists for').toBe(true)
  })
})

/* ------------------------------------------------------------------ §4 · the sentence */

describe('223 §4 · the dark button says why, on both mounts', () => {
  it.each(MOUNTS)('$name · names what would let it act (169, 118)', async ({ open }) => {
    const m = open()
    await nextTick()

    // ⛔ **169's placement: on the control the pointer is already on.** A grey button whose tooltip
    // still reads "Send" is `106` — it names the gesture and not the reason it cannot happen.
    expect(button(m).title).toBe(nothingToSendYet(true))
    expect(button(m).title).toMatch(/type a message/i)
    // ⚑ **118's test, satisfiable here for the first time in this family: there IS a later.** The
    // button names it, and the foot names the gesture that performs it.
    //
    // ⚠️ **`/to send/i` was the first version of this line and it was INERT** — the idle foot is the
    // unconditional `⌘↵ to send · Enter for a new line`, which contains those two words whatever the
    // button says. It would have passed with the whole feature deleted. The exact sentence is what
    // makes it a measurement, and the pairing below is what makes it about this state.
    expect(hint(m)).toMatch(/to send · .*for a new line/i)
    expect(hint(m), 'the foot is repeating the button rather than naming the gesture').not.toBe(
      button(m).title,
    )

    // …and it stops saying it the moment it stops being true.
    await type(m, 'hello')
    expect(button(m).title, 'the refusal outlived the thing it was about').not.toBe(
      nothingToSendYet(true),
    )
    expect(button(m).title).toMatch(/^Send \(/)
  })

  it('⚠️ the sentence names attaching only where attaching is offered', () => {
    // Both shipped mounts pass `can-attach`, so in the app today it always names both ways. Naming
    // a gesture a mount has switched off would be `106` one layer down, in the prose.
    expect(nothingToSendYet(true)).toBe('Type a message, or attach a file, to send')
    expect(nothingToSendYet(false)).toBe('Type a message to send')
    expect(nothingToSendYet(false)).not.toMatch(/attach/i)
  })
})

/* ---------------------------------------------- the states that are not about content */

/**
 * # ⛔ A dark button must explain ITSELF, not the last reason anybody wrote down
 *
 * `canSend` refuses on three clauses — `blocked`, the STATE, and content — and the first version of
 * 223 wrote the tooltip as a second chain that enumerated only two of them. So the first state
 * neither chain covered, `ended`, fell through to the content sentence: **a dark Send reading
 * *"Type a message, or attach a file, to send"* over a disabled textarea and a disabled paperclip,
 * one line above a foot saying the conversation had ended.**
 *
 * ⛔ **A regression 223 introduced.** Before it, that state read `Send (⌘↵)` — wrong under `106`,
 * but at least not an instruction to do two things the same render had just switched off. `118`'s
 * rule is that a control may only be dark when there is a reachable later, and in `ended` typing is
 * not the later at all: reopening from the rail is.
 *
 * ⚑ **Found by an adversarial pass over 223's own diff, and fixed at the root**: `sendRefusal`
 * derives from `canSendNow`, so a lit button has no reason and a dark one always has one.
 *
 * ⚑ **D-017b · `ended` is gone** — every conversation takes a message and sending continues it, so
 * its own test left with the state; the invariant below still runs over every state there is.
 */
describe('223 · every dark Send names its OWN obstacle', () => {
  const composer = (over: Record<string, unknown>): Mounted =>
    mount(
      PromptComposer as Component,
      { state: 'idle', draft: '', canAttach: true, cwd: '/tmp', ...over },
      { width: 900, height: 400 },
    )

  it('⚑ …and the invariant behind it: dark ⇔ a sentence, over every state and both contents', () => {
    // ⛔ **This is the assertion that would have caught the regression**, and it is the reason
    // `sendRefusal` derives from `canSendNow` rather than re-deriving the clauses. Every state, with
    // and without words, with and without a blocker: a dark button always explains itself, a lit one
    // never does, and no dark button is left saying "Send".
    const STATES = ['idle', 'busy', 'starting', 'frozen'] as const
    const seen = new Set<string>()
    for (const state of STATES) {
      for (const draft of ['', 'hello']) {
        for (const blocked of [null, 'the sign-in moved']) {
          // `busy` with text swaps the button for queue/interrupt-send, and `frozen`/`busy` render
          // the stop button — so this only speaks about the mounts where `send-prompt` exists.
          const m = composer({ state, draft, blocked, interruptible: false })
          const send = m.host.querySelector('[data-cy="send-prompt"]') as HTMLButtonElement | null
          if (send === null) continue
          seen.add(
            `${state}/${draft === '' ? 'empty' : 'typed'}/${blocked === null ? 'free' : 'blocked'}`,
          )
          if (send.disabled) {
            expect(send.title, `${state} dark with no reason`).not.toBe('')
            expect(send.title, `${state} dark and still saying "Send"`).not.toMatch(/^Send \(/)
          } else {
            expect(send.title, `${state} lit and still carrying a refusal`).toMatch(/^Send \(/)
          }
        }
      }
    }
    // ⛑ Non-vacuity: the loop has to have MET a send button in both conditions, or the two branches
    // above are assertions about nothing.
    expect(seen.size, 'no mount rendered a send button at all').toBeGreaterThan(8)
  })
})

/* ------------------------------------------------------------------ §4 · precedence */

describe('223 §4 · `blocked` outranks the empty box (219 §1)', () => {
  it('🔴 both true at once — the sentence a person needs is the one they cannot type past', async () => {
    // ⛔ **A closing conversation AND an empty box.** Two true reasons, one slot. `blocked` wins:
    // an empty box is fixed by doing the thing the person was already about to do, and `blocked` is
    // not. *"Type a message"* over a conversation on its way out sends them to the one action that
    // cannot possibly help. 223 §6 forbids weakening 219's gate, and this is why it should not be.
    const closing = idle()
    closing.phase = 'closing'
    const m = openPane({ record: closing })
    await nextTick()

    expect(button(m).disabled, 'both reasons are true, so it must be dark either way').toBe(true)
    expect(button(m).title).toBe(CLOSING_BLOCK)
    expect(button(m).title).not.toBe(nothingToSendYet(true))
    expect(hint(m)).toBe(CLOSING_BLOCK)
  })

  it('⚑ …and with the same record UNBLOCKED, the empty box gets the slot back', async () => {
    // The paired positive: without it, "blocked wins" is satisfied by a composer that never says
    // the other sentence at all.
    const m = openPane()
    await nextTick()

    expect(button(m).disabled).toBe(true)
    expect(button(m).title).toBe(nothingToSendYet(true))
  })
})
