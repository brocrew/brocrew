import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
/**
 * ⚠️ **The module, not the package index** — `@brobot2/runtime`'s barrel re-exports a file that
 * imports `node:fs`, which Vite externalizes for the browser, and the whole test file then fails to
 * import before a single assertion runs. Same path, same reason, as `surface-boundaries.dom.test.ts`.
 */
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation, {
  blockingGroupShows,
} from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { mount, unmountAll, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * **103 · the New-conversation page, built to 101's measurement.**
 *
 * ⚠️ **In the DOM project because the whole subject is layout, and 083's rule applies exactly:
 * *"an SSR string has no layout."*** The defect this file was written against is a control whose
 * INTRINSIC WIDTH was a sentence — `.settings-row` was a `display: flex` with no `flex-wrap` and no
 * `min-width`, holding five fields, and the reasoning `<select>` rendered every option as
 * `label — full description`. A `<select>` sizes to its widest option, so the row's width was the
 * longest sentence the provider had ever written, the `min(560px)` card could not contain it, a
 * scrollbar appeared under the settings and `plan` — the last child — was clipped off the right.
 *
 * None of that is visible in markup. The `<select>` renders identically either way; only the
 * cascade knows how wide it came out. So every assertion here reads a measured box.
 *
 * ## 🔴 417 removed the controls, and this file is the half of 101 that outlived them
 *
 * HO-022 §2 — *"Opening a new conversation opens a conversation with BroBot. That is all."* — took
 * every control off this surface: the two `<select>`s of the framing strip, the folder row, the
 * yolo checkbox and the whole `Fine-tune` fold. ⛔ **So 101's second half is GONE, not weakened.**
 * The section that measured *"the reasoning `<select>` sizes to its LABEL, never to its
 * description"* has been deleted whole rather than re-pointed: its subject was the `<option>`, and
 * there is no `<option>` anywhere on this screen now. The same for every assertion below that named
 * `provider-select`, `profile-select`, `cwd-input`, `plan-mode`, `fine-tune-*` or a note attached to
 * one of them — each removal is marked where it stood.
 *
 * ## ⚠️ Why the overflow sweep SURVIVES the controls it was written for
 *
 * *"A line no mutation can kill is not carrying its rule"*, so this was decided by naming the
 * content that can still be too wide rather than by keeping a sweep out of habit:
 *
 *  - **`profile-credential` is the ADAPTER's sentence** (`homeCredential.note` / `.reason`,
 *    `profile-credential.ts`: *"the words are the ADAPTER's, never this file's"*). It arrives from
 *    outside this repo and no assertion anywhere bounds its length.
 *  - **`command-error` is the adapter's diagnostic** — `085` made reading it forbidden precisely
 *    because it is not a contract, and seven live-smoke steps show it verbatim.
 *  - **`provider-is-fixed` carries a provider NAME** from the same place.
 *
 * ⚠️ **And nothing on this surface sets `overflow-wrap`** — `base.css` declares it only for
 * `.refused-image` and `.link-target` — so the hazard is a property of the strings, not of the box.
 * What this file measures is therefore still the OUTCOME at seven widths, with a detector proven to
 * fire; what it no longer reaches is a string longer than the ones the fixture hands it.
 */

afterEach(unmountAll)

/**
 * A sentence long enough to have decided a width, used ONLY by the planted hazard below.
 *
 * ⚑ **It used to be a reasoning description** (`LONG_DESCRIPTION`), fed to a `models` prop that no
 * longer exists. It is kept as plain unwrappable content because the detector still needs something
 * that cannot fit, and the provider's own copy — see the module note — is the real-world version of
 * exactly this shape.
 */
const LONG_SENTENCE =
  'Balances speed and reasoning depth for everyday tasks, and is the level the provider ' +
  'recommends when you have not thought about it — it is also the longest sentence any of these ' +
  'levels carries, which is exactly why it used to decide how wide this control was.'

