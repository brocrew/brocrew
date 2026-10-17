import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import type { DroppedPathVerdict, HandedPath } from '../../src/shared/runtime-ipc'
import {
  MAX_HANDED_PATHS,
  NO_IMAGE_ON_CLIPBOARD,
  noRoomForPastedImage,
  onlyOnePastedImage,
} from '../../src/shared/runtime-ipc'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⛔ ⌘V with a screenshot on the clipboard (254 §2)
 *
 * Picker and drop gestures stage a path, but a clipboard screenshot has none. Pasting an
 * image must reach the same attachment flow without assuming a pre-existing file path.
 *
 * ## ⚠️ What this file can and cannot prove, said before any of it is read
 *
 * ⛔ **A DOM test has no clipboard.** The `File` objects below are synthesised, the `ClipboardEvent`
 * is dispatched by hand, and the bridge is stubbed — so what is asserted here is the COMPOSER's
 * half: which of the two doors it opens for which clipboard, what it stages, what it refuses, what
 * the chip says, and what it deliberately does NOT do to the event.
 *
 * ⚑ **The other half is measured live**, in `ui-live-smoke.mjs` step `76`, where a real image goes
 * on the real macOS clipboard, a real ⌘V reaches a real Electron window, main writes the file, and
 * a real provider comes back with the token that was only ever in the PIXELS. Neither half is the
 * claim on its own.
 */

interface Bridge {
  /** Path per synthesised `File`, keyed by name — the preload's `getPathForFile`, stubbed. */
  paths: Map<string, string>
  /** Every `handDroppedPaths` call, so the request is assertable as well as the answer. */
  asked: { paths: string[]; cwd?: string }[]
  /** Every `pasteImage` call — the door main opens onto the clipboard. */
  pasted: { cwd?: string }[]
  /**
   * ⛔ **Which door was opened first** (268 §2, from `260` §5).
   *
   * ⚠️ **`254 M40` claimed to re-open the clipboard window and moved nothing**: both its edits
   * slid `await classify(paths)` across a comment, so `pasteImage()` still ran first and all four
   * projects stayed green. ⚑ The only assertion that stood behind that claim was a source census
   * comparing two `indexOf`s — true of the TEXT, and silent about what actually ran. This records
   * the calls themselves, so the ordering is a behaviour a test can see.
   */
  order: ('pasteImage' | 'handDroppedPaths')[]
  /** What main will answer for a paste. */
  answer: DroppedPathVerdict
  /**
   * ⛔ **Which bridge calls park instead of answering** (262 §1).
   *
   * 🔴 **The stub used to resolve IMMEDIATELY, and that is why this file could not see the defect
   * it was written for.** Main's half of a paste encodes a full-screen grab, sweeps a directory,
   * writes a file and classifies the path; a stub that answers in the same microtask makes the one
   * interval that matters — *the person presses Send while it is still being written* —
   * unreachable by construction. Everything below holds main open on purpose.
   */
  hold: Set<'pasteImage' | 'handDroppedPaths'>
  /** The parked calls, waiting for {@link release} to let them go. */
  held: (() => void)[]
}

let bridge: Bridge
/** The draft this file's composer is editing, and the book that owns it (292 §2). */
const DRAFT = 'session:alpha'
let book = createAttachmentBook()
const staged = (): HandedPath[] => book.read(DRAFT)
/** Every `send` the composer emitted — the message that reaches the provider. */
let sent: { text: string; handed: HandedPath[] }[] = []
/** What each send MEANT (292 §1) — a coalesced press must not lose its own intent. */
let intents: string[] = []

const SIZE = { width: 1512, height: 982, bytes: 412_000 }
/**
 * ⛔ **A path shaped exactly like main's**, because the chip now reads the NAME rather than a flag —
 * `pasted-<32 hex>.png` inside `pasted-images`. A fixture with any other name would make every
 * assertion below about a code path the app does not have.
 */
const WROTE = `/Users/x/Application Support/@brobot2/pasted-images/pasted-${'a3f9c1'.repeat(5)}bc.png`

/** A `File` with a real path behind it — a file copied in Finder, pasted here. */
function copied(name: string, path: string): File {
  bridge.paths.set(name, path)
  return new File(['—'], name, { type: 'text/plain' })
}

/**
 * A `File` with NO path — which is what Chromium synthesises for an image on the clipboard.
 *
 * ⚑ **That absence is the whole discriminator**, and it is the same one {@link onDrop} already uses
 * for dragged text and for a picture from a web page. The renderer is not allowed a better question
 * than this one: whether the entry is a picture is main's answer, from the clipboard.
 */
function screenshot(): File {
  bridge.paths.set('image.png', '')
  return new File(['—'], 'image.png', { type: 'image/png' })
}

function installBridge(): void {
  bridge = {
    paths: new Map(),
    asked: [],
    pasted: [],
    order: [],
    answer: { handed: { path: WROTE, kind: 'file', outsideCwd: true, pasted: SIZE } },
    hold: new Set(),
    held: [],
  }
  ;(window as unknown as { api: unknown }).api = {
    pathForDroppedFile: (each: File): string => bridge.paths.get(each.name) ?? '',
    handDroppedPaths: async (input: { paths: string[]; cwd?: string }) => {
      bridge.asked.push(input)
      bridge.order.push('handDroppedPaths')
      await park('handDroppedPaths')
      return input.paths.map((path): DroppedPathVerdict => ({
        handed: { path, kind: 'file', outsideCwd: false },
      }))
    },
    pasteImage: async (input: { cwd?: string }) => {
      bridge.pasted.push(input)
      bridge.order.push('pasteImage')
      await park('pasteImage')
      return bridge.answer
    },
  }
}

