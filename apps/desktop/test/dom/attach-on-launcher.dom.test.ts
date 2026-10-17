import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
// ⚑ **Four imports left with 417** (HO-022 §2): `LaunchDraft` — the module is deleted —
// `DEFAULT_PROFILE_ID` and `DEFAULT_PROJECT_ID`, which were the `profiles` prop and the launch
// draft's project choice, and `CwdVerdict`, which was the folder row's verdict on what was typed.
import type { CreateSessionInput, HandedPath } from '../../src/shared/runtime-ipc'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * # ⛔ A conversation can BEGIN with a file (217)
 *
 * `013` is why this is not "one more surface": **a conversation in this app starts by sending its
 * first message**, so the launcher's prompt IS the first message. Without an attach control here a
 * person cannot begin by handing an agent a file — the most natural first gesture there is,
 * *"here, look at this"* — and must start a thread about nothing to attach on the second turn.
 *
 * ⛔ **`216` is not at fault and this file should not read as though it were.** The brief said *"a
 * control on the composer"* and there are TWO mounts of `PromptComposer`; `216` built the one it
 * was pointed at and proved it end to end. What was missing was the nine lines of props on the
 * other mount — and `canAttach` defaulting to `false` is what kept the half-wired version off the
 * screen rather than shipping a paperclip that opened a dialog and threw the answer away.
 *
 * ⚑ **One implementation, two surfaces.** Every assertion here drives the SAME `PromptComposer` the
 * conversation uses. There is no launcher-specific chip, picker or send — see the mount at
 * `NewConversation.vue`, which is the entire difference between the two.
 *
 * ## ⚑ What 417 took out of this file (HO-022 §2)
 *
 * > *"Opening a new conversation opens a conversation with BroBot. That is all."*
 *
 * ⛔ **The composer itself survives whole and every hop below is unchanged** — 217's finding was
 * that the launcher's prompt IS the first message, and that is more true with nothing else on the
 * screen. What went is the SETTINGS the fixtures used to hand it: `models`, `profiles`, the
 * `launch` draft and its `update:launch` listener are not in the component's API any more, and
 * the folder field that four of the five "folder wrinkle" tests were about is gone with them.
 * Each cut is noted where it was made rather than here.
 */

const INSIDE: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }
/** What a blank folder makes of any path — `outsideWorkingDirectory` answers `true` for `''`. */
const UNPLACED: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: true }

/**
 * ⚑ **What `window.api` used to carry here, and why it is two lines now** (417, HO-022 §2).
 *
 * The old bridge recorded every `classifyAttachments` round trip, answered per folder, and could
 * HOLD an answer so a test could land two of them out of order — all of it in service of the
 * launcher's folder field, which re-classified the staged paths as it was typed (217 §2).
 * ⛔ **The field is gone and so is its caller**: `reclassifyAttachmentsSoon` left with it and
 * `classifyAttachments` has no reader anywhere in the renderer any more, while `chooseCwd` and
 * `runtime.checkCwd` were the folder row's picker and its verdict on what was typed into it.
 *
 * What is left is the attach picker, which is the one bridge call this surface can still reach.
 */
function installBridge(): void {
  ;(window as unknown as { api?: unknown }).api = {
    chooseAttachment: () => Promise.resolve(null),
  }
}

interface Frame {
  /** The words and the paths, held by the parent exactly as `RuntimeScreen` holds them (019). */
  draft: string
  staged: HandedPath[]
  /** Every `start` the launcher emitted, whole. */
  started: [CreateSessionInput, string, HandedPath[]][]
}

let frame: Frame
/**
 * ⛔ **The launcher's draft transaction** (292 §2) — the same book `RuntimeScreen` hands it, keyed
 * `NEW_CONVERSATION`. It replaced the `attachments` prop and its `update:attachments` listener,
 * because a list cannot hold a paste that is still being written when this surface is torn down.
 */
let book = createAttachmentBook()
/** What the launcher's slot holds — read from the book, which is where the launcher writes it. */
const held = (): HandedPath[] => book.read(NEW_CONVERSATION)

