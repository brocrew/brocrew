import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import type { ChosenAttachment, HandedPath } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⛔ Handing the agent a path, ON SCREEN (216 §2)
 *
 * `213` said the app is credible for scratch work and named this as the gesture it is missing. So
 * every claim here is a painted control in a real browser and a click that produced an event — the
 * standing `brobot2-ssr-tests-pass-vacuously` rule at full strength, because *"a person could not
 * find it"* is what the finding was.
 *
 * Display every custom prompt or system hint injected into the agent, including an appended
 * path. Material added by BroBot must also carry app authorship so it cannot appear as words
 * the person typed.
 */

const stubbed = (): { api?: { chooseAttachment: () => Promise<ChosenAttachment> } } =>
  window as unknown as { api?: { chooseAttachment: () => Promise<ChosenAttachment> } }

const FILE: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }
const FOLDER: HandedPath = { path: '/work/alpha/src', kind: 'directory', outsideCwd: false }
const OUTSIDE: HandedPath = { path: '/elsewhere/other.txt', kind: 'file', outsideCwd: true }

/**
 * ⛔ **The draft this composer is editing, owned by the TEST** (292 §2).
 *
 * ⚠️ **It was a `ref` and an `update:attachments` listener until 292**, which was the shape `212`
 * settled and `019`'s rule required: the composer must not own this state. ⚑ The rule did not
 * change — what the caller owns did. A list could not hold an operation that is still in flight,
 * so an acquisition begun here and answered after the composer was gone reached nothing (`288`
 * H2); the caller hands over the transaction now, and reads what landed in it.
 */
const DRAFT = 'session:alpha'
let book = createAttachmentBook()
const handed = (): HandedPath[] => book.read(DRAFT)

function composer(over: Record<string, unknown> = {}): Mounted {
  book = createAttachmentBook()
  book.write(DRAFT, (over['attachments'] as HandedPath[] | undefined) ?? [])
  const rest = { ...over }
  delete rest['attachments']
  const ComposerHost = defineComponent({
    name: 'ComposerHost',
    setup() {
      return () =>
        h(PromptComposer as Component, {
          state: 'idle',
          draft: '',
          cwd: '/work/alpha',
          // ⚠️ **Opt-in, and the default is OFF** — `NewConversation` mounts this same composer
          // before a session exists, where there is no cwd to resolve a path against and no
          // conversation to attach to. Passing it here is what the pane does.
          // ⚑ **417 (HO-022 §2) made "there is no cwd" literal**: the launcher's folder row is
          // gone, so that mount no longer binds `cwd` at all rather than binding `''`. It still
          // passes `canAttach: true` (217 · `013` makes the launcher's prompt the FIRST message),
          // so every path staged there is judged with no folder — which was already the case.
          canAttach: true,
          ...rest,
          handing: book.handing(DRAFT),
        })
    },
  })
  return mount(ComposerHost, {}, { width: 900 })
}

let view: Mounted | null = null

afterEach(() => {
  view = null
  unmountAll()
  delete stubbed().api
})

