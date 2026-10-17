import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { providerForALaunch } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import {
  FOLDED_ON_THE_FRONT_DOOR,
  signInAtAGlance,
  type FoldedExplanation,
} from '../../src/renderer/src/lib/front-door-words'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_PROFILE_ID, type Provider } from '../../src/shared/runtime-ipc'
import { mount, parseColor, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 579 · the one screen whose entire job is *start typing* (`EXT-010` §2)
 *
 * > ⛔ **§2.1** — *"Four blocks of explanation now sit between the heading and the composer on the
 * > one screen whose entire job is start typing."* … **"Behind a disclosure."**
 * >
 * > ⛔ **§2.2** — *"`New conversations ask you first` is styled like the disclosure bullets around
 * > it, with a leading dot, so it reads as information. It is the most consequential control on
 * > the screen and the one that looks least pressable."*
 *
 * ## ⚑ Why a new file rather than more of `a-front-door-that-asks-nothing`
 *
 * That file's subject is **what the door ASKS FOR** — a closed vocabulary of hooks and a payload.
 * ⛔ **This one's subject is what a person PASSES on the way to the composer**, which is a
 * different question about the same column and is answered in pixels, characters and tab stops
 * rather than in hook names. ⚠️ Folding them together would make one file that goes red for two
 * unrelated reasons.
 *
 * ## ⛔ The rule this file pins, and it is `578`'s
 *
 * > ⛔ **STATE IS TEXT AND CONTROLS ARE BOXES.**
 *
 * ⚑ **`578` settled it on the conversation header** (`EXT-010` §1.3, *state styled as a control*);
 * `EXT-010` §2.2 is the same rule's other half on this screen — *a control styled as state* — and
 * `579`'s brief says so in as many words: *"look at what it did and be consistent, or say why you
 * diverged."* ⚠️ **The predicate is the same one**, `painted() && solid()`, re-derived here
 * because `the-conversation-header.dom.test.ts`'s copy is scoped to `session-header` and a scoped
 * helper reaches nothing on another surface.
 *
 * ## 🔴 …and the ONE divergence, declared and paid for
 *
 * ⛔ **The two disclosure openers `EXT-010` §2.1 adds are `<button>`s with no border and no fill**
 * — the exact shape the predicate above calls *not a control*. ⚑ `578` made the same exemption for
 * the breadcrumb and **paid for it** with `theBreadcrumbIsStillAnAffordance`, and this file pays
 * the same price in §1.3: an opener is measurably not drawn as the prose it opens.
 *
 * ⚠️ **Why the exemption is right here.** The composer is what a person came to press; a screen
 * with three filled boxes between the heading and the box they type into is the defect `101 §1`
 * removed and `EXT-010` §2.1 is complaining about the reading cost of. ⛔ The rule the PO stated
 * is about **the most consequential control** — that one is a box; a press that reveals a
 * paragraph is a reading affordance and carries a reading affordance's marks.
 */

const REAL = { width: 1200, height: 808 }
/** What is left of {@link REAL} once the rail has taken `--rail-w` (208px below the 1400px step). */
const PANE = { width: REAL.width - 208, height: REAL.height }
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
}

/**
 * The front door under a frame that owns what `RuntimeScreen` owns.
 *
 * ⚑ **UI-012 · the state a person settles into** — and since the model picker's panel holds what
 * the list says, the column's standing prose is at its shortest in every state, which is the state
 * `EXT-010` §2.1's complaint has to survive being measured in.
 */
function open(over: Record<string, unknown> = {}): Mounted {
  installBridge()
  const words = ref('')
  const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES, ...(over.seed as object) })
  const book = createAttachmentBook()
  const resolved = computed<Provider>(() =>
    providerForALaunch(null, DEFAULT_PROFILE_ID, 'claude', choices.value.provider),
  )
  const Frame = defineComponent({
    name: 'StartTypingFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: resolved.value,
          defaultApprovalMode: 'ask',
          capabilities: allProviderCapabilities(),
          choices: choices.value,
          onStart: () => {},
          'onUpdate:draft': (text: string) => (words.value = text),
          'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
          ...over,
        })
    },
  })
  return mount(Frame, {}, { width: PANE.width, height: PANE.height })
}

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------- the predicate, 578's, re-derived */

