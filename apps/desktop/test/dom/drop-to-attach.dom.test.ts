import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import type { ChosenAttachment, DroppedPathVerdict, HandedPath } from '../../src/shared/runtime-ipc'
import { channelGap, mount, paintedBackground, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⛔ Drop it on the composer (218 §2/§3)
 *
 * Drag and drop is another gesture reaching the same attachment model as the picker and
 * launcher.
 *
 * ## ⚠️ What this file can and cannot prove, said before any of it is read
 *
 * ⛔ **A DOM test cannot produce a real drag.** The `File` objects below are synthesised with
 * `new File(...)`; they have no file behind them, no path, and `webUtils.getPathForFile` — which is
 * a preload module — is not reachable from a test page at all. So the bridge is stubbed here and
 * what is asserted is the COMPOSER's half: which paths it resolves, what it sends across, what it
 * stages, what it refuses, and what it paints while you are still holding the drag.
 *
 * ⚑ **The other half is measured live**, in `ui-live-smoke.mjs` step `11f`, where a real Electron
 * window with the real preload receives a CDP-dispatched drag over a file this run created. The two
 * together are the claim; neither alone is.
 *
 * ⚠️ **And `dropping` is asserted as PAINT, not as a class name** — the standing
 * `brobot2-ssr-tests-pass-vacuously` rule. *"You could not tell it would accept the drop"* is the
 * kind of finding these tests exist for.
 */

interface Bridge {
  /** Path per synthesised `File`, keyed by name — the preload's `getPathForFile`, stubbed. */
  paths: Map<string, string>
  /** What main answered, keyed by path. */
  verdicts: Map<string, DroppedPathVerdict>
  /** Every `handDroppedPaths` call, so the request can be asserted as well as the answer. */
  asked: { paths: string[]; cwd?: string }[]
  /** What the picker will return, for the gesture-parity test. */
  picked: ChosenAttachment
}

let bridge: Bridge
/**
 * ⛔ **The draft the test owns** (292 §2) — a transaction rather than a list, for the reason
 * {@link PromptComposer}'s `handing` prop gives: an operation begun here can be answered after the
 * composer that began it is gone, and a list cannot hold one.
 */
const DRAFT = 'session:alpha'
let book = createAttachmentBook()
const staged = (): HandedPath[] => book.read(DRAFT)
/** How many times the owning parent has re-rendered — the teeth of the two-drop window test. */
let renders = 0
/** The PARENT's own setter, so a test can change the list the way the app does (236 §4). */
let ownerSets: (next: HandedPath[]) => void = () => {}

function file(path: string): HandedPath {
  return { path, kind: 'file', outsideCwd: false }
}

function folder(path: string): HandedPath {
  return { path, kind: 'directory', outsideCwd: false }
}

/** A synthesised `File` the stub can recognise, plus the path it stands for. */
function dropped(name: string, path: string): File {
  bridge.paths.set(name, path)
  return new File(['—'], name, { type: 'text/plain' })
}

/** A `File` with NO path behind it: dragged text, a browser image, a remote volume. */
function pathless(name: string): File {
  bridge.paths.set(name, '')
  return new File(['—'], name, { type: 'text/plain' })
}

function installBridge(): void {
  bridge = { paths: new Map(), verdicts: new Map(), asked: [], picked: null }
  ;(window as unknown as { api: unknown }).api = {
    pathForDroppedFile: (each: File): string => bridge.paths.get(each.name) ?? '',
    handDroppedPaths: async (input: { paths: string[]; cwd?: string }) => {
      bridge.asked.push(input)
      return input.paths.map(
        (path): DroppedPathVerdict =>
          bridge.verdicts.get(path) ?? { handed: { path, kind: 'file', outsideCwd: false } },
      )
    },
    chooseAttachment: async (): Promise<ChosenAttachment> => bridge.picked,
  }
}

/**
 * ⚠️ **Mounted under a parent that OWNS the attachments** — `019`'s rule, and `attach-path`'s shape.
 * A test that handed the composer a plain array would assert over an arrangement the app
 * deliberately does not have.
 */
function composer(over: Record<string, unknown> = {}): Mounted {
  book = createAttachmentBook()
  book.write(DRAFT, (over['attachments'] as HandedPath[] | undefined) ?? [])
  ownerSets = (next) => book.write(DRAFT, next)
  const rest = { ...over }
  delete rest['attachments']
  renders = 0
  const Host = defineComponent({
    name: 'DropHost',
    setup() {
      return () => {
        renders += 1
        return h(PromptComposer as Component, {
          state: 'idle',
          draft: '',
          cwd: '/work/alpha',
          canAttach: true,
          ...rest,
          handing: book.handing(DRAFT),
        })
      }
    },
  })
  return mount(Host, {}, { width: 900 })
}

/**
 * A `DataTransfer` carrying files — built with the real browser API, not a shape that looks like one.
 *
 * ⚑ `items.add` is what makes `types` report `'Files'`, which is the only thing the composer can ask
 * during a drag; a hand-rolled object would let the target light up on a payload the browser would
 * never have described that way.
 */
function carrying(...files: File[]): DataTransfer {
  const data = new DataTransfer()
  // What a real Finder drag reports. Left at the constructor's `'none'`, the browser refuses every
  // `dropEffect` we set as inconsistent with it — an artefact of a synthesised transfer, not a
  // difference in the app.
  data.effectAllowed = 'all'
  for (const each of files) data.items.add(each)
  return data
}

function carryingText(): DataTransfer {
  const data = new DataTransfer()
  data.effectAllowed = 'all'
  data.items.add('https://example.com/docs', 'text/uri-list')
  return data
}

function form(view: Mounted): HTMLElement {
  return view.q('composer-band').querySelector('form')!
}

function drag(
  view: Mounted,
  kind: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  data?: DataTransfer,
): DragEvent {
  const event = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: data })
  form(view).dispatchEvent(event)
  return event
}