describe('the attach control (216 §2)', () => {
  it('⛔ is on the composer, painted, and says what it does', () => {
    // 213 went looking for exactly this. `visible`, not merely present in the markup.
    view = composer()

    const button = view.q('attach-path')
    expect(visible(button)).toBe(true)
    expect(button.getAttribute('title')).toContain('Attach a file or folder')
  })

  it('⚑ …and it is ABSENT wherever the mount does not opt in — the default is OFF', () => {
    // ⛔ Found in review at 216: `NewConversation` mounted this composer with no `attachments`, no
    // `cwd` and no listener, so the paperclip opened a real OS dialog and threw the pick away.
    // Attaching before a conversation exists is real work — a path would have nothing to be inside
    // or outside of — and it was deliberately not built, so the control was not offered.
    // ⚠️ **217 built it and turned the launcher ON**, and 417 did not change that; this test is
    // about the DEFAULT, which is what keeps a half-wired future mount off the screen. The title
    // named the launcher until 417 made that reading actively misleading.
    view = composer({ canAttach: false })
    expect(view.host.querySelector('[data-cy="attach-path"]')).toBeNull()
    // The rest of the composer is untouched, or this would be testing a broken mount.
    expect(visible(view.q('prompt-input'))).toBe(true)
  })

  it('🔴 THE FIELD KEEPS ITS COLUMN when something is staged — the grid is not disturbed', () => {
    // ⛔ **The defect `visible()` could not see.** `.composer` is a grid, so the chip list and the
    // refusal arrive as ordinary grid ITEMS, and auto-placement can shift everything after them
    // into a cell meant for something else.
    // ⚠️ `visible()` asserts only that width and height are non-zero, which a broken grid satisfies
    // — so this measures the boxes instead. `grid-column: 1 / -1` is what it holds.
    view = composer({ attachments: [FILE] })

    const field = view.q('prompt-input').getBoundingClientRect()
    const send = view.q('send-prompt').getBoundingClientRect()
    const chips = view.q('composer-attachments').getBoundingClientRect()

    // The field is the wide column, not a button-sized cell.
    expect(field.width).toBeGreaterThan(send.width * 4)
    // The buttons are their own row UNDER the field, not squeezed beside it.
    expect(send.top).toBeGreaterThanOrEqual(field.bottom - 1)
    // The chips are a row ABOVE, spanning the field's whole column rather than one cell of it.
    expect(chips.bottom).toBeLessThanOrEqual(field.top + 1)
    expect(Math.abs(chips.left - field.left)).toBeLessThan(2)
    expect(chips.width).toBeGreaterThan(field.width - 2)

    // ⚑ THE PAIRED POSITIVE: the same measurements with nothing staged, so the assertions above
    // describe the staged case rather than the composer's ordinary shape.
    const bare = composer()
    const bareField = bare.q('prompt-input').getBoundingClientRect()
    const bareSend = bare.q('send-prompt').getBoundingClientRect()
    expect(Math.abs(bareField.width - field.width)).toBeLessThan(2)
    expect(Math.abs(bareField.left - field.left)).toBeLessThan(2)
    expect(Math.abs(bareSend.top - bareField.bottom - (send.top - field.bottom))).toBeLessThan(2)
  })

  it('⛔ the attach button is the same size as the send button beside it', () => {
    // Found in review: left off the `.send-button, …` sizing rule it fell through to `base.css`'s
    // generic `button` and painted as a 30×20 bordered pill next to a 29×29 flat one.
    view = composer()
    const attach = view.q('attach-path').getBoundingClientRect()
    const send = view.q('send-prompt').getBoundingClientRect()
    expect(Math.round(attach.width)).toBe(Math.round(send.width))
    expect(Math.round(attach.height)).toBe(Math.round(send.height))
  })

  it('🔴 with a file staged and an empty box, Send is LIVE and it sends', () => {
    // ⛔ Found in review: `canSend` required text, the send button's `:disabled` did not reflect it,
    // so the button was lit and pressing it did nothing at all — no message, no error, nothing.
    // `messageWithHandedPaths` already composes an attachment-only message, so the fix is to allow
    // it rather than to grey the button out.
    const only = createAttachmentBook()
    only.write(DRAFT, [FILE])
    const sent: unknown[][] = []
    const Host = defineComponent({
      name: 'EmptyBoxHost',
      setup() {
        return () =>
          h(PromptComposer as Component, {
            state: 'idle',
            draft: '',
            cwd: '/work/alpha',
            canAttach: true,
            handing: only.handing(DRAFT),
            onSend: (...args: unknown[]) => sent.push(args),
          })
      },
    })
    view = mount(Host, {}, { width: 900 })

    const button = view.q('send-prompt') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.[2]).toEqual([FILE])

    // ⚠️ **The fix is `canSend`, NOT the button's `:disabled`** — and that distinction is the
    // measurement, not a preference. Tightening `:disabled` to require content broke ten launcher
    // assertions in `folder-gate` and `profile-picker`: the LAUNCHER deliberately keeps Send lit
    // with an empty box, because there it is gated on the folder and the profile rather than on
    // the prompt. So the press is made to WORK rather than the control taken away.
    //
    // ⚑ THE PAIRED NEGATIVE: with nothing typed and nothing attached, the same press emits
    // nothing — which is the pre-existing behaviour this did not change.
    unmountAll()
    const quiet: unknown[][] = []
    const Empty = defineComponent({
      name: 'EmptyHost',
      setup() {
        return () =>
          h(PromptComposer as Component, {
            state: 'idle',
            draft: '',
            cwd: '/work/alpha',
            canAttach: true,
            handing: createAttachmentBook().handing(DRAFT),
            onSend: (...args: unknown[]) => quiet.push(args),
          })
      },
    })
    view = mount(Empty, {}, { width: 900 })
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    expect(quiet).toEqual([])
  })

  it('🔴 what was attached is SHOWN — the injection is visible, which is the standing rule', () => {
    view = composer({ attachments: [FILE, FOLDER] })

    const list = view.q('composer-attachments')
    expect(visible(list)).toBe(true)
    expect(view.q('attached-file').getAttribute('title')).toBe(FILE.path)
    expect(view.q('attached-directory').getAttribute('title')).toBe(FOLDER.path)
    // ⛔ …and the two are told apart, because the agent reads them with different tools.
    expect(list.querySelectorAll('li[data-kind="file"]')).toHaveLength(1)
    expect(list.querySelectorAll('li[data-kind="directory"]')).toHaveLength(1)
  })

  it('⚑ …and with nothing attached there is no empty box', () => {
    // The paired negative: a list that rendered always would put a permanent blank strip above a
    // composer most messages never attach anything to.
    view = composer()
    expect(view.host.querySelector('[data-cy="composer-attachments"]')).toBeNull()
  })

  it('🔒 a path outside the working directory SAYS so — it is allowed, not silent', () => {
    view = composer({ attachments: [OUTSIDE] })
    expect(visible(view.q('attached-outside'))).toBe(true)

    // The paired positive: one inside stays quiet, so the mark means something.
    unmountAll()
    view = composer({ attachments: [FILE] })
    expect(view.host.querySelector('[data-cy="attached-outside"]')).toBeNull()
  })

  it('🔴 attaching is UNDOABLE before send', () => {
    // §2: "Attaching must be undoable before send — 211 made the launch draft whole; a half-formed
    // attachment is the same defect."
    view = composer({ attachments: [FILE, FOLDER] })

    ;(view.q('detach-file') as HTMLButtonElement).click()

    expect(handed()).toEqual([FOLDER])
  })

  it('🔴 attachments are CLEARED when the message goes — they do not ride the next one', async () => {
    // ⛔ An attachment that outlived its send would go again, silently, because the chip looks the
    // same. `211` §1 spent a dispatch on exactly this shape for the launch draft.
    const own = createAttachmentBook()
    own.write(DRAFT, [FILE])
    const sent: string[] = []
    const Host = defineComponent({
      name: 'SendHost',
      setup() {
        return () =>
          h(PromptComposer as Component, {
            state: 'idle',
            draft: 'take a look',
            cwd: '/work/alpha',
            canAttach: true,
            handing: own.handing(DRAFT),
            onSend: (text: string) => sent.push(text),
          })
      },
    })
    view = mount(Host, {}, { width: 900 })
    await nextTick()

    // ⚑ The paired positive, so "cleared" is not a fact about a slot that was empty all along.
    expect(own.read(DRAFT)).toEqual([FILE])
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(sent).toEqual(['take a look'])
    expect(own.read(DRAFT)).toEqual([])
  })

  it('⛔ the picker’s REFUSAL is shown, in the host’s own words, and announced', () => {
    view = composer()
    stubbed().api = {
      chooseAttachment: () => Promise.resolve({ refusal: 'there is nothing at /gone.md' }),
    }

    return (async () => {
      ;(view!.q('attach-path') as HTMLButtonElement).click()
      await nextTick()
      await nextTick()
      await nextTick()

      const note = view!.q('attach-refused')
      expect(visible(note)).toBe(true)
      expect(note.textContent).toContain('there is nothing at /gone.md')
      expect(note.getAttribute('role')).toBe('alert')
      // ⛔ …and nothing was attached, so a refusal cannot leave a half-formed one behind.
      expect(handed()).toEqual([])
    })()
  })

  it('⛔ a mount that owns NO draft book gets its own transaction, not a shared one', async () => {
    // ⛔ **The default is a FACTORY, and a factory that ran once would be `019` at its worst**: two
    // composers on one page sharing a staged list, so a file attached in one is sent by the other.
    // ⚠️ **Asserted rather than trusted.** The shipped mounts both pass a real transaction and the
    // default exists only for SSR and unit mounts — which is precisely the population that would
    // never notice, and precisely why this is measured instead of reasoned about.
    stubbed().api = {
      chooseAttachment: () => Promise.resolve({ handed: FILE }),
    }
    const Pair = defineComponent({
      name: 'BooklessPair',
      setup() {
        return () => [
          h('div', { 'data-cy': 'left' }, [
            h(PromptComposer as Component, {
              state: 'idle',
              draft: '',
              cwd: '/work/alpha',
              canAttach: true,
            }),
          ]),
          h('div', { 'data-cy': 'right' }, [
            h(PromptComposer as Component, {
              state: 'idle',
              draft: '',
              cwd: '/work/alpha',
              canAttach: true,
            }),
          ]),
        ]
      },
    })
    view = mount(Pair, {}, { width: 900 })
    await nextTick()

    const [leftClip] = view.all('attach-path')
    leftClip!.click()
    await nextTick()
    await nextTick()
    await nextTick()

    // ⚑ The paired positive: the gesture really staged something, in the composer that made it.
    const chips = view.all('composer-attachments')
    expect(chips, 'the picker staged nothing — this test proves nothing').toHaveLength(1)
    expect(view.q('left').querySelector('[data-cy=composer-attachments]')).not.toBeNull()
    // 🔴 …and the other composer, which shares nothing but a default, is untouched.
    expect(
      view.q('right').querySelector('[data-cy=composer-attachments]'),
      'two bookless composers share one staged list — 019 with a filename on it',
    ).toBeNull()
  })

  it('⚠️ cancelling the picker changes NOTHING — it is not a refusal', () => {
    // `null` is a changed mind. A UI that conflated the two would show an error to somebody who
    // simply closed the dialog — the distinction `076` §3 and `214` both draw.
    view = composer({ attachments: [FILE] })
    stubbed().api = { chooseAttachment: () => Promise.resolve(null) }

    return (async () => {
      ;(view!.q('attach-path') as HTMLButtonElement).click()
      await nextTick()
      await nextTick()

      expect(view!.host.querySelector('[data-cy="attach-refused"]')).toBeNull()
      expect(handed()).toEqual([FILE])
    })()
  })
})