/** Does it have a fill a person can see? `null` is an unresolved value, never *no fill*. */
function painted(el: HTMLElement): boolean {
  const fill = parseColor(getComputedStyle(el).backgroundColor)
  expect(fill, `${el.dataset.cy ?? el.className}: its background did not resolve`).not.toBeNull()
  return fill![3] > 0
}

/** Does it have an edge a person can see? */
function solid(el: HTMLElement): boolean {
  const s = getComputedStyle(el)
  return s.borderStyle === 'solid' && parseFloat(s.borderTopWidth) > 0
}

/** Every `.note` the column is drawing — the prose a person passes, found rather than listed. */
const prose = (m: Mounted): HTMLElement[] => [
  ...m.q('launcher-column').querySelectorAll<HTMLElement>('.note'),
]

/** Every disclosure opener, derived from the table rather than named here (rule 27.1). */
const openers = (m: Mounted): HTMLElement[] =>
  (Object.keys(FOLDED_ON_THE_FRONT_DOOR) as FoldedExplanation[]).map((key) =>
    m.q(`launcher-why-${key}`),
  )

describe('§1 · state is text and controls are boxes, on this screen too (578, EXT-010 §2.2)', () => {
  it('🔴 the one setting on the column is drawn as a control — filled, edged, and pressable', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    const control = m.q('launch-approval-mode')
    expect(visible(control), 'a control at zero height is not a control').toBe(true)
    expect(painted(control), 'the most consequential control on the screen has no fill').toBe(true)
    expect(solid(control), 'the most consequential control on the screen has no edge').toBe(true)
    expect(getComputedStyle(control).cursor).toBe('pointer')
    // ⛔ **And it is a real button**, not a div a click handler was put on — the keyboard half of
    // being a control, which §3 walks.
    expect(control.tagName).toBe('BUTTON')
  })

  /**
   * 🔴 **All THREE states, because the restyle changed all three and only one was read** (579
   * review).
   *
   * ⛔ **`ask` is the state every fixture in this repo mounts in**, so `auto`'s new `--waiting-bg`
   * fill and `unread`'s new `background: none` had no reading anywhere: delete either declaration
   * and the whole gate stays green. ⚠️ **`unread` is the one that matters** — `086`'s third state
   * is *nobody has answered and there is nothing to press*, and a box that kept the pressable
   * one's fill would be claiming an affordance it refuses.
   */
  it('🔴 …and each of its three states is drawn as what it IS', async () => {
    await page.viewport(REAL.width, REAL.height)
    const seen: Record<string, { fill: boolean; edge: boolean; style: string }> = {}
    for (const mode of ['ask', 'auto', null] as const) {
      const m = open({ defaultApprovalMode: mode })
      await nextTick()
      const el = m.q('launch-approval-mode')
      seen[String(mode)] = {
        fill: painted(el),
        edge: solid(el),
        style: getComputedStyle(el).borderTopStyle,
      }
      m.unmount()
    }
    // ⚑ The two a person can press are boxes.
    expect(seen.ask).toEqual({ fill: true, edge: true, style: 'solid' })
    expect(seen.auto).toEqual({ fill: true, edge: true, style: 'solid' })
    // ⛔ …and the one they cannot is NOT, in both marks at once — `086`'s *unreadable, not off*.
    expect(seen.null).toEqual({ fill: false, edge: false, style: 'dashed' })
  })

  it('⛔ …and the prose beside it is not — no fill, no edge, on every sentence the column draws', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    // ⚑ Open both folds, so the two sentences behind a press are measured too: a rule about how
    // prose is drawn that skipped the prose a person reveals would be a rule about half the screen.
    for (const opener of openers(m)) (opener as HTMLButtonElement).click()
    await nextTick()
    const lines = prose(m)
    expect(lines.length, 'no prose was found — nothing was measured').toBeGreaterThanOrEqual(3)
    for (const line of lines) {
      expect(painted(line), `${line.dataset.cy} is painted like a control`).toBe(false)
      expect(solid(line), `${line.dataset.cy} wears a solid border like a control`).toBe(false)
    }
  })

  /**
   * 🔴 **The price of the exemption** — `578`'s `theBreadcrumbIsStillAnAffordance`, one surface
   * over.
   *
   * ⛔ **An opener is a `<button>` with no border and no fill**, which the predicate above calls
   * *not a control*. ⚠️ On the one screen whose complaint was *the one that looks least pressable*,
   * that exemption may not be taken for free: what makes an opener readable as a press has to be
   * measured, or `EXT-010` §2.2 has simply moved from the setting to the disclosures.
   *
   * ⚑ **Four marks, and the prose beside it has none of them**: a chevron GLYPH where a note has a
   * 5px dot, a pointer cursor, `aria-expanded`, and an ink that answers to hover.
   */
  it('⚑ …and the openers pay for being buttons drawn as text', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    const note = m.q('provider-is-fixed')
    for (const opener of openers(m)) {
      const cy = opener.dataset.cy
      // 1 · a glyph, where the prose has a pseudo-element dot. ⚠️ `IconSprite` is not mounted in
      // this harness, so the `<use>` resolves to nothing — what is asserted is the ELEMENT and its
      // box, which is what differs from a note whatever the sprite does.
      const chev = opener.querySelector<SVGElement>('svg.chev')
      expect(chev, `${cy} has no chevron`).not.toBeNull()
      expect(note.querySelector('svg'), 'a note grew a glyph — this contrast is gone').toBeNull()
      // 2 · a pointer, where the prose has none.
      expect(getComputedStyle(opener).cursor, `${cy} does not offer a pointer`).toBe('pointer')
      expect(getComputedStyle(note).cursor).not.toBe('pointer')
      // 3 · it says what it is, to anything that is not looking at pixels.
      expect(opener.getAttribute('aria-expanded'), `${cy} does not report its state`).toBe('false')
      expect(note.getAttribute('aria-expanded')).toBeNull()
      // 4 · and it answers to a pointer. ⛔ Read off the STYLESHEET rather than by synthesising a
      // hover, because `:hover` cannot be forced from script — `matches(':hover')` is the browser's
      // own state and a dispatched `mouseover` does not set it.
      const hover = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .filter(
          (rule) => rule.selectorText.includes('.why') && rule.selectorText.includes(':hover'),
        )
      expect(hover.length, `${cy} has no hover rule at all`).toBeGreaterThan(0)
      expect(hover.some((rule) => rule.style.color !== '')).toBe(true)
    }
  })

  /**
   * 🔴 **The scope reaches a person who cannot see the label** (579).
   *
   * ⛔ **Shortening the button's face moved the subject out of its accessible name.** It read *New
   * conversations ask you first*; it reads *Asks you first*, with the subject beside it in a `<p>`
   * — and a paragraph next to a button is announced by nothing. ⚠️ **The `auto` arm is where that
   * becomes measurable**: its press line names no scope either, so without this the whole of what
   * a non-sighted person would hear is *"Does not ask"*, about nothing.
   *
   * ⚑ **Asserted as the RESOLVED text of the ids**, not as the attribute — an `aria-labelledby`
   * pointing at an element that does not exist is the defect this is most likely to become, and a
   * `toContain` on the attribute could not see it.
   */
  it('🔴 the control tells a screen reader WHAT it governs, in every state', async () => {
    await page.viewport(REAL.width, REAL.height)
    for (const mode of ['ask', 'auto', null] as const) {
      const m = open({ defaultApprovalMode: mode })
      await nextTick()
      const button = m.q('launch-approval-mode')
      const ids = (button.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean)
      expect(ids.length, `${mode}: the control has no composed label`).toBe(2)
      const named = ids
        .map((id) => {
          const el = m.host.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
          expect(
            el,
            `${mode}: aria-labelledby points at ${id}, which is not in the document`,
          ).not.toBeNull()
          return (el!.textContent ?? '').trim()
        })
        .join(' ')
      expect(named, `${mode}: the accessible name does not say what it governs`).toContain(
        'Every new conversation',
      )
      // ⛔ …and it carries the STATE too, so the name is not the label alone.
      expect(named).toContain(m.q('launch-approval-says').textContent?.trim())
      // ⚑ **The consequence is a DESCRIPTION, not part of the name** — and absent in the one
      // state that has nothing to promise, where pointing at a missing id would be the bug.
      const described = button.getAttribute('aria-describedby')
      if (mode === null) {
        expect(described, 'an unreadable control described a press it cannot make').toBeNull()
      } else {
        expect(m.host.querySelector(`#${CSS.escape(described!)}`)).toBe(
          m.q('launch-approval-press'),
        )
      }
      m.unmount()
    }
  })

  /**
   * ⚠️ **The detector** — every assertion above is *this is not drawn like that*, and a column
   * that had lost its stylesheet would satisfy most of them. ⛔ This shows the predicate can say
   * *control* about something on this screen, so `false` on the notes is a reading rather than a
   * default.
   */
  it('⚠️ …and the predicate can say CONTROL: it does, about the three choices', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    // ⚑ UI-012 · the three are ONE control, the model picker's face.
    for (const cy of ['model-picker-face']) {
      expect(solid(m.q(cy)), `${cy} lost its edge`).toBe(true)
    }
  })
})