/** Main, mid-write: park here until {@link release} — or answer at once, which is every other test. */
async function park(which: 'pasteImage' | 'handDroppedPaths'): Promise<void> {
  if (!bridge.hold.has(which)) return
  await new Promise<void>((resolve) => bridge.held.push(resolve))
}

/** Let every parked call answer, then run the renderer out — the send it was holding included. */
async function release(view: Mounted): Promise<void> {
  const waiting = bridge.held.splice(0)
  expect(waiting.length, 'nothing was being held — the test proved nothing').toBeGreaterThan(0)
  for (const answer of waiting) answer()
  await flush(view)
}

/**
 * Mounted under a parent that OWNS the draft — `019`'s rule, and `drop-to-attach`'s shape.
 *
 * ⛔ **The attachments arrive as a TRANSACTION rather than a list** (292 §2). The parent owns the
 * draft the same way `RuntimeScreen` does, so a paste answered after this composer is gone commits
 * to the draft it was pasted into — which is what the two tests at the end of this file drive.
 */
function composer(over: Record<string, unknown> = {}, key = DRAFT): Mounted {
  book = createAttachmentBook()
  book.write(key, (over['attachments'] as HandedPath[] | undefined) ?? [])
  sent = []
  intents = []
  const rest = { ...over }
  delete rest['attachments']
  // ⛔ **The parent owns the DRAFT too** (262 §1). The words are half of what a send emits, and a
  // host that pinned `draft` to a constant could not tell a message that went out from one that did
  // not: the box would never clear.
  const draft = ref((over['draft'] as string | undefined) ?? '')
  const Host = defineComponent({
    name: 'PasteHost',
    setup() {
      return () =>
        h(PromptComposer as Component, {
          state: 'idle',
          cwd: '/work/alpha',
          canAttach: true,
          ...rest,
          draft: draft.value,
          handing: book.handing(key),
          'onUpdate:draft': (next: string) => {
            draft.value = next
          },
          onSend: (text: string, intent: string, handed: HandedPath[]) => {
            sent.push({ text, handed })
            intents.push(intent)
          },
        })
    },
  })
  return mount(Host, {}, { width: 900 })
}

/** Type into the box the way a person does — through the field, so `v-model` writes the draft. */
async function type(view: Mounted, words: string): Promise<void> {
  const field = view.q('prompt-input') as HTMLTextAreaElement
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

/**
 * Press Send.
 *
 * ⚠️ **The button's `disabled` is asserted first, and that is not decoration.** A disabled button
 * swallows a click in silence, so *"no message was emitted"* would pass over a press that never
 * happened — which is the vacuous shape `258` spent an angle on.
 */
async function press(view: Mounted): Promise<void> {
  const button = view.q('send-prompt') as HTMLButtonElement
  expect(button.disabled, 'the Send button was dark — the press proved nothing').toBe(false)
  button.click()
  await nextTick()
}

function form(view: Mounted): HTMLElement {
  return view.q('composer-band').querySelector('form')!
}

/**
 * Dispatch a real `ClipboardEvent` carrying a real `DataTransfer`.
 *
 * ⚑ **The browser's own objects, not a shape that looks like one** — `clipboardData.files` is
 * populated by `items.add`, which is what the composer reads, so a hand-rolled stand-in could let
 * the handler pass on a payload the engine would never have produced.
 */
async function paste(view: Mounted, ...files: File[]): Promise<ClipboardEvent> {
  return await pasteWith({ text: null }, view, ...files)
}

/** The same gesture, with control over what ELSE the clipboard is carrying. */
async function pasteWith(
  carrying: { text: string | null },
  view: Mounted,
  ...files: File[]
): Promise<ClipboardEvent> {
  const data = new DataTransfer()
  if (carrying.text !== null) data.items.add(carrying.text, 'text/plain')
  for (const each of files) data.items.add(each)
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  })
  form(view).dispatchEvent(event)
  await flush(view)
  return event
}

/**
 * ⛔ **Run the renderer all the way out** — every microtask, then one render.
 *
 * ⚠️ **This replaced a fixed count of `nextTick`s, and the count was the wrong instrument** (262
 * §1). `await nextTick()` yields ONE turn of the microtask queue, so a helper that awaited three of
 * them was really asserting *"the gesture finishes in three microtasks"* — a fact about the shape of
 * `onPaste`, not about the composer. ⛔ Routing the three gestures through one primitive added a
 * layer and two of these tests went red while the behaviour they assert was unchanged. ⚑ A
 * `setTimeout(0)` is a MACROTASK: the engine drains the whole microtask queue before it runs,
 * however deep the chain, so this cannot go stale again.
 */
async function flush(view: Mounted): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  // Reading a layout property forces the style/layout the `visible()` assertions then measure.
  void view.q('composer-band').getBoundingClientRect()
}

/**
 * ⛔ **The same gesture, left UNFINISHED** (262 §1) — dispatched, and then not waited out.
 *
 * ⚑ One tick is exactly the interval this section is about: far enough for `onPaste` to have read
 * the clipboard, reserved its slot and rendered the caption, and — because main is parked in
 * {@link park} — not far enough for anything to have been staged.
 */