/**
 * ⚠️ **Mounted under a parent that OWNS both halves**, which is not decoration: `PromptComposer`'s
 * `text` is a computed over `props.draft` and keeps no copy, so a flat prop is patched back to its
 * old value on the next render. `launch-draft.dom.test.ts` had exactly that shortcut and it went
 * unnoticed until `217` made the composer re-render.
 */
function launcher(over: Record<string, unknown> = {}): Mounted {
  installBridge()
  frame = { draft: '', staged: [], started: [] }
  const words = ref('')
  book = createAttachmentBook()
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
          // ⚑ **`models` is back at `435`** (HO-025 §5, the prop three lines up) and `profiles`,
          // `launch` and `update:launch` are still gone — `417` cut all four (HO-022 §2) and the
          // ruling only reversed the model half. ⚠️ **The payload of an UNTOUCHED door is still
          // `{ provider, profileId: 'default', approvalMode: 'ask' }`**, which is the property
          // `435` kept: `model` and `reasoningEffort` ride conditional spreads, so a door nobody
          // answered sends what `417` shipped.
          ...over,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          'onUpdate:draft': (text: string) => {
            words.value = text
            frame.draft = text
          },
          onStart: (input: CreateSessionInput, first: string, handed: HandedPath[]) =>
            frame.started.push([input, first, handed]),
        })
    },
  })
  return mount(Host, {}, { width: 1000, height: 900 })
}