describe('§2 · how much less there is to read before you can type (EXT-010 §2.1)', () => {
  /**
   * 🔴 **The measurement the brief asks for, as a number the code produces.**
   *
   * ⛔ **Characters, not elements and not pixels.** The column is vertically centred inside a
   * `flex: 1` scroller, so removing a paragraph moves the composer by exactly nothing — the cost
   * `EXT-010` §2.1 names is *reading*, and a count of blocks would go green on one paragraph twice
   * as long as the three it replaced.
   */
  it('⛔ one paragraph stands where three did, and the folded two are the bulk of it', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    const standing = prose(m)
    expect(standing.map((el) => el.dataset.cy)).toEqual(['provider-is-fixed'])

    // ⚠️ **Read through the query rather than off the array**, so the typechecker and the
    // assertion are asking the same question: `standing[0]` is `T | undefined` under
    // `noUncheckedIndexedAccess`, and a `!` would be this test asserting something it has not
    // checked one line after checking it.
    const passed = (m.q('provider-is-fixed').textContent ?? '').trim().length
    for (const opener of openers(m)) (opener as HTMLButtonElement).click()
    await nextTick()
    const revealed = prose(m)
      .filter((el) => el.dataset.cy !== 'provider-is-fixed')
      .map((el) => (el.textContent ?? '').trim().length)
      .reduce((a, b) => a + b, 0)

    // ⚑ **Both halves, because either alone is satisfiable by a screen that says nothing.**
    expect(passed, 'the one sentence left is not a sentence').toBeGreaterThan(100)
    expect(revealed, 'nothing was folded — this is a deletion, not a disclosure').toBeGreaterThan(
      passed * 2,
    )
  })

  /**
   * ⛔ **And the composer does not move, which is the half `435` built the mechanism for.**
   *
   * The folds sit below the composer inside the scrolling stage, so an opened body grows the
   * column under the composer and never pushes it.
   */
  it('⚑ …and opening either fold does not move the box a person types into', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    const before = m.q('composer-band').getBoundingClientRect()
    for (const opener of openers(m)) {
      ;(opener as HTMLButtonElement).click()
      await nextTick()
      const now = m.q('composer-band').getBoundingClientRect()
      expect(now.top, `${opener.dataset.cy} moved the composer`).toBe(before.top)
      expect(now.height).toBe(before.height)
    }
    // The control: a block above the composer must move it, or the reading above proves nothing.
    const plant = document.createElement('div')
    plant.style.height = '120px'
    plant.style.flex = '0 0 auto'
    m.q('composer-band').before(plant)
    await nextTick()
    expect(
      m.q('composer-band').getBoundingClientRect().top,
      'the box reading cannot see the composer move',
    ).toBeGreaterThan(before.top)
    // …and it goes back, so the reading is not a one-way ratchet.
    plant.remove()
    await nextTick()
    expect(m.q('composer-band').getBoundingClientRect().top).toBe(before.top)
  })
})