/**
 * The launcher's props, minus whatever a test is varying.
 *
 * ⛔ **417 (HO-022 §2) removed `launch`, `models`, `profiles`, `real-projects` and `project-cwd`
 * from this component**, and `launch-draft.ts` with them. What is left is what the screen still
 * needs in order to render: the two notes, the blocking group and the composer. `capabilities`
 * stays because the credential note reads `homeCredential` off it.
 */
const launcher = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  busy: false,
  error: null,
  debug: false,
  draft: '',
  defaultProvider: 'codex',
  // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
  // untouched door holds. A required prop for `handing`'s reason: the typechecker is the only
  // reader of `RuntimeScreen`'s bindings, so a silently-absent one is a silently-absent control.
  choices: NO_LAUNCH_CHOICES,
  // 🔴 **579 · this fixture had never passed it, and the prop is REQUIRED** (500). ⛔ Omitted, it
  // arrives as `undefined`, which `launchApprovalView` takes down its non-null branch — so
  // `SAYS[undefined]` is `undefined`, the button renders an empty `<strong>` and gets neither the
  // `auto` nor the `unread` class. ⚠️ **Every width measured through this fixture was measuring a
  // control in a state the app cannot produce**, which is `a-positive-assertion-must-differ-from-
  // the-default` arriving as a layout reading. ⚑ `'ask'` is what a fresh install resolves to.
  defaultApprovalMode: 'ask',
  capabilities: allProviderCapabilities(),
  // ⛔ **A draft TRANSACTION, not a list** (292 §2) — required on this component since the paths
  // and the operations that produce them became one thing.
  handing: createAttachmentBook().handing(NEW_CONVERSATION),
  ...over,
})

async function open(width: number, over: Record<string, unknown> = {}): Promise<Mounted> {
  const m = mount(NewConversation, launcher(over), { width, height: 900 })
  await nextTick()
  return m
}

/**
 * ⚑ **579 · the same launcher with both explanations OPEN** (`EXT-010` §2.1).
 *
 * ⛔ **The widest state this column has is the opened one**, and it is the state the adapter's own
 * credential sentence is laid out in — which is the content this file's module note names as the
 * real-world version of an unwrappable string. ⚠️ A sweep that only ever ran with the folds closed
 * would have stopped measuring the longest thing on the screen the day it went behind a press.
 */
async function openWide(width: number, over: Record<string, unknown> = {}): Promise<Mounted> {
  // Exercise the longer first-choice state instead of the removed explanation folds.
  return open(width, { ...over, approvalDefaultChosen: false })
}

/**
 * Everything under the surface that sticks out sideways past the box it is in.
 *
 * `scrollWidth > clientWidth` is the browser's own answer to "is there more here than fits", which
 * is the same question the horizontal scrollbar was asking. Read on every element rather than only
 * the root, because the card's scrollbar was on an INNER element — a root that fits while something
 * three levels down does not is the exact shape of the defect.
 *
 * ⚠️ **Two exclusions, and both are the difference between "too wide" and "handled".**
 *  - An element whose `overflow-x` is `hidden`/`clip` contains its own overflow visibly, and that is
 *    what an ellipsis IS — the header's `<h1>` is supposed to end in one when it runs out of room.
 *    `auto` and `scroll` are deliberately NOT excluded: those produce the horizontal scrollbar,
 *    which is the defect itself, and `.empty-stage` is one of them.
 *  - Form fields scroll their VALUE inside a fixed box by browser design. ⚑ **417**: the field this
 *    clause was written for was `cwd-input`; the composer's `prompt-input` is the one that is left,
 *    and it is reached only by the walks rooted at the surface or the composer band.
 * Skipping a clipper is safe rather than convenient: if it were itself wider than what holds it, the
 * walk catches that on the ancestor, which is where a page actually starts scrolling.
 */