describe('what the transcript shows (216 §2, and 214 from the other end)', () => {
  const bubble = (over: Partial<HandedPath[]> | undefined, text = 'have a look at this'): Mounted =>
    mount(
      UserMessage,
      {
        item: {
          kind: 'user',
          id: 'user_1',
          text,
          at: 1_700_000_000_000,
          ...(over ? { attachments: over } : {}),
        },
      },
      { width: 900 },
    )

  it('🔴 the attachment is VISIBLE and is NOT inside what the person said', () => {
    view = bubble([FILE])

    // Display the injected material.
    expect(visible(view.q('user-attachments'))).toBe(true)
    expect(view.q('user-attached-file').textContent).toContain(FILE.path)

    // ⛔ **And `user-message` still holds exactly what they typed** — `214`'s defect from the other
    // end. `textContent` is what a copy, a search and every existing assertion get (001's rule).
    expect(view.q('user-message').textContent?.trim()).toBe('have a look at this')
    expect(view.q('user-message').textContent).not.toContain(FILE.path)
  })

  it('⛔ …and it is attributed to BroBot, not to the person', () => {
    view = bubble([FILE])
    expect(view.q('user-attachments').textContent).toContain('This app attached')
  })

  it('⚑ THE PAIRED POSITIVE — a turn with nothing attached is untouched', () => {
    // Almost every turn. A bubble that grew a strip for all of them would be the cost of this
    // feature landing on people who never use it.
    view = bubble(undefined)

    expect(view.host.querySelector('[data-cy="user-attachments"]')).toBeNull()
    expect(view.q('user-message').textContent?.trim()).toBe('have a look at this')
  })

  it('🔒 an outside path says so in the transcript too, not only in the composer', () => {
    // The composer's mark is gone the moment it sends; the transcript is where somebody goes later
    // to find out what they handed over.
    view = bubble([OUTSIDE])
    expect(view.q('user-attached-outside').textContent).toContain('outside')

    // ⚑ **THE PAIRED NEGATIVE, which was missing** (found in review). Asserted only positively —
    // and with `querySelector`, which takes the first match — dropping the `v-if` entirely would
    // have left this green while every attachment in every transcript claimed to be outside the
    // folder. A transcript saying something false about what was consented to is the one thing §3
    // says it may not do.
    unmountAll()
    view = bubble([FILE])
    expect(view.host.querySelector('[data-cy="user-attached-outside"]')).toBeNull()

    // …and with BOTH present, exactly one is marked — the case a per-`li` regression passes.
    unmountAll()
    view = bubble([FILE, OUTSIDE])
    expect(view.host.querySelectorAll('[data-cy="user-attached-outside"]')).toHaveLength(1)
  })
})