/**
 * ⚠️ **Bounded, because the focus is DEFERRED** (rule 13) — `onMounted` schedules
 * `composer.focus()` on a `nextTick`, so *two ticks* is the right number on an idle machine and a
 * race on a loaded one. ⚑ **The clock is a ceiling on WAITING; the assertion is on the state.**
 */
const caretIn = async (m: Mounted, cy: string): Promise<void> => {
  await vi.waitFor(() => expect(document.activeElement).toBe(m.q(cy)), {
    timeout: 4000,
    interval: 5,
  })
}

/**
 * 🔴 **What a person tabs through, DERIVED from the document** — every focusable in the surface,
 * in order.
 *
 * ## ⛔ Why this is a derivation and not six real `Tab` presses
 *
 * ⚠️ **The first version pressed `Tab` six times and it did not survive the pool.** Each
 * `userEvent.tab()` is a CDP round trip; six of them plus a mount exceeded the browser project's
 * 15s default under `--project dom --project desktop`, and the two timeouts then left the page in
 * a state the third test inherited — a red that named the wrong test, which is `518`'s
 * *a warning beside a red is not its cause* in a different costume. ⛔ **A test whose cost is six
 * network hops is a test that reports the machine** (rule 22).
 *
 * ⚑ **So the ORDER is read off the document and the BROWSER is sampled once**, in the control
 * below: two derivations that must agree, with the expensive one paid for a single step. ⚠️ That
 * is sound here and would not be on a modal: this screen installs no focus trap — the launcher IS
 * the pane — so the browser's order is document order. `a-custom-focus-trap-is-the-tab-order` is
 * the hazard the brief names, and the control is what says it does not apply.
 */