async function beginPaste(view: Mounted, ...files: File[]): Promise<void> {
  const data = new DataTransfer()
  for (const each of files) data.items.add(each)
  form(view).dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
  )
  await nextTick()
}

afterEach(unmountAll)

describe('a screenshot pasted into the composer (254 §2)', () => {
  it('🔴 becomes a chip — and the chip does NOT read like a file somebody named', async () => {
    installBridge()
    const view = composer()

    await paste(view, screenshot())

    // ⛔ The one door main opens onto the clipboard, with this conversation's folder for the caption.
    expect(bridge.pasted).toEqual([{ cwd: '/work/alpha' }])
    // ⚠️ …and NOT the drop's door: there was no path to hand it.
    expect(bridge.asked).toEqual([])

    const chip = view.q('attached-file')
    expect(visible(chip)).toBe(true)
    // 🔴 **The dispatch's actual requirement.** Nobody named this thing, so a filename here would
    // present BroBot's invention as the person's choice.
    expect(chip.textContent).toContain('an image you pasted')
    expect(chip.textContent).toContain('1512 × 982')
    // ⚠️ **The FIXTURE's own basename** (review). This asserted `'pasted-a3f9.png'`, which is not a
    // substring of the name the fixture actually has — so reverting the label left it green.
    expect(chip.textContent, 'the chip is showing the name BroBot made up').not.toContain(
      WROTE.split('/').at(-1),
    )
    // ⚑ …and the whole path is still one hover away, so nothing is hidden — only differently said.
    expect(chip.getAttribute('title')).toBe(WROTE)
  })

  it('⛔ the row says it is a paste, in the markup and in the glyph', async () => {
    installBridge()
    const view = composer()

    await paste(view, screenshot())

    const row = view.q('attached-file').closest('li')!
    // `kind` is still `file` — that is what `stat` said and what the agent will read it as. The
    // paste is a separate fact beside it rather than a lie about the type.
    expect(row.getAttribute('data-kind')).toBe('file')
    expect(row.getAttribute('data-pasted')).toBe('true')
    expect(row.querySelector('use')?.getAttribute('href')).toBe('#i-image')
    // ⛔ The undo names the same thing the label does — not a path nobody has seen.
    const detach = view.q('detach-file')
    expect(detach.getAttribute('title')).toBe('Don’t send the image you pasted')
    // 🔴 **It DOES still wear the `outside` mark, and that is a revert** (found reviewing the fix
    // that suppressed it). ⚠️ Hiding it read well — BroBot chose the location, so the mark answers a
    // question nobody asked — but `pasted` is decided by a NAME, and a name is forgeable: suppressing
    // it meant any file called `pasted-<32 hex>.png`, picked or dropped from anywhere, lost the one
    // disclosure `216` §2 exists for. ⚑ A caption may be approximately right; a disclosure may not.
    expect(view.q('attached-outside').textContent).toContain('outside')
  })

  it('🔴 the label comes from the PATH, so a record that lost its measurements is still a paste', async () => {
    // ⛔ **The queue restore, which the first version of this got wrong** (found by the review).
    // `overTheWire` maps `HandedPath` field by field, so a screenshot queued behind a running turn
    // and then *"put back in the composer"* comes back with NO `pasted` — and with a renderer-side
    // flag as the authority the chip reverted to the invented filename, the file glyph and
    // *"Don't send /…/pasted-….png"*: the three things §2 forbids, through one ordinary gesture.
    installBridge()
    const view = composer({ attachments: [{ path: WROTE, kind: 'file', outsideCwd: true }] })
    await nextTick()

    const chip = view.q('attached-file')
    expect(chip.textContent).toContain('an image you pasted')
    // ⚠️ One measurement lighter, and never a filename — which is the whole point of the fallback.
    expect(chip.textContent).not.toContain('1512 × 982')
    expect(chip.textContent).not.toContain('pasted-a3')
    expect(chip.closest('li')!.getAttribute('data-pasted')).toBe('true')
    expect(view.q('detach-file').getAttribute('title')).toBe('Don’t send the image you pasted')
  })

  it('shows a Windows-form pasted picture as a paste, not its generated filename', async () => {
    installBridge()
    const windowsPath = WROTE.replaceAll('/', '\\')
    const view = composer({ attachments: [{ path: windowsPath, kind: 'file', outsideCwd: true }] })
    await nextTick()

    const chip = view.q('attached-file')
    expect(chip.textContent).toContain('an image you pasted')
    expect(chip.textContent).not.toContain('pasted-a3')
    expect(chip.getAttribute('title')).toBe(windowsPath)
    expect(chip.closest('li')!.getAttribute('data-pasted')).toBe('true')
  })

  it('⚠️ …and a FOLDER with that name is still a folder', async () => {
    // ⛔ The name is main's own, but a folder called `pasted-<32 hex>.png` is a legal thing to
    // attach — and `kind` comes from `stat`, so the two facts together decide it.
    installBridge()
    const view = composer({ attachments: [{ path: WROTE, kind: 'directory', outsideCwd: true }] })
    await nextTick()

    const chip = view.q('attached-directory')
    expect(chip.textContent).not.toContain('an image you pasted')
    expect(chip.closest('li')!.getAttribute('data-pasted')).toBe('false')
    expect(chip.closest('li')!.querySelector('use')?.getAttribute('href')).toBe('#i-folder')
  })

  it('🔴 …and a FORGED measurement on an ordinary path decorates nothing', async () => {
    // ⛔ **`app:classify-attachments` applies no schema** and `captionHandedPaths` spreads what it is
    // given, so a `pasted` on an arbitrary path came back wearing main's authority — and the chip
    // trusted it enough to hide the real path behind *"an image you pasted"*. ⚑ The name is the
    // authority now, so the measurements can only ever decorate something that already says what it
    // is (232 §1's rule, held at the caption door as well as at the send door).
    installBridge()
    const view = composer({
      attachments: [{ path: '/work/alpha/id_rsa', kind: 'file', outsideCwd: false, pasted: SIZE }],
    })
    await nextTick()

    const chip = view.q('attached-file')
    expect(chip.textContent).toContain('id_rsa')
    expect(chip.textContent).not.toContain('an image you pasted')
    expect(chip.closest('li')!.getAttribute('data-pasted')).toBe('false')
  })

  it('⚑ …and the paired negative: an ordinary attachment still shows its FILENAME and a file glyph', async () => {
    // ⛔ Without this, a composer that had simply stopped showing filenames would satisfy every
    // assertion above and `216`'s chip would be gone rather than joined.
    installBridge()
    const view = composer({
      attachments: [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }],
    })
    await nextTick()

    const chip = view.q('attached-file')
    expect(chip.textContent).toContain('notes.md')
    expect(chip.textContent).not.toContain('an image you pasted')
    const row = chip.closest('li')!
    expect(row.getAttribute('data-pasted')).toBe('false')
    expect(row.querySelector('use')?.getAttribute('href')).toBe('#i-file')
    expect(view.q('detach-file').getAttribute('title')).toBe('Don’t send /work/alpha/notes.md')
  })
})