describe('a message still WAITING to be sent (216, review)', () => {
  const queued = (over: Record<string, unknown>): Mounted =>
    mount(
      QueuedMessage,
      {
        item: {
          kind: 'queued',
          id: 'queued_1',
          text: 'when you get a moment',
          at: 1_700_000_000_000,
          outcome: null,
          ...over,
        },
      },
      { width: 900 },
    )

  it('🔴 shows what is about to go, in the one window where it can still be changed', () => {
    // A waiting message must show its attachments as well as its words before injection. That
    // is the moment when the person can still undo the send.
    view = queued({ attachments: [FILE, OUTSIDE] })

    expect(visible(view.q('queued-attachments'))).toBe(true)
    expect(view.q('queued-attached-file').textContent).toContain(FILE.path)
    expect(view.q('queued-attachments').textContent).toContain('This app attached')
    expect(view.q('queued-attached-outside').textContent).toContain('outside')
    // ⚑ The same paired negative as the sent bubble, for the same reason.
    unmountAll()
    view = queued({ attachments: [FILE] })
    expect(view.host.querySelector('[data-cy="queued-attached-outside"]')).toBeNull()
    // ⛔ …and `214` from the other end here too: the body is what they typed.
    expect(view.q('queued-message').textContent?.trim()).toBe('when you get a moment')
    expect(view.q('queued-message').textContent).not.toContain(FILE.path)
  })

  it('⚑ THE PAIRED POSITIVE — a waiting message with nothing attached grows no strip', () => {
    view = queued({})
    expect(view.host.querySelector('[data-cy="queued-attachments"]')).toBeNull()
  })

  it('🔴 putting it back in the composer returns the paths WITH the words', () => {
    // Restoring the text alone handed somebody a draft that looked complete and had quietly lost
    // what they attached — they were one message when queued and they go back as one.
    const restored: unknown[][] = []
    view = mount(
      QueuedMessage,
      {
        item: {
          kind: 'queued',
          id: 'queued_1',
          text: 'when you get a moment',
          at: 1_700_000_000_000,
          outcome: 'abandoned',
          attachments: [FILE],
        },
        onRestore: (...args: unknown[]) => restored.push(args),
      },
      { width: 900 },
    )

    ;(view.q('restore-queued') as HTMLButtonElement).click()

    expect(restored).toEqual([['when you get a moment', [FILE]]])
  })

  it('⛔ an abandoned message says WHY when there is a truer reason than the default', () => {
    // `abandoned` renders as "the conversation ended first". A message whose attached file was
    // deleted is also abandoned and is not that — the transcript would state something that did not
    // happen, which is the one thing a transcript may never do.
    view = queued({
      outcome: 'abandoned',
      detail: 'there is nothing at /gone.md — it was there when you attached it',
    })
    expect(view.q('queued-state').textContent).toContain('there is nothing at /gone.md')
    expect(view.q('queued-state').textContent).not.toContain('the conversation ended first')

    // ⚑ The paired positive: without a detail the original wording stands, so this did not simply
    // replace one sentence with another.
    unmountAll()
    view = queued({ outcome: 'abandoned' })
    expect(view.q('queued-state').textContent).toContain('the conversation ended first')
  })
})