function tabOrder(m: Mounted): HTMLElement[] {
  const surface = m.q('new-conversation-surface')
  return [
    ...surface.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.checkVisibility() && el.tabIndex >= 0)
}

const named = (els: HTMLElement[]): string[] =>
  els.map((el) => (el.dataset.cy ?? el.className) || el.tagName)

/**
 * 🔴 **583 · this SECTION carries an explicit timeout, and standing rule 22 is why.**
 *
 * > ⛔ **A wall-clock bound in a test reports the MACHINE, not the code.**
 *
 * ⛔ **Measured on `583`'s two gate runs**, on a tree that changes nothing this file touches: the
 * Shift+Tab control timed out at the 15,000 ms default in a whole-`ci` run, and the Enter control
 * timed out in the next one. ⚠️ Each passes in under two seconds when the file runs alone.
 * ⚑ **`579` already paid for this once** — six real `userEvent.tab()` round trips blew the
 * default and were cut to the two that are left.
 *
 * ⚠️ **So the bound is on the SECTION and not on whichever test failed last**, because fixing
 * them one gate at a time is how a section like this costs four gate runs instead of one. ⛔ Every
 * test in here is a real CDP round trip queued behind a browser pool that `ci` shares with a
 * build and three Electron launches; nothing outside this describe needs the allowance.
 *
 * 🔴 **The `waitFor` bounds INSIDE are untouched at 6 s.** Those are about the app answering, and
 * they are what would really catch a focus that never lands — a suite timeout only stops the
 * machine being reported as a defect.
 */