/**
 * Enter the composer and let Vue render.
 *
 * ⚠️ **The tick is not a fudge and it is not a delay a person can perceive.** Vue batches, so the
 * target appears on the next frame — and `dragover` fires continuously at frame rate for as long as
 * you hold the drag, so "one tick after the first `dragenter`" is the beginning of the gesture, not
 * the end of it. What would be a defect is a target that needed the DROP to appear.
 */
async function dragInto(view: Mounted, data: DataTransfer): Promise<void> {
  drag(view, 'dragenter', data)
  await nextTick()
}

async function dropOn(view: Mounted, ...files: File[]): Promise<void> {
  const data = carrying(...files)
  drag(view, 'dragenter', data)
  drag(view, 'dragover', data)
  drag(view, 'drop', data)
  // Three ticks: the bridge round trip inside `onDrop`, the emit it ends in, and the parent's
  // re-render that puts the chips on screen.
  await nextTick()
  await nextTick()
  await nextTick()
}

let view: Mounted | null = null

afterEach(() => {
  view = null
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('the drop target, while you are still holding it (218 §2)', () => {
  it('⛔ is not there at rest, and IS there while files are over the composer', async () => {
    installBridge()
    view = composer()
    // The paired negative first: a composer that always said "drop to attach" would pass the
    // positive below and be telling you something untrue for the whole of its life.
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()

    await dragInto(view, carrying(dropped('notes.md', '/work/alpha/notes.md')))

    const hint = view.q('composer-drop-target')
    expect(visible(hint)).toBe(true)
    expect(hint.textContent).toContain('Drop to attach')
    // ⛔ …and it says what BroBot will do with it, which is the one thing about this feature a
    // person cannot infer: the agent reads the file, BroCrew does not (215/216).
    expect(hint.textContent).toContain('BroCrew does not')
  })

  it('⛔ …and it does NOT light up for dragged TEXT, which has no path behind it', async () => {
    // ⚠️ `types` is all a page may read during a drag — the files themselves are withheld until you
    // let go. So the offer is made on the promise of files, and a URL dragged from a browser must
    // not produce one: it would be inviting a gesture that can only end in the refusal below.
    installBridge()
    view = composer()

    await dragInto(view, carryingText())
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('⛔ …nor on a composer that does not offer the paperclip', async () => {
    // ⚑ ONE predicate behind both (`canStage`): a surface that greyed the button and still took a
    // drop would be two answers to "can you attach right now". That is what acceptance 7 is about.
    installBridge()
    view = composer({ canAttach: false })

    await dragInto(view, carrying(dropped('notes.md', '/work/alpha/notes.md')))
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('⛔ …nor while a launch is in flight, where there is nothing to attach TO', async () => {
    installBridge()
    view = composer({ state: 'starting' })

    await dragInto(view, carrying(dropped('notes.md', '/work/alpha/notes.md')))
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('🔴 the composer is PAINTED differently while a drop is offered — not merely class-marked', async () => {
    // ⛔ The standing rule: a class name is not a thing a person can see. `paintedBackground`
    // COMPOSITES the translucent fill over what is behind it, so this is the colour that reaches
    // the screen rather than the one written in the stylesheet.
    installBridge()
    view = composer()
    const before = paintedBackground(form(view))

    await dragInto(view, carrying(dropped('notes.md', '/work/alpha/notes.md')))
    const during = paintedBackground(form(view))

    // Far enough apart to see across a dim panel — not a one-channel nudge that measures as a
    // change and reads as no change at all.
    expect(channelGap(before, during)).toBeGreaterThan(8)
  })

  it('🔴 …and it appears for a `dragover` that arrived with NO `dragenter` before it', async () => {
    // ⛔ **A regression pinned by a live measurement, not by reasoning.** `218`'s smoke drove a real
    // file over this composer through Chromium's own drag pipeline and the page received
    // `dragover[text/uri-list|Files]` twice with no `dragenter` at all — so the first version of
    // this feature, which counted only enters, stayed dark for a drag that was plainly over it and
    // the step failed with "no drop target appeared".
    // ⚠️ HTML5 says an enter precedes every over. The pipeline that will drive this feature for the
    // rest of its life disagrees, and the measurement wins.
    installBridge()
    view = composer()
    const data = carrying(dropped('notes.md', '/work/alpha/notes.md'))

    drag(view, 'dragover', data)
    await nextTick()

    expect(visible(view.q('composer-drop-target'))).toBe(true)

    // ⚑ …and it still goes away, so the shortcut has not made the target permanent.
    drag(view, 'dragleave')
    await nextTick()
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('⛔ …and a `dragover` carrying no files still lights nothing, enter or no enter', async () => {
    // The paired negative for the line above: the shortcut must not be a way in for a payload the
    // enter path would have refused.
    installBridge()
    view = composer()

    drag(view, 'dragover', carryingText())
    await nextTick()

    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('🔴 …and it goes DARK if the composer stops being able to take it mid-drag', async () => {
    // ⛔ **Found reviewing this dispatch's own diff.** Every handler is gated on `canStage`, so the
    // counter can only be raised when a drop is possible — but `canStage` can go FALSE while a drag
    // is still in the air, and nothing lowers the counter for that. A permission card arriving turns
    // a live conversation `frozen` mid-gesture, and the composer went on saying "Drop to attach"
    // over a drop it would then silently ignore. ⚠️ That is `106`'s exact shape, and the one this
    // feature's own refusal path exists to avoid.
    installBridge()
    const state = ref<string>('idle')
    const own = createAttachmentBook()
    const Host = defineComponent({
      name: 'FreezingHost',
      setup() {
        return () =>
          h(PromptComposer as Component, {
            state: state.value,
            draft: '',
            cwd: '/work/alpha',
            canAttach: true,
            handing: own.handing(DRAFT),
          })
      },
    })
    view = mount(Host, {}, { width: 900 })

    await dragInto(view, carrying(dropped('notes.md', '/work/alpha/notes.md')))
    expect(visible(view.q('composer-drop-target')), 'the target never appeared').toBe(true)

    // The card arrives. The drag is still held.
    state.value = 'frozen'
    await nextTick()

    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
    // ⚑ …and the drop really is refused, so the target going dark is telling the truth.
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))
    expect(own.read(DRAFT)).toEqual([])
    expect(bridge.asked).toEqual([])
  })

  it('⛔ dragging ACROSS the composer’s own children does not flicker the target off', async () => {
    // ⚠️ `dragenter` on the textarea fires before `dragleave` on the chip strip, so a boolean set
    // on enter and cleared on leave switches the invitation off exactly as your cursor reaches the
    // field it is inviting you to drop on. A counter is what makes it survive the crossing.
    installBridge()
    view = composer()
    const data = carrying(dropped('notes.md', '/work/alpha/notes.md'))

    drag(view, 'dragenter', data)
    drag(view, 'dragenter', data)
    drag(view, 'dragleave')
    await nextTick()
    expect(visible(view.q('composer-drop-target'))).toBe(true)

    drag(view, 'dragleave')
    await nextTick()
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('⛔ dragover is ACCEPTED — without which no drop event ever arrives here', async () => {
    // The one line that turns an element into a drop target. `218` §1 measured that a drag falling
    // through to the window is harmless (the navigation guard refuses a `file:` document, so no
    // conversation is released) — but harmless is not useful.
    installBridge()
    view = composer()
    const data = carrying(dropped('notes.md', '/work/alpha/notes.md'))
    await dragInto(view, data)

    expect(drag(view, 'dragover', data).defaultPrevented).toBe(true)
    // ⚠️ **`dropEffect` is deliberately NOT asserted, and this is the second thing a DOM test
    // cannot produce.** The handler sets it to `'copy'` so a real drag shows the `+` cursor, but a
    // `DataTransfer` belonging to a synthesised event is in Chromium's read-only mode: the setter
    // is accepted and the value stays `'none'`, whatever the handler did. Measured, not assumed —
    // asserting it here would be asserting a property of the synthesiser. The cursor is one of the
    // things `§9` names as covered by eye rather than by test.

    // ⚑ The paired negative: a text drag is NOT accepted, so it falls through rather than being
    // swallowed by a target that would only refuse it.
    expect(drag(view, 'dragover', carryingText()).defaultPrevented).toBe(false)
  })
})

describe('what a drop actually stages (218 §2, acceptance 3/4)', () => {
  it('🔴 a dropped file is attached, by the path the preload resolved for it', async () => {
    installBridge()
    view = composer()

    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))

    expect(staged()).toEqual([file('/work/alpha/notes.md')])
    expect(visible(view.q('attached-file'))).toBe(true)
    expect(view.q('attached-file').textContent).toContain('notes.md')
    // ⛔ Classified in MAIN, against this conversation's folder — the renderer decides nothing
    // about what a path is. The `cwd` travelling with the request is what makes the `outside`
    // caption possible at all.
    expect(bridge.asked).toEqual([{ paths: ['/work/alpha/notes.md'], cwd: '/work/alpha' }])
    // The target is gone the moment you let go.
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()
  })

  it('🔴 SEVERAL files in one drop all land — not just the last one', async () => {
    // ⛔ **The batch defect this design exists to avoid.** `props.attachments` does not change until
    // the parent re-renders, so a loop emitting `update:attachments` once per file computes every
    // emit from the SAME starting list and the last one wins: three dropped, one staged. Building
    // the whole next list in `stage()` is what makes the batch one update.
    installBridge()
    view = composer()

    await dropOn(
      view,
      dropped('a.md', '/work/alpha/a.md'),
      dropped('b.md', '/work/alpha/b.md'),
      dropped('c.md', '/work/alpha/c.md'),
    )

    expect(staged().map((each) => each.path)).toEqual([
      '/work/alpha/a.md',
      '/work/alpha/b.md',
      '/work/alpha/c.md',
    ])
    expect(view.all('attached-file')).toHaveLength(3)
    // ⚑ ONE round trip for the batch, not one per file.
    expect(bridge.asked).toHaveLength(1)
  })

  it('⛔ a drop ADDS to what is already staged rather than replacing it', async () => {
    installBridge()
    view = composer({ attachments: [file('/work/alpha/first.md')] })

    await dropOn(view, dropped('second.md', '/work/alpha/second.md'))

    expect(staged().map((each) => each.path)).toEqual([
      '/work/alpha/first.md',
      '/work/alpha/second.md',
    ])
  })

  it('⛔ dropping something already attached does not attach it twice', async () => {
    // The same rule the picker has, because it is the same function: the message would name the
    // path twice and the agent would read it twice.
    installBridge()
    view = composer({ attachments: [file('/work/alpha/notes.md')] })

    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))

    expect(staged()).toHaveLength(1)
    expect(view.all('attached-file')).toHaveLength(1)
  })

  it('⛔ the ceiling refuses OUT LOUD instead of silently keeping the first ten', async () => {
    // `106`: dropping twelve files and being told about ten is worse than being told twelve is too
    // many. The button is disabled at the ceiling for the same reason.
    installBridge()
    const full = Array.from({ length: 10 }, (_, at) => file(`/work/alpha/${at}.md`))
    view = composer({ attachments: full.slice(0, 9) })

    await dropOn(view, dropped('x.md', '/work/alpha/x.md'), dropped('y.md', '/work/alpha/y.md'))

    expect(staged()).toHaveLength(10)
    expect(view.q('attach-refused').textContent).toContain('10 attachments')
  })

  it('⛔ …and at the ceiling the composer takes no drop at all', async () => {
    installBridge()
    view = composer({ attachments: Array.from({ length: 10 }, (_, at) => file(`/w/${at}.md`)) })

    await dragInto(view, carrying(dropped('x.md', '/work/alpha/x.md')))
    expect(view.host.querySelector('[data-cy="composer-drop-target"]')).toBeNull()

    await dropOn(view, dropped('x.md', '/work/alpha/x.md'))
    expect(staged()).toHaveLength(10)
    expect(bridge.asked).toEqual([])
  })
})

describe('a drop with no usable path (218 §2, acceptance 5)', () => {
  it('🔴 is REFUSED with a reason, and nothing is asked of main', async () => {
    // ⛔ `getPathForFile` answers `''` for dragged text, a URL, an image from a web page, a file on
    // a remote volume — things the browser calls files and the filesystem does not. `106`/`118`:
    // the gesture is not allowed to happen and then quietly do nothing.
    installBridge()
    view = composer()

    await dropOn(view, pathless('image.png'))

    expect(staged()).toEqual([])
    const refusal = view.q('attach-refused')
    expect(visible(refusal)).toBe(true)
    expect(refusal.textContent).toContain('not a file on this machine')
    // ⚑ Nothing crossed the bridge: there was no path to classify.
    expect(bridge.asked).toEqual([])
  })

  it('⛔ …and a MIXED drop keeps what it can while still saying what it could not', async () => {
    installBridge()
    view = composer()

    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'), pathless('image.png'))

    expect(staged()).toEqual([file('/work/alpha/notes.md')])
    expect(view.q('attach-refused').textContent).toContain('not a file on this machine')
  })

  it('⛔ …and a path MAIN refuses says main’s own sentence, not a generic one', async () => {
    // The refusal a person can act on names the thing that is wrong. `classifyHandedPath`'s
    // sentence travels verbatim, exactly as the picker's does.
    installBridge()
    bridge.verdicts.set('/work/alpha/gone.md', {
      refusal: 'there is nothing at /work/alpha/gone.md',
    })
    view = composer()

    await dropOn(view, dropped('gone.md', '/work/alpha/gone.md'))

    expect(staged()).toEqual([])
    expect(view.q('attach-refused').textContent).toContain(
      'there is nothing at /work/alpha/gone.md',
    )
  })

  it('⛔ …and a specific refusal WINS the one slot over the generic one', async () => {
    installBridge()
    bridge.verdicts.set('/work/alpha/gone.md', {
      refusal: 'there is nothing at /work/alpha/gone.md',
    })
    view = composer()

    await dropOn(view, dropped('gone.md', '/work/alpha/gone.md'), pathless('image.png'))

    // ⚠️ One sentence on screen, and it is the one that names something. Three refusals stacked
    // under a composer is not three times as useful.
    expect(view.all('attach-refused')).toHaveLength(1)
    expect(view.q('attach-refused').textContent).toContain('there is nothing at')
  })

  it('⛔ a successful drop CLEARS a refusal left by an earlier one', async () => {
    installBridge()
    view = composer()
    await dropOn(view, pathless('image.png'))
    expect(view.q('attach-refused').textContent).toContain('not a file on this machine')

    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))

    expect(view.host.querySelector('[data-cy="attach-refused"]')).toBeNull()
  })
})

describe('a dropped FOLDER is one path (218 §3)', () => {
  it('🔴 …and is neither enumerated, expanded, nor counted', async () => {
    // ⛔ The dispatch is explicit: *"a dropped folder is one path… do not enumerate, do not expand,
    // do not count."* `215`'s whole choice was that the AGENT looks inside, with its own tools,
    // behind its own permission card.
    installBridge()
    bridge.verdicts.set('/work/alpha/src', { handed: folder('/work/alpha/src') })
    view = composer()

    await dropOn(view, dropped('src', '/work/alpha/src'))

    expect(staged()).toEqual([folder('/work/alpha/src')])
    // ONE path crossed the bridge, and one chip came back.
    expect(bridge.asked).toEqual([{ paths: ['/work/alpha/src'], cwd: '/work/alpha' }])
    expect(view.all('attached-directory')).toHaveLength(1)
    expect(view.q('attached-directory').textContent).toContain('src')
  })

  it('⛔ a folder and a file in one drop stay two chips, not a directory listing', async () => {
    installBridge()
    bridge.verdicts.set('/work/alpha/src', { handed: folder('/work/alpha/src') })
    view = composer()

    await dropOn(
      view,
      dropped('src', '/work/alpha/src'),
      dropped('notes.md', '/work/alpha/notes.md'),
    )

    expect(staged()).toEqual([folder('/work/alpha/src'), file('/work/alpha/notes.md')])
    expect(view.all('attached-directory')).toHaveLength(1)
    expect(view.all('attached-file')).toHaveLength(1)
  })
})

describe('the picker and the drop end in the same place (218, acceptance 7)', () => {
  it('🔴 the two gestures produce the same staged list, chip for chip', async () => {
    // ⚑ Not a proof that no third path can appear — `one-way-to-stage.test.ts` is the rule that
    // holds that. This is the observable half: what a person gets is the same either way.
    installBridge()
    bridge.picked = { handed: file('/work/alpha/notes.md') }
    const byPicker = composer()
    ;(byPicker.q('attach-path') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    const pickedList = staged()

    unmountAll()
    installBridge()
    view = composer()
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))

    expect(staged()).toEqual(pickedList)
    expect(staged()).toEqual([file('/work/alpha/notes.md')])
  })

  it('⛔ …and a drop clears WITH the send, exactly as a pick does', async () => {
    // `216` §2: an attachment that outlived its send would ride along on the next message,
    // silently, since the chip looks the same.
    installBridge()
    view = composer({ draft: 'read this' })
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))
    expect(staged()).toHaveLength(1)
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()

    expect(staged()).toEqual([])
  })
})

/**
 * # 🔴 Two drops, one list (236 §4, from `231` #10 — the PM's own measurement)
 *
 * ⛔ **`stage` batches WITHIN one drop and nothing serialised two.** `props.attachments` does not
 * change when the parent writes it; it changes when the parent RE-RENDERS, a scheduler tick later.
 * Two drops resolve their IPC as plain microtasks, both before that tick — so the second computes
 * its list from before the first one's emit, and its list wins. The first file is silently gone.
 *
 * ⚑ **`232` widened it, correctly.** `231` #9 was *"synchronous `realpathSync` blocks main"*, and
 * making the classifier async turned this window from the duration of a `stat` into the duration of
 * an awaited IPC round trip — seconds, on the stalled main that finding is about.
 *
 * ## ⛔ Why nothing below awaits BETWEEN the two drops
 *
 * ⚠️ **An `await` between them is a parent re-render**, and a re-render is precisely the thing the
 * defect needs not to have happened. A test written that way passes over both the fixed and the
 * broken composer and proves neither: the dispatch says so in as many words. So the two drops are
 * dispatched back to back, synchronously, and only then is anything allowed to settle.
 */
describe('two drops in one tick (236 §4)', () => {
  /** Both drops dispatched with nothing between them, then everything allowed to settle. */
  async function dropTwice(mounted: Mounted, first: File, second: File): Promise<void> {
    drag(mounted, 'drop', carrying(first))
    drag(mounted, 'drop', carrying(second))
    // Only now. Four, because there are two bridge round trips to drain as well as the render.
    for (let tick = 0; tick < 4; tick += 1) await nextTick()
  }

  it('🔴 BOTH files are staged — the first one is not overwritten by the second', async () => {
    installBridge()
    view = composer()

    await dropTwice(
      view,
      dropped('first.md', '/work/alpha/first.md'),
      dropped('second.md', '/work/alpha/second.md'),
    )

    expect(staged()).toEqual([file('/work/alpha/first.md'), file('/work/alpha/second.md')])
    // ⚑ …and on SCREEN, not merely in the parent's variable. The chip list is what tells a person
    // their gesture happened, and 106's whole subject is a gesture that appears to do nothing.
    expect(view.all('attached-file')).toHaveLength(2)
  })

  it('⛔ …and the harness is honest: no render happens between them (292 §2 corrected this)', async () => {
    // ⚠️ **The teeth of the test above, and one word of it was wrong.** It read *"the prop the
    // composer was handed is still the empty list it started with"* — true, and it named the prop
    // as the thing that mattered. ⛔ **What actually matters is WHEN the base is read**, and 292 §2
    // is where that stopped being a property of rendering at all: the list is read from the draft's
    // transaction at the moment each answer COMMITS, not at the moment its gesture began.
    //
    // ⚑ So the two facts pinned here are that nothing flushed between the drops — otherwise a
    // composer that had gone back to reading a re-rendered prop would pass this — and that at the
    // moment the second drop ASKED main, nothing had been staged by the first yet. Both drops
    // survive anyway, which is the outcome, and it is the commit ordering that produces it.
    installBridge()
    view = composer()
    let baseDuringSecondDrop: HandedPath[] | null = null
    let rendersDuringDrops = 0
    const seen: number[] = []
    ;(window as unknown as { api: { handDroppedPaths: unknown } }).api.handDroppedPaths =
      async (input: { paths: string[] }) => {
        seen.push(input.paths.length)
        if (seen.length === 1) rendersDuringDrops = renders
        if (seen.length === 2) baseDuringSecondDrop = [...staged()]
        return input.paths.map((path) => ({ handed: file(path) }))
      }

    await dropTwice(
      view,
      dropped('first.md', '/work/alpha/first.md'),
      dropped('second.md', '/work/alpha/second.md'),
    )

    expect(seen).toEqual([1, 1])
    // ⛔ No flush between the two drops — the window `236` §4 is about is the one being exercised.
    expect(renders, 'the parent re-rendered mid-drop — this proves nothing').toBe(
      rendersDuringDrops,
    )
    // ⛔ Nothing was staged when the second drop asked — the first had not come back yet.
    expect(baseDuringSecondDrop).toEqual([])
    // ⚑ …and both survive regardless, because each answer computes its base when it commits.
    expect(staged()).toEqual([file('/work/alpha/first.md'), file('/work/alpha/second.md')])
  })

  it('🔴 the OWNER can take the list back, and the composer follows it', async () => {
    // ⛔ **The composer holds no copy at all since 292 §2**, so there is nothing that could outlive
    // the owner's truth. ⚠️ This read *"the composer's own copy is DROPPED at the end of the
    // tick"*, which was the honest description of `pendingStaged`: a window for the microtasks
    // between an emit and the render answering it, which had to expire or a parent that
    // legitimately changed the list (a conversation switched, a failed send handed back, a draft
    // swept) would be ignored for the life of the composer.
    //
    // ⚑ **The property it existed to protect is what is asserted now**, and it holds by
    // construction rather than by a timer: the chips on screen are the owner's list, always.
    installBridge()
    view = composer()
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))
    expect(view.all('attached-file')).toHaveLength(1)

    // The parent takes it back, exactly as `drafts.paths.write` does.
    ownerSets([])
    await nextTick()

    expect(view.host.querySelectorAll('[data-cy=composer-attachments] li')).toHaveLength(0)
    // ⚑ …and the composer still works afterwards: the next drop computes from the owner's list,
    // not from the copy it was holding.
    await dropOn(view, dropped('after.md', '/work/alpha/after.md'))
    expect(staged()).toEqual([file('/work/alpha/after.md')])
  })

  it('⛔ a drop landing on top of a picked file keeps both, either order', async () => {
    // ⚑ The picker has the same shape — it awaits a dialog and then computes from the prop — so it
    // is the same fix, and this is the pair that says so.
    installBridge()
    bridge.picked = { handed: file('/work/alpha/picked.md') }
    view = composer()
    ;(view.q('attach-path') as HTMLButtonElement).click()
    drag(view, 'drop', carrying(dropped('dropped.md', '/work/alpha/dropped.md')))
    for (let tick = 0; tick < 4; tick += 1) await nextTick()

    expect(
      staged()
        .map((each) => each.path)
        .sort(),
    ).toEqual(['/work/alpha/dropped.md', '/work/alpha/picked.md'])
  })

  it('⛔ the ceiling still binds ACROSS two drops, and says so once', async () => {
    // Without the shared list the two drops would each see nine staged and each add one, landing
    // at eleven — a message the wire refuses, staged behind a lit Send (223's shape).
    installBridge()
    const nine = Array.from({ length: 9 }, (_, at) => file(`/work/alpha/already-${at}.md`))
    view = composer({ attachments: nine })

    await dropTwice(
      view,
      dropped('tenth.md', '/work/alpha/tenth.md'),
      dropped('eleventh.md', '/work/alpha/eleventh.md'),
    )

    expect(staged()).toHaveLength(10)
    expect(view.q('attach-refused').textContent).toContain('10 attachments')
  })

  it('⛔ …and the same path twice is still ONE attachment, even across two drops', async () => {
    installBridge()
    view = composer()

    await dropTwice(
      view,
      dropped('notes.md', '/work/alpha/notes.md'),
      dropped('notes-again.md', '/work/alpha/notes.md'),
    )

    expect(staged()).toEqual([file('/work/alpha/notes.md')])
    expect(view.host.querySelector('[data-cy="attach-refused"]')).toBeNull()
  })
})

/**
 * # ⚠️ One spelling, or two files? (236 §5, from `227` LOW 4)
 *
 * ⛔ **`232` §1 rejected `dev`/`ino` for two reasons that stand; case folding is the half that
 * survives** — and `187` §1 already ruled on exactly this question one field over: a case variant
 * is one thing on the default macOS volume format and two on a case-sensitive one, so neither
 * "silently one" nor "silently two" is true everywhere. It is REFUSED, and the refusal names the
 * spelling it collided with.
 */
describe('a spelling that differs only in case (236 §5)', () => {
  it('🔴 is refused out loud, and does not become a second chip', async () => {
    installBridge()
    view = composer()
    await dropOn(view, dropped('Notes.md', '/work/alpha/Notes.md'))
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))

    expect(staged()).toEqual([file('/work/alpha/Notes.md')])
    const note = view.q('attach-refused')
    expect(visible(note)).toBe(true)
    // ⛔ It names the spelling already there — a refusal that only said "already attached" would
    // leave a person staring at a chip whose name does not match what they just dropped.
    expect(note.textContent).toContain('/work/alpha/Notes.md')
    expect(note.textContent).toContain('differ only in case')
  })

  it('⛔ …and an EXACT repeat is still silent, because that is what a person means', async () => {
    // The paired negative: folding and de-duplicating are different answers and only one of them
    // gets a sentence. Dropping something already attached is not a mistake.
    installBridge()
    view = composer()
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))
    await dropOn(view, dropped('notes-again.md', '/work/alpha/notes.md'))

    expect(staged()).toEqual([file('/work/alpha/notes.md')])
    expect(view.host.querySelector('[data-cy="attach-refused"]')).toBeNull()
  })

  it('⛔ …and two genuinely different names are still two attachments', async () => {
    // The rule must not be a prefix match or a fuzzy one: `notes.md` and `Notes2.md` are two files
    // by any reading, on any volume.
    installBridge()
    view = composer()
    await dropOn(view, dropped('notes.md', '/work/alpha/notes.md'))
    await dropOn(view, dropped('Notes2.md', '/work/alpha/Notes2.md'))

    expect(staged()).toEqual([file('/work/alpha/notes.md'), file('/work/alpha/Notes2.md')])
  })
})