function overflowing(m: Mounted, rootCy = 'launcher-column'): string[] {
  const named = (el: Element): string => {
    const cy = el.getAttribute('data-cy')
    if (cy) return `[data-cy=${cy}]`
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
  }
  const contained = (el: Element): boolean => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
    const overflowX = getComputedStyle(el).overflowX
    return overflowX === 'hidden' || overflowX === 'clip'
  }
  const root = m.q(rootCy)
  return [root, ...root.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !contained(el))
    .map((el) => `${named(el)} — ${el.scrollWidth}px of content in ${el.clientWidth}px`)
}

/* ------------------------------------------------------------------ 1 · the overflow */

describe('the launcher cannot scroll sideways, at any width (101 §2)', () => {
  // 1180 is the app at the narrow end 101 measured (`bb101-03`); 600 / 400 / 184 are its
  // three-widths board (`bb101-09`), and 184 is the one that earns its place — it is the width at
  // which the plate, the two notes and the composer have least room and most to say.
  //
  // ⛔ **The second walk — the one with the fold OPENED — is gone with the fold** (417,
  // HO-022 §2). It read *"a `display: none` subtree has no layout boxes at all: the walk was
  // stepping over the five fields that used to overflow"*, and there is no longer a subtree to
  // step over. ⚑ What replaces its paired positive is the note below: the sweep must be measuring
  // laid-out content, and the notes are the content that is left.
  it.each([1200, 1180, 900, 600, 400, 320, 184])('at %ipx', async (width) => {
    const m = await open(width)
    // The positive that makes the walk mean something: the surface really has laid something out.
    // ⚑ **579 · ONE note is always on now** (`EXT-010` §2.1) — `provider-is-fixed`. The credential
    // sentence is behind a press, and the state that lays it out is the sweep below.
    expect(m.q('model-picker-face').getBoundingClientRect().height).toBeGreaterThan(0)
    // ⛔ **The control is the other thing that must have a box**, and since `579` it is a filled,
    // bordered one — a width sweep over a column whose loudest element had collapsed would pass.
    expect(m.q('prompt-input').getBoundingClientRect().height).toBeGreaterThan(0)
    expect(overflowing(m), `at ${width}px, resting`).toEqual([])
  })

  /**
   * 🔴 **579 · the same sweep with both folds OPEN**, which is now the widest content this column
   * has to lay out and the only state the adapter's credential sentence is measured in.
   */
  it.each([1200, 1180, 900, 600, 400, 320, 184])(
    'at %ipx, with the first mode choice',
    async (width) => {
      const m = await openWide(width)
      expect(m.q('model-picker-face').getBoundingClientRect().height).toBeGreaterThan(0)
      expect(m.q('choose-ask').getBoundingClientRect().height).toBeGreaterThan(0)
      expect(m.q('choose-auto').getBoundingClientRect().height).toBeGreaterThan(0)
      expect(overflowing(m), `at ${width}px, opened`).toEqual([])
    },
  )

  it.each([1200, 600, 400])('…and while it is opening a conversation, at %ipx', async (width) => {
    // The one state with controls of its own — the composer foot's Cancel and the header's
    // "Starting…" read — and it was the state no width assertion covered (review).
    const m = await open(width, { busy: true })
    expect(m.q('cancel-launch')).toBeTruthy()
    expect(overflowing(m), `at ${width}px, starting`).toEqual([])
    expect(overflowing(m, 'composer-band'), `at ${width}px, the composer band`).toEqual([])
  })

  /**
   * ⚠️ **The whole surface, header included — and only at widths the app can really be.**
   *
   * Measured rather than assumed: at 184px it is the SESSION HEADER that runs out of room
   * (breadcrumbs + chip + plate + two icon buttons ≈ 202px), not the column 101 redesigned. That is
   * a pre-existing property of a bar this task did not touch, and the app's own shell cannot reach
   * that width anyway — the rail alone is wider. So the narrow sweep above is scoped to the column,
   * which is exactly what the mock's three-widths board renders, and the surface as a whole is
   * asserted at the two widths 101 actually photographed.
   */
  it.each([1200, 1180])('the whole surface, header and all, at %ipx', async (width) => {
    const m = await open(width, { error: 'the launch did not start', debug: true })
    expect(overflowing(m, 'new-conversation-surface'), `at ${width}px`).toEqual([])
  })

  /*
   * ⛔ **Four sweeps stood here and 417 removed every one of their subjects** (HO-022 §2):
   *
   *  - *"the framing strip stacks rather than squashing (101 §2, guard 1)"* — `flex-wrap` on
   *    `.frame-row`, measured through `provider-select` and `auto-approve`. ⚑ The rule is not
   *    enforced anywhere else because `.frame-row` itself is gone from the stylesheet; there is no
   *    surviving half to keep.
   *  - *"…with the deferral open, which is where the five old fields went"* — `fine-tune-toggle`,
   *    `fine-tune-body`, `plan-mode`.
   *  - *"…with a path far too long for the box, which is what the ellipsis is for"* — `cwd-input`
   *    and 101 §2's structural guard applied to the folder field.
   *  - *"the profile picker, open and being typed into, at %ipx"* (167) — `profile-select`,
   *    `new-profile-name`, `profile-refusal`, and the 64-character `LONG_PROFILE` fixture whose
   *    whole job was to be a `<select>`'s widest option.
   *
   * ⚠️ **Not re-pointed at the surviving column.** Each was about a named control's intrinsic
   * width; a sweep kept with the control taken out of it measures the resting page a second time,
   * which the `it.each` above already does at more widths.
   */

  it('…and while it is failing, with every note it can show at once', async () => {
    const m = await openWide(400, {
      error: 'codex exited before it started: no such file or directory (cwd)',
      debug: true,
    })

    // ⚑ **417: "every note it can show at once" is now literally three** — the always-on line, the
    // credential sentence and the launch failure. ⛔ **579 · and the click came BACK**: `417`
    // deleted a fold that held CONTROLS, `EXT-010` §2.1 added two that hold EXPLANATION, and
    // *every note at once* is again a state a person reaches by pressing.
    expect(m.q('model-picker-face')).toBeTruthy()
    expect(m.q('choose-ask')).toBeTruthy()
    expect(m.q('choose-auto')).toBeTruthy()
    expect(m.q('command-error')).toBeTruthy()
    expect(overflowing(m)).toEqual([])
  })

  /**
   * ⚠️ **The pairing, and without it every `toEqual([])` above passes over nothing.** A detector
   * that can never fire — a stylesheet that did not load, a `scrollWidth` read on an unsized box —
   * satisfies all of them. So: plant something that cannot fit and require the walk to name it.
   *
   * ⚑ **417 re-pointed the plant, and the reproduction is weaker for it — honestly so.** It used to
   * be appended into `new-conversation-settings` and was deliberately the CAUSE rather than a random
   * wide `<div>`: a `<select>` whose intrinsic width is a sentence, in a row that will not wrap.
   * That row does not exist, so the plant now goes into the column itself and stands for the hazard
   * that DOES survive — a sentence from the provider that the box cannot break (see the module
   * note: nothing here sets `overflow-wrap`).
   */
  it('⚠️ …and the same walk reports content the column cannot break', async () => {
    const m = await open(400)
    expect(overflowing(m), 'the launcher was not clean to begin with').toEqual([])

    const column = m.q('launcher-column')
    const wide = document.createElement('div')
    wide.setAttribute('data-cy', 'the-old-row')
    wide.style.display = 'flex'
    wide.style.flexWrap = 'nowrap'
    const sentence = document.createElement('div')
    sentence.style.flex = '0 0 auto'
    sentence.style.whiteSpace = 'nowrap'
    sentence.textContent = LONG_SENTENCE
    wide.append(sentence)
    column.append(wide)
    await nextTick()

    expect(
      overflowing(m).join('\n'),
      'a no-wrap row of unwrappable content did not register — the detector is decoration',
    ).toContain('[data-cy=the-old-row]')

    // …and it goes quiet again when the offender comes out, so the report above is a response to
    // the row rather than a walk that names everything it sees.
    wide.remove()
    await nextTick()
    expect(overflowing(m)).toEqual([])
  })
})