describe(
  '§3 · the keyboard, on the one screen where it is not a nicety (579 §3)',
  { timeout: 60_000 },
  () => {
    /**
     * 🔴 **What a person tabs through, from the heading to the composer** — the answer the brief
     * asks for in §4.4, as an ordered list rather than a sentence.
     *
     * The composer has focus on mount and the settings follow it, so tabbing forward from the caret
     * meets the model, then each opener, in the order they are drawn.
     */
    it('⛔ the caret starts in the composer, and the settings follow it', async () => {
      await page.viewport(REAL.width, REAL.height)
      const m = open()
      await nextTick()
      await caretIn(m, 'prompt-input')

      const order = named(tabOrder(m))
      expect(order).toEqual([
        'toggle-debug-mode',
        'prompt-input',
        'attach-path',
        'model-picker-face',
        'launcher-why-credential',
        'launch-approval-mode',
        'launcher-why-approval',
      ])
      // ⚠️ **`send-prompt` is NOT in it, and that is correct rather than missing**: this fixture
      // opens with an empty box, and an empty box darkens Send — a disabled button is not a tab
      // stop. ⛔ Stated, because a list that silently lost a control would look exactly the same.
      expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
      // ⚑ **Nothing on this screen is removed from the order by hand** — the shape
      // `a-custom-focus-trap-is-the-tab-order` warns about is a `tabindex="-1"` that a host's own
      // selector then ignores, and there is none here to ignore.
      expect(
        m.q('new-conversation-surface').querySelectorAll('[tabindex]'),
        'something on this screen is managing the tab order by hand',
      ).toHaveLength(0)
    })

    /**
     * ⚑ **The control: the BROWSER agrees with the derivation above**, sampled once.
     *
     * ⛔ Without it the order is a list this file computed from a selector it also wrote, which is
     * `a-test-that-plants-and-finds-with-one-derivation`. ⚠️ One real `Shift+Tab` costs one round
     * trip and settles whether anything — a trap, a `tabindex`, a hidden control — sits between the
     * composer and the header above it.
     *
     */
    it('⚑ …and a real Shift+Tab from the caret lands where that order says it should', async () => {
      await page.viewport(REAL.width, REAL.height)
      const m = open()
      await nextTick()
      await caretIn(m, 'prompt-input')

      const order = tabOrder(m)
      const before = order.at(order.indexOf(m.q('prompt-input')) - 1)
      // ⚠️ **Asserted, not `!`-ed**: an empty order or a composer that is first would make the
      // index `-1`, and `.at(-2)` would silently hand back something real from the other end.
      expect(before, 'the derivation puts nothing before the composer').toBe(
        m.q('toggle-debug-mode'),
      )
      await userEvent.tab({ shift: true })
      await vi.waitFor(() => expect(document.activeElement).toBe(before), {
        timeout: 6000,
        interval: 5,
      })
    })

    /**
     * ⚑ **A fold opens from the keyboard, and what it reveals does not steal the caret.**
     *
     * ⛔ **Both halves matter on this screen.** A disclosure that could only be opened with a mouse
     * would put the explanation `EXT-010` §2.1 moved out of reach of the person most likely to want
     * it; one that moved focus into its own body would take a person who is mid-thought away from
     * the box they were heading for.
     */
    it('⚑ Enter on an opener reveals its paragraph and leaves the caret where it was', async () => {
      await page.viewport(REAL.width, REAL.height)
      const m = open()
      await nextTick()
      const opener = m.q('launcher-why-credential') as HTMLButtonElement
      opener.focus()
      await caretIn(m, 'launcher-why-credential')
      await userEvent.keyboard('{Enter}')
      // ⚑ **Bounded on the OUTCOME**: the key event is dispatched before the handler has run and
      // Vue has flushed.
      await vi.waitFor(() => expect(m.all('profile-credential')).toHaveLength(1), {
        timeout: 6000,
        interval: 5,
      })
      expect(m.q('profile-credential').textContent?.trim().length).toBeGreaterThan(10)
      expect(document.activeElement, 'the revealed paragraph took the caret').toBe(opener)
      // ⛔ **And the body is not a tab stop** — it is prose, so the order that a person walks is
      // unchanged by opening it. ⚠️ Read off the derivation rather than by pressing again, for the
      // reason {@link tabOrder} gives.
      expect(named(tabOrder(m))).not.toContain('profile-credential')
    })

    /**
     * ⚠️ **The unread state is the one where a control is `disabled`**, and a disabled button is not
     * a tab stop. ⛔ The openers must still be reachable across the gap it leaves, or `086`'s third
     * state would take the explanation with it.
     */
    it('⚠️ …and an unreadable setting does not strand the presses around it', async () => {
      await page.viewport(REAL.width, REAL.height)
      const m = open({ defaultApprovalMode: null })
      await nextTick()
      await caretIn(m, 'prompt-input')
      expect((m.q('launch-approval-mode') as HTMLButtonElement).disabled).toBe(true)
      const order = named(tabOrder(m))
      // ⛔ **The control drops out of the order** — that is what `disabled` means…
      expect(order).not.toContain('launch-approval-mode')
      // …⚑ and BOTH presses are still in it, on either side of the gap it left.
      expect(order).toContain('launcher-why-credential')
      expect(order).toContain('launcher-why-approval')
      expect(order.indexOf('launcher-why-approval')).toBe(
        order.indexOf('launcher-why-credential') + 1,
      )
    })
  },
)