async function set(el: HTMLElement, value: string): Promise<void> {
  ;(el as HTMLInputElement).value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

let view: Mounted | null = null

afterEach(() => {
  view = null
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('the launcher can attach (217 §1)', () => {
  it('the attachment control is on the launcher', () => {
    // The PM read the launcher's controls out of the live DOM at 3151a36 and got
    // profile-select · profile-owns · cwd-choose · cwd-input · model-input · model-choices ·
    // prompt-input · send-prompt — and no attach control. `visible`, not merely present.
    view = launcher()

    const button = view.q('attach-path')
    expect(visible(button)).toBe(true)
    expect(button.getAttribute('title')).toContain('Attach a file or folder')
  })

  it('⛔ …and it is the SAME composer, so the send button and the field are still there', () => {
    // One implementation, two surfaces: if this mount had grown its own composer, this is where the
    // two would start to differ. Nothing here is launcher-specific.
    view = launcher()
    expect(visible(view.q('prompt-input'))).toBe(true)
    expect(visible(view.q('send-prompt'))).toBe(true)
    // ⚑ **A third line stood here and 417 removed its subject** (HO-022 §2): `cwd-input`, the
    // folder row. ⚠️ It was never the composer's — the LAUNCHER drew it, above the composer — so
    // nothing about "one implementation, two surfaces" is weakened by its going; the two controls
    // this test is about are the shared composer's own, and they are both still asserted.
  })

  it('🔴 what is staged is SHOWN, and it is not inside the words', async () => {
    // Before injection, show everything BroBot is going to put in front of the agent.
    view = launcherWith([INSIDE], 'have a look at this')
    await nextTick()

    expect(visible(view.q('composer-attachments'))).toBe(true)
    expect(view.q('attached-file').getAttribute('title')).toBe(INSIDE.path)
    // ⛔ …and the words stay exactly what was typed — `214` from the other end, at the first message.
    expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('have a look at this')
    expect((view.q('prompt-input') as HTMLTextAreaElement).value).not.toContain(INSIDE.path)
  })

  it('🔴 it is UNDOABLE before the conversation starts', async () => {
    view = launcherWith([INSIDE, { path: '/work/alpha/src', kind: 'directory', outsideCwd: false }])
    await nextTick()
    ;(view.q('detach-file') as HTMLButtonElement).click()
    await nextTick()

    expect(held()).toEqual([{ path: '/work/alpha/src', kind: 'directory', outsideCwd: false }])
  })
})

describe('the first message carries them (217 §1, the four hops)', () => {
  it('🔴 START emits the paths WITH the words — every hop that used to drop them', async () => {
    // ⛔ `@send="startWith"` bound a ONE-parameter function to a three-value emit, `start` was typed
    // with no attachments slot, `RuntimeScreen.start` had no third parameter, and `store.send` was
    // called with three arguments. Four silent drops in a row; this is the end of that chain.
    view = launcherWith([INSIDE], 'have a look at this')
    await nextTick()
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(frame.started).toHaveLength(1)
    const [, first, handed] = frame.started[0]!
    expect(first).toBe('have a look at this')
    expect(handed).toEqual([INSIDE])
  })

  it('⚑ …and a launch with nothing staged carries an empty list, not a stale one', async () => {
    view = launcherWith([], 'just words')
    await nextTick()
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(frame.started).toHaveLength(1)
    expect(frame.started[0]![2]).toEqual([])
  })

  it('🔴 an attachment with NO words still starts a conversation', async () => {
    // ⛔ Decided deliberately rather than inherited (217 §9's finding 4): `canSend` permits
    // text-empty-plus-attachment on the in-conversation composer, so the launcher inherits it, and
    // *"here, look at this folder"* is a real way to open a thread. ⚑ Nothing is left nameless by
    // it — both the rail row and the header title are `basenameOf(cwd) || sessionId`, never the
    // first message — and `messageWithHandedPaths('')` composes the block on its own.
    view = launcherWith([INSIDE], '')
    await nextTick()

    expect((view.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(frame.started).toHaveLength(1)
    expect(frame.started[0]![1]).toBe('')
    expect(frame.started[0]![2]).toEqual([INSIDE])
  })

  it('⚑ THE PAIRED NEGATIVE — nothing typed and nothing staged starts nothing', async () => {
    view = launcherWith([], '')
    await nextTick()
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(frame.started).toEqual([])
  })
})

/**
 * ⚑ **What stood here: "the folder wrinkle (217 §2)", five tests — four of them cut by 417**
 * (HO-022 §2).
 *
 * The launcher had a folder field, so a chip's mark could CHANGE under a person's hands, and four
 * tests drove exactly that: the ordinary marks coming back both ways once a folder was chosen, the
 * re-evaluation on a change, a slow answer about a folder the box had moved on from being
 * discarded, and the paired negative that an empty stage asks main nothing per keystroke.
 * ⛔ **All four subjects went with the field**: there is no `cwd-input`, the launcher hands
 * `PromptComposer` no `cwd` at all, and `reclassifyAttachmentsSoon` — with every
 * `classifyAttachments` call in the renderer — left with them.
 *
 * ⛔ **The one below is NOT one of those four and is kept deliberately.** Its subject is what the
 * chip says over a blank folder, which 417 did not remove — it made PERMANENT: this door has no
 * folder, so `cwdKnown` is false for the life of the surface and every path staged here is
 * `no-folder`. ⚠️ **It is also the only assertion in the repository that reads
 * `attached-no-folder`** — `attach-path` and `paste-image` mount conversations, which always have
 * a real cwd and can only reach `outside`/`none`, and `composer-parity`'s new `cwd` exemption is a
 * census of the BINDING, not of what the chip says. Deleting it would retire a rule that is more
 * true after 417 than it was before.
 */
describe('the launcher has no folder, so the chip says so (217 §2, narrowed by 417)', () => {
  it('🔴 with no folder the chip says so — it does not claim "outside"', async () => {
    // ⛔ `outsideWorkingDirectory` answers `true` for a blank cwd by design ("an unknown cwd counts
    // as OUTSIDE"), and blank is now the launcher's ONLY case — it was merely its commonest one
    // while the field existed. A two-state chip would therefore mark every attachment on this
    // surface `outside` and be lying about a directory nobody was ever offered: `UNPLACED` is
    // staged carrying `outsideCwd: true` precisely so that a two-state chip would be caught here.
    view = launcherWith([UNPLACED], '')
    await nextTick()

    expect(visible(view.q('attached-no-folder'))).toBe(true)
    expect(view.host.querySelector('[data-cy=attached-outside]')).toBeNull()
  })
})

/** A launcher with paths already staged and words already typed — the state a pick leaves behind. */
function launcherWith(staged: HandedPath[], draft = ''): Mounted {
  installBridge()
  frame = { draft, staged, started: [] }
  const words = ref(draft)
  book = createAttachmentBook()
  book.write(NEW_CONVERSATION, staged)
  // ⚑ **A third parameter stood here — `folder` — and built a `LaunchDraft` around it** (cut by
  // 417, HO-022 §2). It was the only way a test could give this surface a cwd; `launch-draft.ts`
  // is deleted with the fold and the three pickers that wrote into it, and the `launch` prop it
  // travelled on is not in the component's API any more.
  const Host = defineComponent({
    name: 'StagedLauncherHost',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          defaultProvider: 'claude',
          models: null,
          choices: NO_LAUNCH_CHOICES,
          capabilities: allProviderCapabilities(),
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          'onUpdate:draft': (text: string) => {
            words.value = text
            frame.draft = text
          },
          onStart: (input: CreateSessionInput, first: string, handed: HandedPath[]) =>
            frame.started.push([input, first, handed]),
        })
    },
  })
  return mount(Host, {}, { width: 1000, height: 900 })
}

describe('a launch that failed hands both halves back (217 §2)', () => {
  it('🔴 the words AND the paths come back when the launch does not open', async () => {
    // ⛔ `211` made the launch draft whole; §2 says attachments are now part of that draft. A
    // restore that returned the sentence and dropped the file would be that dispatch's defect
    // wearing a new coat — and the person would not notice, because the sentence looks complete.
    const staged = [INSIDE]
    installBridge()
    frame = { draft: '', staged: [], started: [] }
    const words = ref('')
    book = createAttachmentBook()
    book.write(NEW_CONVERSATION, staged)
    const busy = ref(false)
    const error = ref<string | null>(null)
    const Host = defineComponent({
      name: 'FailingLaunchHost',
      setup() {
        return () =>
          h(NewConversation as Component, {
            busy: busy.value,
            error: error.value,
            debug: false,
            defaultProvider: 'claude',
            models: null,
            choices: NO_LAUNCH_CHOICES,
            capabilities: allProviderCapabilities(),
            draft: words.value,
            handing: book.handing(NEW_CONVERSATION),
            'onUpdate:draft': (text: string) => {
              words.value = text
              frame.draft = text
            },
            onStart: (input: CreateSessionInput, first: string, handed: HandedPath[]) =>
              frame.started.push([input, first, handed]),
          })
      },
    })
    view = mount(Host, {}, { width: 1000, height: 900 })
    await set(view.q('prompt-input'), 'start on this please')
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    // The composer cleared both halves on send, which is what makes the restore load-bearing.
    expect(frame.started).toHaveLength(1)
    expect(frame.started[0]![2]).toEqual(staged)
    expect(held()).toEqual([])

    // The launch runs and fails.
    busy.value = true
    await nextTick()
    error.value = 'codex exited before it opened the conversation'
    busy.value = false
    await nextTick()

    expect(words.value).toBe('start on this please')
    expect(held()).toEqual(staged)
  })

  it('⚑ …and a launch that SUCCEEDS hands nothing back — the draft is consumed', async () => {
    // The paired negative: a restore that fired on every settle would put the message back into a
    // launcher the conversation had just opened over, which is `211`'s rule read backwards.
    const staged = [INSIDE]
    installBridge()
    frame = { draft: '', staged: [], started: [] }
    const words = ref('')
    book = createAttachmentBook()
    book.write(NEW_CONVERSATION, staged)
    const busy = ref(false)
    const Host = defineComponent({
      name: 'OpeningLaunchHost',
      setup() {
        return () =>
          h(NewConversation as Component, {
            busy: busy.value,
            error: null,
            debug: false,
            defaultProvider: 'claude',
            models: null,
            choices: NO_LAUNCH_CHOICES,
            capabilities: allProviderCapabilities(),
            draft: words.value,
            handing: book.handing(NEW_CONVERSATION),
            'onUpdate:draft': (text: string) => (words.value = text),
            onStart: () => {},
          })
      },
    })
    view = mount(Host, {}, { width: 1000, height: 900 })
    await set(view.q('prompt-input'), 'start on this please')
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    busy.value = true
    await nextTick()
    busy.value = false
    await nextTick()

    expect(words.value).toBe('')
    expect(held()).toEqual([])
  })
})