describe('the other clipboards (254 §2)', () => {
  it('🔴 a FILE copied in Finder goes through the drop’s door — BroBot writes no second copy', async () => {
    // ⚠️ **A pasted file already exists.** Writing a copy of it would hand the agent a path nobody
    // could find again, and would spend disk to say something the original already says.
    installBridge()
    const view = composer()

    await paste(view, copied('report.pdf', '/work/alpha/report.pdf'))

    expect(bridge.asked).toEqual([{ paths: ['/work/alpha/report.pdf'], cwd: '/work/alpha' }])
    expect(bridge.pasted, 'the clipboard was read for a file that was already on disk').toEqual([])
    expect(view.q('attached-file').textContent).toContain('report.pdf')
  })

  it('🔴 a clipboard with BOTH is asked about in the right order — the pasteboard first (268 §2)', async () => {
    // ⛔ **The window this order exists to keep small.** `handDroppedPaths` stats and real-resolves
    // every path it is given; on a stalled network mount that takes seconds, and every one of those
    // seconds is time in which a clipboard manager — or Universal Clipboard — can put something
    // else on the pasteboard. Main would then read, write and stage THAT, behind a chip with no
    // filename and no preview, so there would be nothing on screen that could say so.
    //
    // ⚠️ **This is the assertion `254 M40` needed and did not have** (`260` §5). That row claimed to
    // put the defect back and moved `await classify(paths)` only across a comment — the execution
    // order was identical, all four projects stayed green, and the row was recorded as a survivor of
    // a protection that was never tested. ⛔ The source census in `one-way-to-stage.test.ts` compares
    // two `indexOf`s: true of the text, silent about what ran. **This runs it.**
    installBridge()
    const view = composer()

    // A file copied in Finder (it has a path) AND a screenshot (it has none), on one clipboard —
    // which is the only shape where both doors open and the order between them is observable.
    await paste(view, copied('report.pdf', '/work/alpha/report.pdf'), screenshot())

    expect(bridge.pasted, 'main was never asked about the clipboard').toHaveLength(1)
    expect(bridge.asked, 'main was never asked about the path').toHaveLength(1)
    expect(
      bridge.order,
      'the path round trip ran FIRST — that is the window a second clipboard writer gets',
    ).toEqual(['pasteImage', 'handDroppedPaths'])
    // ⚑ …and the paired positive: both halves still landed, so this is not an ordering assertion
    // over a gesture that quietly did nothing.
    expect(view.all('attached-file')).toHaveLength(2)
  })

  it('⛔ a paste with no files at all touches NOTHING — and the words still land in the box', async () => {
    // ⚠️ **The commonest paste in the app by far.** A handler that opened a bridge for every ⌘V
    // would put an IPC round trip in front of pasting a sentence.
    installBridge()
    const view = composer()

    const event = await paste(view)

    expect(bridge.asked).toEqual([])
    expect(bridge.pasted).toEqual([])
    // 🔴 **`preventDefault` is deliberately not called, ever** (254 §2). A clipboard carrying an
    // image AND text is ordinary, and swallowing the event would lose the text; a textarea ignores
    // an image on its own, so there is nothing to suppress.
    expect(event.defaultPrevented, 'the paste was swallowed — the pasted words are gone').toBe(
      false,
    )
  })

  it('⛔ …and neither is it prevented when a picture IS staged, for the same reason', async () => {
    installBridge()
    const view = composer()

    const event = await paste(view, screenshot())

    expect(bridge.pasted).toHaveLength(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('🔴 one picture comes off the clipboard, and the rest are SAID rather than dropped', async () => {
    // ⚑ `clipboard.readImage()` is ONE answer, so a paste with several pathless entries can only
    // become one attachment — and `106`'s rule is that what did not make it gets a sentence.
    installBridge()
    const view = composer()

    await paste(view, screenshot(), screenshot(), screenshot())

    expect(bridge.pasted).toHaveLength(1)
    expect(view.all('attached-file')).toHaveLength(1)
    expect(view.q('attach-refused').textContent).toContain(onlyOnePastedImage(2))
  })
})

describe('when a paste cannot become an attachment (254 §2)', () => {
  it('🔴 main’s refusal is shown, verbatim, where the gesture happened', async () => {
    // `106`/`118`/`169`: the gesture is not allowed to happen and then quietly do nothing.
    installBridge()
    bridge.answer = { refusal: NO_IMAGE_ON_CLIPBOARD }
    const view = composer()

    await paste(view, screenshot())

    expect(view.q('attach-refused').textContent).toContain(NO_IMAGE_ON_CLIPBOARD)
    expect(view.all('attached-file')).toEqual([])
  })

  it('⛔ a composer that cannot stage does not read the clipboard at all', async () => {
    // ⚠️ **One predicate for every gesture** (218's acceptance 7). A composer that greys the
    // paperclip, refuses a drop, and then quietly saves a screenshot to disk would be three answers
    // to one question — and this is the gesture where the side effect is a FILE.
    installBridge()
    const view = composer({ state: 'ended' })

    await paste(view, screenshot())

    expect(bridge.pasted).toEqual([])
    expect(bridge.asked).toEqual([])
  })

  it('🔴 a clipboard carrying TEXT is a text paste, whatever picture rides along with it', async () => {
    // ⛔ **The finding that mattered most in this file** (review). A pathless `File` was taken as
    // *"a screenshot"*, and it is not: copying a range out of Numbers, a table out of a web page or
    // a block out of Word puts plain text AND a picture of it on the pasteboard, and Chromium hands
    // both over. ⚠️ **Every one of those pastes would have staged a bitmap of the thing the person
    // was pasting as words** — with a chip that says only *"an image you pasted"*, no filename and
    // no preview, so there was nothing on screen that could have told them.
    installBridge()
    const view = composer()

    await pasteWith({ text: 'quarterly numbers' }, view, screenshot())

    expect(bridge.pasted, 'a spreadsheet paste staged a picture of itself').toEqual([])
    expect(view.all('attached-file')).toEqual([])
    // ⚑ …and nothing is refused either: a text paste doing what a text paste does owes no sentence.
    expect(view.all('attach-refused')).toEqual([])
  })

  it('🔴 …and an EMPTY text flavour does not count as text', async () => {
    // ⛔ **Clipboard managers, Universal Clipboard and several capture tools re-put an image with an
    // empty `text/plain` beside it** (review). A discriminator that read only `types` swallowed those
    // pastes in total silence — no chip, no refusal, no IPC — which is the `106` failure the rest of
    // this gesture is built to avoid, arriving through the fix for a different one.
    installBridge()
    const view = composer()

    await pasteWith({ text: '   ' }, view, screenshot())

    expect(bridge.pasted, 'a picture was swallowed by an empty text flavour').toHaveLength(1)
    expect(view.q('attached-file').textContent).toContain('an image you pasted')
  })

  it('⚑ …and the paired positive: the SAME picture with no text on the clipboard is staged', async () => {
    // ⛔ Without this, a composer that had simply stopped reading the clipboard would satisfy the
    // test above and the whole feature would be gone rather than narrowed.
    installBridge()
    const view = composer()

    await pasteWith({ text: null }, view, screenshot())

    expect(bridge.pasted).toHaveLength(1)
    expect(view.q('attached-file').textContent).toContain('an image you pasted')
  })

  it('🔴 a composer with no ROOM does not write a file it would then refuse', async () => {
    // ⛔ **The orphan** (review, three angles). `canStage` is true at 9 of 10, so pasting a
    // Finder-copied file together with a screenshot wrote the PNG, then `stage()` gave the last slot
    // to the file and refused the picture — leaving bytes on disk that no chip, no draft and no
    // transcript ever referenced, for the whole TTL. ⚑ The ceiling is `stage()`'s to enforce; this
    // is a precondition on the SIDE EFFECT, and it says so out loud rather than falling silent.
    installBridge()
    const view = composer({
      attachments: Array.from({ length: MAX_HANDED_PATHS - 1 }, (_, at) => ({
        path: `/work/alpha/f${at}.md`,
        kind: 'file' as const,
        outsideCwd: false,
      })),
    })
    await nextTick()

    await paste(view, copied('report.pdf', '/work/alpha/report.pdf'), screenshot())

    expect(bridge.pasted, 'a file was written into a message that had no room for it').toEqual([])
    expect(view.q('attach-refused').textContent).toContain(noRoomForPastedImage())
    expect(view.q('attach-refused').textContent).toContain('nothing was written')
  })

  it('🔴 …and a composer that is already full SAYS SO — it does not swallow the gesture', async () => {
    // ⛔ **`288` M3, and the half this test used to leave unasserted.** It checked only that no file
    // was written — which was right and was never the complaint. `onPaste` returned on `canStage`,
    // which folds the ceiling into "can this surface attach at all", so at ten staged ⌘V produced
    // no file (right), no chip, no refusal — and, because an image-only paste inserts no text
    // either, **the entire gesture disappeared**. ⚑ `106` on the one gesture with no control of its
    // own to grey.
    installBridge()
    const view = composer({
      attachments: Array.from({ length: MAX_HANDED_PATHS }, (_, at) => ({
        path: `/work/alpha/f${at}.md`,
        kind: 'file' as const,
        outsideCwd: false,
      })),
    })
    await nextTick()

    await paste(view, screenshot())

    // 🔒 The ceiling is still checked BEFORE the clipboard is read, so a full composer never writes
    // a file it would then have to refuse.
    expect(bridge.pasted).toEqual([])
    // 🔴 …and now it is SAID, in the same sentence the nine-files-plus-paste case produces.
    const refused = view.q('attach-refused')
    expect(visible(refused)).toBe(true)
    expect(refused.textContent).toContain(noRoomForPastedImage())
    expect(refused.textContent).toContain('nothing was written')
    // ⛔ **…and a Finder-copied FILE at the ceiling is refused BY NAME rather than as "a picture"**
    // (found reviewing this dispatch's own diff). ⚠️ **This is a behaviour change beyond the
    // finding and it is deliberate**: letting the gesture through means main is asked to `stat`
    // the path, which is a read and not the WRITE the ceiling exists to prevent, and the answer is
    // the ceiling sentence the drop already produces. One rule, one place — the alternative was a
    // second ceiling written into the paste handler.
    installBridge()
    const full = composer({
      attachments: Array.from({ length: MAX_HANDED_PATHS }, (_, at) => ({
        path: `/work/alpha/f${at}.md`,
        kind: 'file' as const,
        outsideCwd: false,
      })),
    })
    await nextTick()
    await paste(full, copied('report.pdf', '/work/alpha/report.pdf'))
    expect(
      bridge.pasted,
      'no picture was written, which is the half that was always right',
    ).toEqual([])
    expect(
      bridge.asked,
      'the path was dropped without a word instead of being judged',
    ).toHaveLength(1)
    expect(full.q('attach-refused').textContent).toContain(`can carry ${MAX_HANDED_PATHS}`)

    // ⚑ **The paired negative**: a mount that cannot attach at all is still silent, which is the
    // fact `canStage` was conflating this one with. A composer with no paperclip has no ceiling to
    // be at and nothing to explain.
    installBridge()
    const plain = composer({ canAttach: false })
    await nextTick()
    await paste(plain, screenshot())
    expect(bridge.pasted).toEqual([])
    expect(plain.all('attach-refused')).toEqual([])
  })
})

/**
 * # 🔴 Send, pressed while the picture is still being written (262 §1)
 *
 * ⛔ **`259` lens C, finding 1, and it was BLOCKING.** The composer held `please inspect this`, the
 * person pasted a screenshot and pressed Send before main had finished writing it: `send()` read an
 * empty `staged`, emitted the text-only turn and cleared the box, and the paste then dropped its
 * chip into a draft that no longer existed — so the NEXT message carried a screenshot nobody had
 * attached to it.
 *
 * ⚠️ **The whole reason this file could not see it** is at {@link Bridge.hold}: the stub answered in
 * the same microtask, so the interval did not exist. Every test here holds main open.
 */
describe('a Send that outruns the paste (262 §1)', () => {
  it('🔴 does NOT emit the message without the picture — and the picture rides THIS one', async () => {
    installBridge()
    bridge.hold.add('pasteImage')
    const view = composer({ draft: 'please inspect this' })
    await nextTick()

    await beginPaste(view, screenshot())
    // ⛔ The gesture reached main, so the interval below is the real one and not an early return.
    expect(bridge.pasted, 'the clipboard was never read — nothing was in flight').toHaveLength(1)
    // ⚑ …and the person can see why the press is about to take a beat.
    expect(visible(view.q('composer-acquiring'))).toBe(true)

    await press(view)

    // 🔴 **The defect, stated as an assertion.** This was one `send` carrying `please inspect this`
    // and no attachment at all.
    expect(sent, 'the message went out without the picture it is about').toEqual([])
    // ⚠️ …and the words are still in the box, so nothing was consumed by the press either.
    expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('please inspect this')

    await release(view)

    // ⛔ One message, with the screenshot on it.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('please inspect this')
    expect(sent[0]?.handed.map((each) => each.path)).toEqual([WROTE])
    // ⚑ …and the caption is gone with the wait it was describing.
    expect(view.all('composer-acquiring')).toEqual([])
  })

  it('⛔ …and the screenshot does not ride the NEXT message either', async () => {
    // ⛔ **The other half of the finding.** Even once the send waits, a composer that failed to
    // clear would put the same picture on the following message — which is the shape the reviewer
    // named as the silent one, since the chip looks identical.
    installBridge()
    bridge.hold.add('pasteImage')
    const view = composer({ draft: 'please inspect this' })
    await nextTick()

    await beginPaste(view, screenshot())
    await press(view)
    await release(view)

    // The composer came back empty — no chip left behind for the next message to pick up.
    expect(view.all('composer-attachments')).toEqual([])
    expect(staged()).toEqual([])

    await type(view, 'and now something else')
    await press(view)
    await nextTick()

    expect(sent).toHaveLength(2)
    expect(sent[1]?.text).toBe('and now something else')
    expect(sent[1]?.handed, 'the old screenshot rode a message it was never attached to').toEqual(
      [],
    )
  })

  it('⚑ the paired positive: with nothing in flight the press is not delayed at all', async () => {
    // ⛔ **Without this, a composer that had simply stopped sending would satisfy both tests
    // above.** It also pins that the wait is CONDITIONAL: `send` emits in the same turn of the
    // event loop when there is nothing to wait for, which is the state the app is in for every
    // message that carries no attachment.
    installBridge()
    const view = composer({ draft: 'just words' })
    await nextTick()

    const button = view.q('send-prompt') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()

    // ⚠️ **Asserted BEFORE any tick.** A `nextTick` here would make the claim vacuous — it would
    // pass for a send that had been queued behind an await as well as one that had not.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('just words')
    expect(view.all('composer-acquiring')).toEqual([])
  })

  it('🔴 the fence is the PRIMITIVE, not the screenshot: a drop holds the send the same way', async () => {
    // ⚑ **The reviewer asked for one primitive rather than a special case** — async drop and picker
    // classification have the identical shape, and `handDroppedPaths` on a stalled network volume
    // is the same interval as a paste being encoded.
    installBridge()
    bridge.hold.add('handDroppedPaths')
    const view = composer({ draft: 'look at this file' })
    await nextTick()

    const data = new DataTransfer()
    data.items.add(copied('report.pdf', '/work/alpha/report.pdf'))
    form(view).dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
    )
    await nextTick()
    expect(bridge.asked).toHaveLength(1)

    await press(view)
    expect(sent, 'the drop’s file missed the message it was dropped on').toEqual([])

    await release(view)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.handed.map((each) => each.path)).toEqual(['/work/alpha/report.pdf'])
  })

  /**
   * # 🔴 Two presses on one draft are ONE submission (292 §1, from `288` H1)
   *
   * ⛔ **`262` made Send wait, and the wait is the window.** Measured before the fix, on this exact
   * harness: two presses produced **two** `send` emissions — the first carrying `inspect this` and
   * the screenshot, the second carrying `inspect this` and **nothing at all**, because the draft
   * the composer reads is the parent's and Vue had not patched it yet.
   *
   * ⚑ **Tenth recorded instance of a correct fix moving a cost somewhere nobody was looking.**
   */
  it('🔴 two presses while the picture is being written are ONE send, not two', async () => {
    installBridge()
    bridge.hold.add('pasteImage')
    const view = composer({ draft: 'inspect this' })
    await nextTick()

    await beginPaste(view, screenshot())
    expect(bridge.pasted, 'the clipboard was never read — nothing was in flight').toHaveLength(1)

    const button = view.q('send-prompt') as HTMLButtonElement
    expect(button.disabled, 'the Send button was dark — the presses proved nothing').toBe(false)
    // ⚠️ **Two real presses of the real button**, with no tick between them: that is what an
    // impatient double-press is, and the gap `262` opened is measured in microtasks.
    button.click()
    button.click()
    await nextTick()

    // Still nothing — the wait is doing its job, which is what makes the window exist at all.
    expect(sent).toEqual([])

    await release(view)

    // 🔴 **The defect, stated as an assertion.** This was two: the second with the same words and
    // no attachment.
    expect(sent, 'one intended submission became two runtime sends').toHaveLength(1)
    expect(sent[0]?.text).toBe('inspect this')
    expect(sent[0]?.handed.map((each) => each.path)).toEqual([WROTE])
    // ⚑ …and the box really did clear, so "one" is not a composer that stopped sending.
    expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('')
  })

  it('⚑ …and a ⇧⌘↵ that arrives DURING the wait still means interrupt-and-send', async () => {
    // ⛔ **Coalescing must not swallow the second press's MEANING** (106). The first press queues,
    // the second asks to interrupt — one message either way, but which one is a decision the person
    // made and the app must not quietly discard.
    installBridge()
    bridge.hold.add('pasteImage')
    const view = composer({ draft: 'stop and look at this', state: 'busy', who: 'Codex' })
    await nextTick()

    await beginPaste(view, screenshot())
    // Queue first — the plain chord.
    ;(view.q('queue-prompt') as HTMLButtonElement).click()
    await nextTick()
    // …then change your mind, while the picture is still being written.
    ;(view.q('interrupt-send-prompt') as HTMLButtonElement).click()
    await nextTick()

    await release(view)

    expect(sent).toHaveLength(1)
    expect(intents, 'the second press was dropped on the floor').toEqual(['interrupt'])
  })

  it('⚑ …and the paired negative: two presses a tick apart with nothing in flight are two sends', async () => {
    // ⛔ **Without this, a composer that had simply stopped honouring the second press would pass
    // the test above.** The latch is about ONE submission that is waiting, not about rate-limiting
    // the button: type, send, type, send is two messages and must stay two.
    installBridge()
    const view = composer({ draft: 'first' })
    await nextTick()

    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await flush(view)
    await type(view, 'second')
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await flush(view)

    expect(sent.map((each) => each.text)).toEqual(['first', 'second'])
  })
})

/**
 * # 🔴 A picture pasted in A belongs to A, wherever you are looking when it lands (292 §2, `288` H2)
 *
 * ⛔ **Measured before the fix**: paste in A, select B, let main answer — and the image reached
 * **neither**. `ConversationPane` keys the composer by session id, so switching tears it down, and
 * Vue drops emissions from an unmounted component; the write had nowhere to go. ⚠️ A's text draft
 * survived, so the remaining half looked complete.
 *
 * ⚑ **The host below is `RuntimeScreen`'s own shape**: one book, one composer, keyed by the draft
 * on screen. Nothing in this repository mounts `RuntimeScreen` (`211` §11, `212` §9, `214` §8),
 * which is exactly why the rule lives in the book and can be driven here.
 */
describe('a conversation switched mid-paste (292 §2)', () => {
  const A = 'session:alpha'
  const B = 'session:beta'

  function twoDrafts(): {
    book: ReturnType<typeof createAttachmentBook>
    go: (key: string) => void
    view: Mounted
  } {
    const book = createAttachmentBook()
    const which = ref(A)
    const words: Record<string, string> = { [A]: 'look at this', [B]: 'other thread' }
    const Host = defineComponent({
      name: 'TwoDraftsHost',
      setup() {
        return () =>
          h(PromptComposer as Component, {
            key: which.value,
            state: 'idle',
            cwd: '/work/alpha',
            canAttach: true,
            draft: words[which.value],
            handing: book.handing(which.value),
            onSend: (text: string, _intent: string, handed: HandedPath[]) => {
              sent.push({ text, handed })
            },
          })
      },
    })
    sent = []
    intents = []
    return { book, go: (key) => (which.value = key), view: mount(Host, {}, { width: 900 }) }
  }

  it('🔴 the screenshot lands in A even though B is on screen when it arrives', async () => {
    installBridge()
    bridge.hold.add('pasteImage')
    const { book, go, view } = twoDrafts()
    await nextTick()

    await beginPaste(view, screenshot())
    expect(bridge.pasted).toHaveLength(1)

    go(B)
    await nextTick()
    // ⛔ The composer that began the gesture is gone — this is the state the defect needed.
    expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('other thread')

    await release(view)

    // 🔴 **The finding.** Before 292 this was `[]`, and so was B's.
    expect(book.read(A).map((each) => each.path)).toEqual([WROTE])
    // ⚑ **…and the paired negative that matters more than usual**: it did NOT land on B. A late
    // result committing to "whatever draft is on screen" would be `019`'s bug with a filename on
    // it — B's agent handed A's picture.
    expect(book.read(B), 'A’s screenshot was staged into the conversation you switched to').toEqual(
      [],
    )
  })

  it('🔴 …and coming back to A finds the work still open, so Send still waits for it', async () => {
    // ⛔ **The half a hand-off could not buy.** A composer that merely posted its result somewhere
    // durable would leave the REMOUNTED composer with no idea anything was in flight — so a press
    // one second after returning to A would emit the message without the picture, which is `262`'s
    // defect re-opened by a conversation switch. The work belongs to the draft, so it is still
    // there when the draft comes back.
    installBridge()
    bridge.hold.add('pasteImage')
    const { book, go, view } = twoDrafts()
    await nextTick()

    await beginPaste(view, screenshot())
    go(B)
    await nextTick()
    go(A)
    await nextTick()

    // The caption is back, on a composer that never started the gesture.
    expect(visible(view.q('composer-acquiring'))).toBe(true)
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    expect(sent, 'the returned composer sent without waiting for A’s picture').toEqual([])

    await release(view)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.handed.map((each) => each.path)).toEqual([WROTE])
    expect(book.read(A)).toEqual([])
  })

  it('⛔ …and a REFUSAL raised for A waits in A too', async () => {
    // ⚠️ **A sentence shown only while its conversation is on screen is half a disclosure.** *"There
    // is no picture on the clipboard"* answered for A while B was up had nowhere to go at all.
    installBridge()
    bridge.hold.add('pasteImage')
    bridge.answer = { refusal: NO_IMAGE_ON_CLIPBOARD }
    const { go, view } = twoDrafts()
    await nextTick()

    await beginPaste(view, screenshot())
    go(B)
    await nextTick()
    await release(view)

    // ⚑ Not on B — the refusal is A's, and B did nothing.
    expect(view.all('attach-refused')).toEqual([])

    go(A)
    await nextTick()

    expect(view.q('attach-refused').textContent).toContain(NO_IMAGE_ON_CLIPBOARD)
  })
})

describe('a Send that outruns the paste, continued (262 §1)', () => {
  it('⛔ an empty box with a screenshot on the way is still a message worth sending', async () => {
    // 🔴 **The second defect the ordering closed** (found writing this). The wait sits ABOVE
    // `canSend`, because with no words typed and the picture still being written there is nothing
    // for `canSend` to say yes to — so ⌘↵ pressed a moment after ⌘V used to be dropped in silence
    // and the chip then appeared over a composer nobody had sent. ⚑ *"here, look at this"* with no
    // words is a real thing to mean; `216` settled that and this is the same rule one await later.
    installBridge()
    bridge.hold.add('pasteImage')
    const view = composer()
    await nextTick()

    await beginPaste(view, screenshot())
    // ⚠️ The BUTTON is honestly dark here — there is nothing staged yet — so the press has to come
    // through the shortcut, which is exactly how a fast typist would send this.
    expect((view.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
    view.q('prompt-input').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await nextTick()
    expect(sent).toEqual([])

    await release(view)

    expect(
      sent,
      'the press was swallowed and the picture staged over an unsent composer',
    ).toHaveLength(1)
    expect(sent[0]?.text).toBe('')
    expect(sent[0]?.handed.map((each) => each.path)).toEqual([WROTE])
  })
})