describe('§4 · what may NOT fold with the words (171 §3, 577)', () => {
  /**
   * 🔴 **The register survives the fold.**
   *
   * ⛔ **`329`'s subject is an act this screen COMMITS**: the launcher's own model probe prepares
   * the provider home, and for one provider that copies the machine's sign-in in. ⚠️ Folding the
   * WORDS is `EXT-010` §2.1; folding the fact that there is a consequence to read would be the
   * shape `577` measured — a claim whose qualifier is behind a press.
   *
   * ⚑ **So the opener takes `credentialLine.tone`**, and the two providers differ in it without a
   * press: Codex keeps a copy, Claude writes nothing.
   */
  it('🔴 the credential opener says WHAT is kept, in words, before anything is pressed', async () => {
    await page.viewport(REAL.width, REAL.height)
    const onCodex = open({ seed: { provider: 'codex' } })
    await nextTick()
    const copies = onCodex.q('launcher-why-credential')
    expect(copies.dataset.tone, 'the provider that keeps a copy reports no consequence').toBe(
      'consequence',
    )
    // 🔴 **The fact is a WORD and it is inside the button**, so it reaches the accessible name.
    // ⛔ **The first version of this carried the register on the chevron's INK alone** — a 1.20:1
    // ladder on the paper theme this screen ships in, on a glyph whose stroke renders at about
    // 0.7 CSS pixels, and absent from the accessibility tree entirely. ⚠️ Encoding *this profile
    // holds a copy of your machine sign-in* in a colour difference that small is not a disclosure.
    const kept = onCodex.q('launcher-sign-in-glance').textContent?.trim() ?? ''
    expect(kept, 'the opener does not say a copy is kept').toBe(signInAtAGlance(true))
    expect(copies.innerText.toLowerCase(), 'the fact is not in the button’s own text').toContain(
      kept.toLowerCase(),
    )
    const loud = getComputedStyle(onCodex.q('launcher-sign-in-glance')).color
    onCodex.unmount()

    const onClaude = open({ seed: { provider: 'claude' } })
    await nextTick()
    const quiet = onClaude.q('launcher-why-credential')
    expect(quiet.dataset.tone, 'the provider that writes nothing reports a consequence').toBe(
      'note',
    )
    const none = onClaude.q('launcher-sign-in-glance').textContent?.trim() ?? ''
    expect(none).toBe(signInAtAGlance(false))
    // ⛔ **The two providers do not say the same thing**, which is `329`'s own rule about this
    // sentence applied to the five words in front of it.
    expect(none).not.toBe(kept)
    // ⚑ …and the register is drawn as well as worded, which is the second signal rather than the
    // only one.
    expect(loud, 'the two registers are drawn the same').not.toBe(
      getComputedStyle(onClaude.q('launcher-sign-in-glance')).color,
    )
    // ⚑ …and the body behind each really does differ, so the words are reporting something.
    ;(quiet as HTMLButtonElement).click()
    await nextTick()
    expect(onClaude.q('profile-credential').dataset.copies).toBe('no')
  })

  /**
   * ⛔ **Both openers name their own subject** (579 review) — the property `329 M8` is re-aimed
   * onto, and it was asserted for one of the two.
   *
   * ⚠️ **Blank the approval opener's word and nothing was red**: every reader either CLICKS it or
   * measures its box. ⚑ A fold whose control says nothing about what is in it is the defect
   * `171 §3` is cited for, and it does not stop being one on the second fold.
   */
  it('⛔ every opener names what is behind it, from the table rather than from the template', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    for (const [key, word] of Object.entries(FOLDED_ON_THE_FRONT_DOOR)) {
      const opener = m.q(`launcher-why-${key}`)
      expect(
        opener.innerText.toLowerCase(),
        `the ${key} opener does not say what it opens`,
      ).toContain(word.toLowerCase())
      // ⚑ …and the word carries a SUBJECT rather than being a bare *more*: two folds on one
      // column that both said the same thing would name neither.
      expect(word.split(' ').length, `the ${key} opener's word names nothing`).toBeGreaterThan(3)
    }
    // ⛔ **The set is distinct**, so neither opener can be mistaken for the other.
    const words = Object.values(FOLDED_ON_THE_FRONT_DOOR)
    expect(new Set(words).size).toBe(words.length)
  })

  /**
   * ⛔ **The yolo disclosure may never fold**, and this says so on the surface that now has folds.
   *
   * ⚑ `design-v2-map.ts` rules that a surface showing one half of it *"tells a person strictly
   * less than the running app already does"*. ⚠️ It qualifies a state that is ON; the paragraph
   * behind `launcher-why-approval` qualifies nothing on screen once the scope is a label.
   */
  it('⛔ what the live mode removes is never behind a press', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open({ defaultApprovalMode: 'auto' })
    await nextTick()
    // No press, and both halves are readable.
    expect(visible(m.q('yolo-means'))).toBe(true)
    expect((m.q('yolo-means').textContent ?? '').length).toBeGreaterThan(80)
    expect(visible(m.q('yolo-reach'))).toBe(true)
    // ⚑ …and the paired positive that this screen really does fold things: the other two are shut.
    expect(m.all('launch-approval-bound')).toEqual([])
    expect(m.all('profile-credential')).toEqual([])
    // ⛔ **And it sits ABOVE the press**, so the last thing a person passes is not a fold standing
    // between the live warning and the control it is about.
    const warning = m.q('yolo-means').getBoundingClientRect()
    const press = m.q('launcher-why-approval').getBoundingClientRect()
    expect(warning.top).toBeLessThan(press.top)
  })
})