/* ------------------------------------------------------------------ 2 · the cause — GONE AGAIN */

/*
 * ⛔ **UI-012 deleted this block whole, as `417` did before `435` restored it.** Its subject was the
 * reasoning `<select>` and its `<option>`s — a control whose intrinsic width could be a sentence —
 * and the model picker (`09` §1) replaced that select with effort RADIOS in a popover, each level's
 * description on its `title` and the selected one's on a line beneath. ⚑ There is no `<option>` on
 * this screen again, so there is nothing for these four measurements to read.
 */

/* ------------------------------------------------------------------ 3 · the states */

describe('every state the mock switches between renders (101)', () => {
  /**
   * ⚠️ **The theme axis is gone and the width axis is not** (344). This ran the same layout twice —
   * once per value of a `chatLight` prop — and the prop no longer exists: the launcher renders
   * `data-chat-theme="light"` unconditionally, so the second pass measured the same pixels under a
   * different name. ⛔ **The attribute is still asserted, and now as a VALUE rather than an echo of
   * the input** — an echo passes whatever the surface renders, which is exactly what stops being
   * true when there is only one right answer.
   *
   * ⚑ **417**: the paired positive was `new-conversation-settings`, the frame that held the
   * pickers. It is now `provider-is-fixed` — same job, an element that only renders if the column
   * rendered, on the surface that is left.
   */
  it('one scheme, both widths, resting', async () => {
    for (const width of [1200, 1180]) {
      const m = await open(width)
      expect(m.q('new-conversation-surface').getAttribute('data-chat-theme')).toBe('light')
      expect(m.q('model-picker-face')).toBeTruthy()
      expect(overflowing(m)).toEqual([])
      m.unmount()
    }
  })

  /*
   * ⛔ **The four fold tests are deleted with the fold** (417, HO-022 §2):
   *
   *  - *"fine-tune closed keeps its controls, and open shows them"* — `v-show` over `v-if`, and
   *    `aria-expanded`;
   *  - *"a choice made inside the fold survives closing it"* — the reason it was `v-show`;
   *  - *"the fold names only what is behind it (030)"* — the toggle's own label naming `plan` only
   *    where `planAvailable`. ⚠️ **030's rule — an unavailable control is ABSENT, not disabled — is
   *    a rule about controls, and the launcher has none**; its live carriers are the Controls
   *    surfaces, which have their own tests. ⚑ `launch-cancel.dom.test.ts` still MOUNTS this
   *    component with `capabilities: {}`, so the "before the declarations arrive" state is still
   *    rendered — what is lost is the only assertion that read a capability-driven branch off it.
   *  - *"idle offers a send; starting offers a Cancel"* is NOT in this list — see below.
   */

  it('idle offers a send; starting offers a Cancel, and it is live (101 §8, 102)', async () => {
    const idle = await open(1200)
    expect(idle.q('send-prompt')).toBeTruthy()
    expect(idle.all('cancel-launch')).toHaveLength(0)
    expect(idle.all('session-starting')).toHaveLength(0)

    const cancels: string[] = []
    const starting = await open(1200, { busy: true, onCancel: () => cancels.push('c') })

    // ⚠️ **101 reserved this slot "disabled until 102" — 102 landed first, so it ships WIRED.**
    // Shipping a dead button now would be reintroducing the thing 102's own comment called *"the
    // one control on this surface that lies"*, a day after it was removed.
    const cancel = starting.q('cancel-launch') as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    cancel.click()
    expect(cancels).toEqual(['c'])

    // The header reads once, in place of the plate-and-chip cluster (101 §9) — and there is no
    // second Cancel up there.
    expect(starting.q('session-starting').textContent).toContain('Starting')
    expect(starting.all('provider-chip')).toHaveLength(0)
    expect(starting.all('cancel-launch')).toHaveLength(1)
    // ⚠️ …and it is ANNOUNCED (review). It is the only signal a launch gives, and it replaces the
    // cluster rather than adding to it, so without a live region a screen-reader user is told
    // nothing at all — the plate and chip simply stop existing.
    expect(starting.q('session-starting').getAttribute('role')).toBe('status')

    // The box is shut while it opens: the message it held is already in flight, and a second one
    // typed over it is what the review traced two data-loss paths from.
    expect((starting.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(true)
    expect((idle.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(false)
  })
})

/* ------------------------------------------------------------------ 4 · the notes */

describe('the notes are one grammar in two registers (101 §7)', () => {
  /** Where an element sits in document order, so "below" can be asserted rather than assumed. */
  const before = (a: Element, b: Element): boolean =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  it('none: nothing is reserved, and the column is just the question', async () => {
    const m = await open(1200)
    expect(m.all('launch-blocked')).toHaveLength(0)
    expect(m.all('command-error')).toHaveLength(0)
    // ⛔ **`cwd-refusal` was the third negative here and 417 deleted the folder row** (HO-022 §2),
    // so the assertion would have been true of a page that never had one — see the deleted test at
    // the foot of this block for the rule it belonged to.
    // Paired positive: the surface rendered.
    expect(m.q('model-picker-face')).toBeTruthy()
  })

  it('the group never renders EMPTY, which is 24px of unexplained gap (review)', () => {
    // ⚠️ Three finders caught this: the wrapper was gated on `authState` being truthy, and
    // `authState` is an object even when it says the credential is FINE — so a check that came back
    // `usable` opened an empty flex box with a margin above the composer.
    //
    // ⚠️ **Asserted through the exported predicate rather than through a mount, and that is not a
    // shortcut.** `authState` is set only by `checkAuth`, which fires on a falling edge of
    // `busy`/`error` — a two-gesture sequence this harness cannot drive, because `mount()` builds an
    // app with fixed props. My first version of this test stubbed the IPC, dispatched an unrelated
    // `input` event, and asserted the group was absent on a surface where `authState` had never been
    // set at all: it passed over nothing, which is exactly what criterion 8 is a hunt for.
    expect(blockingGroupShows({ error: null, authState: null })).toBe(false)
    expect(blockingGroupShows({ error: null, authState: { state: 'usable' } })).toBe(false)
    // …and the two things it does hold.
    expect(blockingGroupShows({ error: 'codex exited', authState: null })).toBe(true)
    expect(blockingGroupShows({ error: null, authState: { state: 'expired' } })).toBe(true)
    expect(blockingGroupShows({ error: null, authState: { state: 'unknown' } })).toBe(true)
  })

  it('…and the predicate is really the one the surface uses', async () => {
    // The pair for the unit assertions above: the same rule, read off the rendered page in the one
    // branch a static mount can reach. Without this the exported function could be dead code.
    const failing = await open(1200, { error: 'codex exited before it started' })
    expect(failing.q('launch-blocked').contains(failing.q('command-error'))).toBe(true)
    const clean = await open(1200)
    expect(clean.all('launch-blocked')).toHaveLength(0)
  })

  /*
   * ⛔ **Five note tests are deleted with the controls they were attached to** (417, HO-022 §2).
   * Every one of them asserted the PLACEMENT of a note relative to a control, and 101 §7's rule is
   * *"an advisory attaches to the control it is about"* — with no control there is no attachment:
   *
   *  - *"one: an advisory attaches to the control it is about"* — `plan-capability-note` under
   *    `plan-mode`, inside `fine-tune-body`;
   *  - *"a caution about a setting the fold hides is NOT hidden with it"* — `plan-yolo-note`, the
   *    one note whose two halves sat on either side of the fold (`plan` inside, `auto-approve` in
   *    the framing strip). ⚑ Both halves are gone; there is no surviving surface where a plan tick
   *    and a yolo tick can be combined from one screen.
   *  - *"the debug diagnostic answers for a fold that does not name plan (039)"* — `plan-unavailable`
   *    and the `debug: true, capabilities: {}` pair. ⚠️ **`debug` is still a prop here**, but it now
   *    only reaches `SessionHeader`; this file no longer has a debug-only element of its own.
   *  - *"the Controls pointer drops out when the COLUMN is narrow, not when the window is"* — the
   *    `@container` query over `.defer-toggle .say`. 🔴 **`container-type: inline-size` is still
   *    declared on `.launcher` and no rule reads it any more** — reported by the dispatch rather
   *    than deleted from `src/` here.
   *  - *"the folder's refusal stays pinned to the folder, not swept into the group (071)"* —
   *    `cwd-choose`, `cwd-input`, `cwd-refusal` and the stubbed `chooseCwd`. ⚑ 071's rule — a
   *    control's refusal belongs to the control, not to the blocking group — keeps its surviving
   *    half in the test below: the group holds the launch failure and nothing else.
   */

  it('launch blockers are announced before the composer, with settings still reachable below', async () => {
    // ⚑ **579 · opened, because the edge this test is about is the LAST thing above the group** —
    // and with the folds closed that is an opener rather than a note. Measuring the group's upper
    // bound against the widest set of notes the column can draw is the stronger reading.
    const m = await openWide(1200, {
      error: 'codex exited before it started: no such file or directory (cwd)',
    })
    const group = m.q('launch-blocked')
    expect(group.contains(m.q('command-error'))).toBe(true)
    expect(m.q('command-error').closest('[role="alert"]')).not.toBeNull()
    expect(before(group, m.q('composer-band'))).toBe(true)
    expect(group.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      m.q('composer-band').getBoundingClientRect().top,
    )
    expect(before(m.q('composer-band'), m.q('model-picker-face'))).toBe(true)
    expect(before(m.q('composer-band'), m.q('choose-ask'))).toBe(true)

    // 2 · the error's text is the adapter's sentence and nothing else — seven live-smoke steps read
    // exactly this element's `textContent`, and a heading folded into it would change all of them.
    expect(m.q('command-error').textContent?.trim()).toBe(
      'codex exited before it started: no such file or directory (cwd)',
    )
  })
})

/* ------------------------------------------------------------------ 5 · the header */

describe('the launcher header says “not started” nowhere — it was once, not three times (101 §9)', () => {
  it('⚑ D-017b · the plate says only that nothing is known, and the chip and the pill say nothing of it', async () => {
    const m = await open(1200)

    // The chip names the provider it WOULD start on, and nothing else.
    expect(m.q('provider-chip').textContent?.trim()).toBe('codex')
    // The status pill is gone from this surface.
    expect(m.all('session-status')).toHaveLength(0)
    // The plate stays (081/082, not reopened). ⚑ **D-017b · and it is FACELESS with no line**: a
    // conversation that does not exist has no process to call *not started* (`05` rule 5), so
    // the one carrier that used to say it says only that nothing is known.
    const plate = m.q('agent-state')
    expect(plate.getAttribute('data-being')).toBeNull()
    expect(plate.getAttribute('data-doing')).toBe('unknown')

    // Nowhere — and the scan covers ATTRIBUTE text too, which the review caught it not doing, and
    // since D-017b the plate's own `aria-label` with it. A reintroduction as a `title` tooltip or
    // as the plate's accessible name would not sail through.
    const header = m.q('session-header')
    const everywhere = [
      header.textContent ?? '',
      ...[header, ...header.querySelectorAll('*')].flatMap((el) => [
        el.getAttribute('title') ?? '',
        el.getAttribute('aria-label') ?? '',
      ]),
    ]
      .join(' ')
      .toLowerCase()
    expect(everywhere, 'the launcher says "not started" somewhere').not.toContain('not started')
    // Paired positive: the same scan finds what the plate DOES say, in its `aria-label` — so the
    // method is capable of seeing the words it just came back clean of.
    expect((plate.getAttribute('aria-label') ?? '').toLowerCase()).toContain('state unknown')
    expect(everywhere).toContain('state unknown')
  })
})
