import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { RAW_STREAM_TEXT } from '../../src/renderer/src/lib/raw-stream-roles'
import { ROLE_ORDER, ROLE_SIZE, type TextRole } from '../../src/renderer/src/lib/text-roles'
import { DRAWER_W_MAX, DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { createWindow, type WindowState } from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { drawerProps, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **526 · every text on the Events tab is on a NAMED token, and the roster names every text.**
 *
 * ⛔ **`525` measured this tab at 241 text elements and 7.5 px for every single one of them** —
 * `--text-6xs`, whose line in `tokens.css` says *tiny uppercase field labels* over a scale whose
 * own §9 says *"sizes < 9px are micro-labels/badges/table-heads only"*. A 298-character
 * explanation and a 90-row ledger were both drawn at it.
 *
 * ## ⛔ Why this is per ELEMENT and in the engine, and not a source census
 *
 * ⚠️ **`389` asserted six `SessionShelf` cells with one `toContain` over one file and a mutation
 * on the fifth survived**, because three neighbours still carried the word it looked for
 * (`the-bar-and-the-shelf.test.ts:151-164`). The same trap is worse here and for a second reason:
 * `base.css` puts `font-size: var(--text-base)` on `body`, and almost everything on this tab
 * INHERITS rather than declaring — so a per-file `toContain('--text-sm')` would pass over a tab
 * where nothing was the size it claimed.
 *
 * ⛔ **And `373` is why nothing below reads `EventStream.vue`.** A census that pins the text of the
 * lines it censuses reddens through the census rather than through the behaviour, and every row of
 * its own mutation table then dies for the wrong reason.
 *
 * ⚑ **So: a real drawer, in Chromium, with the shipped cascade, and the token resolved BY THE
 * ENGINE WHERE THE ELEMENT SITS** — `getPropertyValue('--text-sm')` hands back the authored token
 * stream and never passes through `font-size` computation, so it would compare a string the sheet
 * wrote against a number the engine produced. {@link tokenPx} plants a probe instead, which is the
 * same measurement the subject got.
 */

/* ------------------------------------------------------------------ the corpus */

const AT = 1_700_000_000_000

/**
 * ⚠️ **Seven kinds, so the roster is swept rather than sampled.** A corpus of one event type would
 * draw one `.rtype` and §2 would be an assertion about one string.
 *
 * ⛔ **The seventh is long ON PURPOSE, and it was added because a mutation survived without it.**
 * The row that lets `.rdetail` wrap changes nothing at all unless some detail is wider than the
 * column — every other arm here renders under fifty characters, so the whole corpus fitted and
 * *a comparison tested where both sides agree measures nothing*. ⚑ `describeEvent`'s `error` arm
 * puts the provider's message on the line verbatim, and 25 of its 50 arms overflow this column on
 * every instance in the real product.
 */
function eventFor(index: number): TranscriptEvent {
  switch (index % 7) {
    case 0:
      return { type: 'user_turn', text: 'x'.repeat(98) } as never
    case 1:
      return { type: 'thinking', phase: 'delta', text: 'why '.repeat(9), tokens: 12 } as never
    case 2:
      return { type: 'tool_call', name: 'Read', id: `tool_${index}`, input: {} } as never
    case 3:
      return { type: 'tool_result', id: `tool_${index - 1}`, ok: true } as never
    case 4:
      return { type: 'assistant_message', text: 'y'.repeat(72) } as never
    case 5:
      return {
        type: 'error',
        fatal: false,
        cause: 'rate_limit',
        message:
          'the provider asked this conversation to slow down and said so at a length no column ' +
          'this narrow was ever going to hold, which is the ordinary case for 25 of the fifty ' +
          'arms this describer has',
      } as never
    default:
      return { type: 'status', state: 'working' } as never
  }
}

const corpus = (n: number): RuntimeEventMessage[] =>
  Array.from({ length: n }, (_unused, index) => ({
    sessionId: 'sess_1',
    ordinal: index,
    at: AT + index * 37,
    event: eventFor(index),
  }))

/* ------------------------------------------------------------------ the instruments */

const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)

const name = (el: Element): string =>
  (el as HTMLElement).dataset?.cy ?? `${el.tagName.toLowerCase()}.${el.className || '—'}`

/**
 * ⛔ **The token, resolved by the engine, in the place the element sits.** A planted `<span>` with
 * `font-size: var(--token)` takes the same cascade, the same scope and the same used-value
 * rounding the subject took, so the comparison is engine-to-engine.
 */
function tokenPx(token: string, beside: Element): number {
  const probe = document.createElement('span')
  probe.style.fontSize = `var(${token})`
  ;(beside.parentElement ?? document.body).append(probe)
  const resolved = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  expect(resolved, `${token} resolved to nothing beside ${name(beside)}`).toBeGreaterThan(0)
  return resolved
}

/** Direct text only, so a wrapper is not counted again for the words inside its child. */
const ownsText = (el: Element): boolean =>
  [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )

/** Every visible element on the tab that a person actually reads a word off. */
const textBearing = (root: HTMLElement): HTMLElement[] =>
  [root, ...root.querySelectorAll<HTMLElement>('*')].filter((el) => ownsText(el) && visible(el))

const rolesOf = (el: Element): TextRole[] =>
  RAW_STREAM_TEXT.filter((entry) => el.matches(entry.selector)).map((entry) => entry.role)

/**
 * ⛔ **The roles THIS tab wears, in the vocabulary's order** — not the vocabulary itself.
 *
 * ⚑ **`529` added a fifth role, `field`** — `--text-6xs`, the one thing `tokens.css` says that
 * token is for — for the two tabs that have group headings and key columns. ⛔ This tab has
 * neither, so every loop below is over what is actually on screen: a loop over the vocabulary
 * would assert this tab against a role nothing on it can wear, and would fail for the one reason
 * that is not a defect.
 */
const EVENTS_ROLES = ROLE_ORDER.filter((role) => RAW_STREAM_TEXT.some((e) => e.role === role))

/* ------------------------------------------------------------------ the mount */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * ⛔ **Every width the drawer is ever drawn at**, because the review found the worst case at the
 * one this test was not mounting. `DRAWER_W_MIN` is the comfortable track and `DRAWER_W_MIN` is
 * both the narrow fit and the overlay (`SessionDrawer.vue`); 368 is what `525` mounted, kept so
 * every number here is comparable with its measurement.
 */
const WIDTHS = [DRAWER_W_MIN, 460, DRAWER_W_MAX] as const

/**
 * The scroll the tab may cost, measured across every width above at the 12 px type floor: `SHUT`
 * for the state a person finds it in, `CEILING` with the explanation open. The worst of each is at
 * the 360 px floor (3.86 and 4.05 shut, 4.47 open). The floor's larger type is a deliberate cost on
 * this debug-only tab; these bounds stop it growing further. `WINDOWED_CEILING` is the same bound
 * for the longest reach sentence with the explanation open (4.73 at 360 px), which wraps one line
 * more than the ordinary case.
 */
const SHUT = 4.1
const CEILING = 4.55
const WINDOWED_CEILING = 4.8

/**
 * ⛔ **The DRAWER, not `EventStream` bare.** This panel lives in a 320-380 px column inside the
 * drawer's own scope, and a size read outside it is a size read somewhere this component never
 * sits. ⚑ `waiting: 3` puts the cross-tab attention bar on the strip, which is the state `525`
 * photographed and the one that costs the list its 39 px.
 */
async function eventsTab(
  events: number,
  open = false,
  win: Partial<WindowState> = {},
  width = 368,
): Promise<Mounted> {
  // ⚠️ The viewport is shared across this directory, so it is captured and restored below.
  await page.viewport(1440, 1100)
  // ⛔ **Every number below is a wrap count in disguise**, and a wrap count depends on the font
  // actually being there. `base.css` loads Inter with `font-display: swap`, so a measurement taken
  // before it lands is a measurement of the fallback.
  await document.fonts.ready
  const m = mount(
    SessionDrawer,
    drawerProps({
      tab: 'events',
      waiting: 3,
      fit: 'docked',
      window: { ...createWindow(), entries: corpus(events), ...win },
    }),
    { width, height: 1000 },
  )
  await nextTick()
  await nextTick()
  // ⛔ **The roster is about every text on the TAB, so the sweeps take it open.** A shut
  // disclosure would leave the one block that exists to be read out of the census entirely —
  // `an-unenumerated-state-counts-as-success` on the very element 526 moved. §4 is where the shut
  // default is asserted.
  if (open) {
    m.q('event-log-why').click()
    await nextTick()
  }
  return m
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------ §1 the roster */

describe('526 §1 · the roster answers for every text on the tab, and for nothing else', () => {
  it('⛔ every visible text matches exactly one role, and every role matches something', async () => {
    const m = await eventsTab(90, true)
    const panel = m.q('event-stream')
    const drawn = textBearing(panel)

    // ⚑ The premise: this really is the tab with many things, so §2 is a sweep and not a sample.
    expect(
      drawn.length,
      'the corpus drew almost nothing — §2 would measure nothing',
    ).toBeGreaterThan(150)

    // ⛔ **Both directions.** An element no entry matches is the hole this roster exists to close;
    // an entry nothing matches is a roster describing a tab that is not there any more.
    const uncovered = drawn.filter((el) => rolesOf(el).length === 0)
    expect(uncovered.map(name), 'these are on the tab and in no role').toEqual([])
    const unused = RAW_STREAM_TEXT.filter(
      (entry) => panel.querySelectorAll(entry.selector).length === 0,
    )
    // `.empty` only draws over an empty window — its own mount is below.
    expect(
      unused.map((entry) => entry.selector),
      'these roles matched nothing on a populated tab',
    ).toEqual(['.empty'])

    // ⛔ …and EXACTLY one, or two entries could disagree about an element and both stay green.
    for (const el of drawn) {
      expect(rolesOf(el), `${name(el)} is in more than one role`).toHaveLength(1)
    }
  })

  it('⚑ …and the empty tab, whose one sentence is the only text on it', async () => {
    const m = await eventsTab(0)
    const panel = m.q('event-stream')
    const empty = panel.querySelector<HTMLElement>('.empty')

    expect(empty, 'an empty window drew no sentence at all').not.toBeNull()
    expect(rolesOf(empty!)).toEqual(['prose'])
    expect(px(empty!)).toBe(tokenPx(ROLE_SIZE.prose, empty!))
    for (const el of textBearing(panel)) {
      expect(rolesOf(el), `${name(el)} is in no role on the empty tab`).toHaveLength(1)
    }
  })
})

/* ------------------------------------------------------------------ §2 the sizes */

describe('526 §2 · each element reads at its role’s token', () => {
  it('🔴 element by element, resolved where it sits', async () => {
    const m = await eventsTab(90, true)
    const panel = m.q('event-stream')

    let measured = 0
    for (const entry of RAW_STREAM_TEXT) {
      const elements = [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible)
      if (entry.selector === '.empty') continue
      expect(elements.length, `${entry.selector} drew nothing`).toBeGreaterThan(0)
      for (const el of elements) {
        expect(px(el), `${name(el)} (${entry.role}) is not on ${ROLE_SIZE[entry.role]}`).toBe(
          tokenPx(ROLE_SIZE[entry.role], el),
        )
        measured += 1
      }
    }
    // ⚠️ The loop above is worthless if it ran over a handful of elements.
    expect(measured, 'the sweep touched too little to be one').toBeGreaterThan(150)
  })

  it('🔴 NOTHING on this tab is under the 12 px floor, the clock included', async () => {
    const m = await eventsTab(90, true)
    const panel = m.q('event-stream')
    const below = textBearing(panel)
      .filter((el) => px(el) < 12)
      .map((el) => `${name(el)} at ${px(el)}px`)
    expect(below).toEqual([])
    // The clock is the quietest text on the tab, so it is the one that would slip first.
    const clocks = textBearing(panel).filter((el) => rolesOf(el)[0] === 'meta')
    expect(clocks.length, 'no clock drew — the check is vacuous').toBeGreaterThan(0)
  })

  /**
   * 🔴 **The assertion above compares `ROLE_SIZE` with itself, and this one does not.**
   *
   * ⛔ **§2's per-element equality is blind to every edit of `ROLE_SIZE` by construction** — both
   * sides read the map, so `meta: '--text-6xs'` (7.5 px, the exact token `525` measured, on 75 of
   * the tab's elements) passes it, the distinctness check, the strict descent, the 9 px floor
   * (which exempts `meta`) and the bridge. **The whole suite goes green on the defect this
   * dispatch exists to remove.** Found by the adversarial pass over 526's own diff.
   *
   * ⚑ **So the floors below are typed here, in the test, on purpose.** A decision belongs in the
   * ratchet that stops it sliding, and this is the only place in the repo that does not read
   * `ROLE_SIZE` to find out what `ROLE_SIZE` should be. ⚠️ They are FLOORS and not equalities:
   * raising a role is a decision somebody can make without touching this file; lowering one is the
   * drift `525` measured, and it cannot.
   */
  it('🔴 no role may drift DOWN — floors that do not come from the map they check', async () => {
    const m = await eventsTab(90, true)
    const panel = m.q('event-stream')

    const FLOOR: Record<TextRole, number> = {
      // `tokens.css` §9: reading lives at 11-12 px, and the explanation is the tab's one paragraph.
      prose: 11,
      // The step `tokens.css` itself calls the *DEFAULT UI label & button text*.
      label: 10,
      // §9's own floor: *"sizes < 9px are micro-labels/badges/table-heads only."*
      value: 9,
      // The micro end. ⛔ One step below this is `--text-6xs` — 525's defect, on every row.
      meta: 8,
      // ⚑ **529's fifth role, and the one place `--text-6xs` is not a defect** — a tiny uppercase
      // field label is what that token's own line names it for. ⛔ Nothing on THIS tab wears it,
      // which is why the loops below are over {@link EVENTS_ROLES} and not the vocabulary: the
      // control two blocks down is *525's size clears no floor*, and it would be false of a role
      // whose floor IS that size.
      field: 7.5,
    }

    for (const role of EVENTS_ROLES) {
      expect(
        tokenPx(ROLE_SIZE[role], panel),
        `${role} is on ${ROLE_SIZE[role]}, below the floor this tab was repaired to`,
      ).toBeGreaterThanOrEqual(FLOOR[role])
    }

    // The control: the floors are not satisfied by everything. No token is under 12 px now, so it
    // plants the size the whole tab was once at, 7.5 px, and that clears none of them.
    panel.style.setProperty('--probe-under', '7.5px')
    const defect = tokenPx('--probe-under', panel.firstElementChild!)
    panel.style.removeProperty('--probe-under')
    for (const role of EVENTS_ROLES) expect(defect).toBeLessThan(FLOOR[role])
  })

  /**
   * 🔴 **…and the stylesheet actually GOES THROUGH the bridge, which nothing else asks.**
   *
   * ⛔ **Hard-code every size back to a `--text-*` and §2 still passes**, because it compares the
   * element against `ROLE_SIZE` and both would say 9 / 10.5 / 8 / 11.5. ⚠️ Worse for `prose`:
   * `base.css` puts `--text-base` on `body`, so deleting `font-size` from the three prose rules
   * changes nothing a size assertion can see. ⚑ Driving the custom property and watching the
   * elements MOVE is the only reading that can tell.
   */
  it('🔴 every role is wired THROUGH `--role-*`, or the module decides nothing', async () => {
    const m = await eventsTab(90, true)
    const panel = m.q('event-stream')

    for (const role of EVENTS_ROLES) {
      const wearers = RAW_STREAM_TEXT.filter((entry) => entry.role === role).flatMap((entry) =>
        [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible),
      )
      expect(wearers.length, `${role} is worn by nothing`).toBeGreaterThan(0)

      // ⚠️ **Put back, never removed.** The property is an INLINE style Vue wrote from `roleSize`,
      // and Vue does not re-apply it until the component re-renders — `removeProperty` would strip
      // the bridge for the rest of the mount, and the elements would fall back to `body`'s
      // `--text-base`. Which is itself the finding: 11.5 px looks exactly like a working `prose`.
      const authored = panel.style.getPropertyValue(`--role-${role}`)
      expect(authored, `--role-${role} is not an inline property of the panel`).not.toBe('')
      panel.style.setProperty(`--role-${role}`, '23px')
      try {
        for (const el of wearers) {
          expect(px(el), `${name(el)} did not follow --role-${role}`).toBe(23)
        }
      } finally {
        panel.style.setProperty(`--role-${role}`, authored)
      }
      // …and it goes back, so one role's probe cannot leak into the next one's.
      for (const el of wearers) expect(px(el)).toBe(tokenPx(ROLE_SIZE[role], panel))
    }
  })

  it('⚑ …and the floor is proven by VIOLATING it', async () => {
    const m = await eventsTab(90)
    const panel = m.q('event-stream')
    const floor = tokenPx('--text-3xs', panel)

    // ⛔ A sweep nobody has made fail is a sweep nobody has measured. This is the size the whole
    // tab was at before 526, planted on the path the walk takes.
    const planted = document.createElement('p')
    planted.textContent = 'the tab as 525 measured it'
    planted.style.fontSize = '7.5px'
    panel.append(planted)
    try {
      const caught = textBearing(panel).filter((el) => px(el) < floor && rolesOf(el).length === 0)
      expect(caught).toHaveLength(1)
      expect(caught[0]).toBe(planted)
    } finally {
      planted.remove()
    }
  })
})

/* ------------------------------------------------------------------ §3 the controls */

describe('526 §3 · the roster measures a scale, not one value and not the page default', () => {
  it('⛔ the four roles run loudest first, in three sizes above the 12 px floor', async () => {
    const m = await eventsTab(90)
    const panel = m.q('event-stream')

    // A roster whose roles all name one token would pass §2 for the wrong reason. At the 12 px
    // floor value and meta share the caption size and differ by face and colour.
    const sizes = EVENTS_ROLES.map((role) => tokenPx(ROLE_SIZE[role], panel))
    expect(new Set(sizes).size, `the roles collapsed: ${sizes.join(', ')}`).toBe(3)
    for (let i = 1; i < sizes.length; i += 1) {
      expect(
        sizes[i]!,
        `${EVENTS_ROLES[i]} is louder than ${EVENTS_ROLES[i - 1]}`,
      ).toBeLessThanOrEqual(sizes[i - 1]!)
    }
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
    // ⛔ …and WHICH four, typed here rather than derived from the roster — `EVENTS_ROLES` is read
    // off `RAW_STREAM_TEXT`, so comparing the two would be `an-expectation-derived-from-the-thing-
    // it-checks`. ⚑ `field` is absent on purpose: 529 added it for surfaces with group headings,
    // and a ledger has none.
    expect(EVENTS_ROLES).toEqual(['prose', 'label', 'value', 'meta'])
  })

  it('⚑ the probe can say no, and an undeclared child inherits', async () => {
    const m = await eventsTab(90)
    const panel = m.q('event-stream')
    // ⚠️ **A DRAWN row.** The list opens on its newest line (`useStickToBottom`), so the first
    // `li.raw-event` in the DOM is folded and has no head at all — asking it for `.rtype` is how
    // this control first went red.
    const row = panel.querySelector<HTMLElement>('li.raw-event:not(.folded)')!

    // Two roles answering the same number would make §2 compare two identical failures.
    expect(tokenPx(ROLE_SIZE.prose, row)).not.toBe(tokenPx(ROLE_SIZE.value, row))

    // ⚑ A planted control, trapped the way the subject is: a bare span inside a row takes the
    // row's size, so "this element is on its role's token" is a difference rather than a property
    // of being inside the list.
    // ⚠️ **And the row itself carries NO size any more** — it was `font: var(--text-6xs)/1.5 mono`
    // and is `font-family` only now, so a child that declares nothing lands on the app's own
    // reading default. ⛔ That is the direction a mistake should fail in: an element nobody gave a
    // role comes out LOUDER than everything around it rather than quieter.
    const plain = document.createElement('span')
    plain.textContent = 'control'
    row.append(plain)
    try {
      expect(px(plain)).toBe(px(row))
      expect(px(plain)).not.toBe(px(row.querySelector('.rdetail')!))
      expect(px(plain)).not.toBe(px(row.querySelector('.rtype')!))
    } finally {
      plain.remove()
    }
  })
})

/* ------------------------------------------------------------------ §4 the disclosure */

describe('526 §4 · the explanation folds, the two facts never do', () => {
  it('⛔ it starts shut, and the count and the reach sentence are outside it', async () => {
    const m = await eventsTab(90)
    const why = m.q('event-log-why')
    const explanation = m.q('event-log-explanation')
    const reach = m.q('event-log-reach')

    expect(why.getAttribute('aria-expanded')).toBe('false')
    expect(explanation.checkVisibility()).toBe(false)

    // 🔴 **`scripts/ui-live-smoke.mjs` reads exactly this and throws unless it says so** — and it
    // reads it with the disclosure in the state a person finds it in.
    expect(reach.checkVisibility()).toBe(true)
    expect(reach.textContent).toMatch(/whole ledger/i)
    expect(m.q('event-log-note').textContent).toMatch(/90 events/)

    // …and neither fact is a descendant of the thing that folds.
    expect(explanation.contains(reach)).toBe(false)
  })

  it('⚑ …and pressing it opens the explanation, at the reading size', async () => {
    const m = await eventsTab(90)
    const why = m.q('event-log-why')
    const explanation = m.q('event-log-explanation')

    why.click()
    await nextTick()

    expect(why.getAttribute('aria-expanded')).toBe('true')
    expect(explanation.checkVisibility()).toBe(true)
    expect(explanation.textContent).toContain('Nothing here is filtered out')
    expect(px(explanation)).toBe(tokenPx(ROLE_SIZE.prose, explanation))

    // ⛔ **…and pressing it again SHUTS it, which nothing else asked.** A disclosure that only
    // opens is the always-on block 526 removed, wearing a control; and until this line the
    // mutation that welds it open died only incidentally, on a neighbour's assertion.
    why.click()
    await nextTick()
    expect(why.getAttribute('aria-expanded')).toBe('false')
    expect(explanation.checkVisibility()).toBe(false)
  })

  it('⛔ the explanation is in the DOM while it is shut, so nothing that reads text loses it', async () => {
    const m = await eventsTab(90)
    // ⚠️ `v-show`, not `v-if`: `raw-stream.render.test.ts` asserts these words are in the
    // server-rendered markup, and the fold below this panel already proves that text in the DOM
    // and text on the screen are two different questions.
    const explanation = m.q('event-log-explanation')
    expect(explanation.checkVisibility()).toBe(false)
    expect(explanation.textContent).toContain('This is not the lifecycle toggle')
  })
})

/* ------------------------------------------------------------------ §5 the scroll cost */

describe('526 §5 · legible did not cost scroll', () => {
  it('🔴 ninety events fit in fewer than SHUT screens at every width', async () => {
    for (const width of WIDTHS) {
      const wide = await eventsTab(90, false, {}, width)
      const wideLog = wide.q('event-log')
      expect(
        wideLog.scrollHeight / wideLog.clientHeight,
        `the shut tab costs more scroll at ${width}px than measured`,
      ).toBeLessThan(SHUT)
      wide.unmount()
    }

    const m = await eventsTab(90)
    const log = m.q('event-log')
    const screens = log.scrollHeight / log.clientHeight

    // A later edit that buys legibility with scroll has to move `SHUT` and say so.
    expect(screens).toBeLessThan(SHUT)

    // ⚑ …and the premise, or the assertion above would be satisfied by a list that drew nothing.
    expect(log.scrollHeight).toBeGreaterThan(log.clientHeight * 3)
    expect(log.querySelectorAll('li[data-type]')).toHaveLength(90)
  })

  /** The explanation open costs scroll while someone reads it, and never more than `CEILING`. */
  it('⛔ with the explanation OPEN the tab costs more scroll, and stays under the ceiling', async () => {
    for (const width of WIDTHS) {
      const shut = await eventsTab(90, false, {}, width)
      const shutLog = shut.q('event-log')
      const shutScreens = shutLog.scrollHeight / shutLog.clientHeight
      shut.unmount()
      const m = await eventsTab(90, true, {}, width)
      const log = m.q('event-log')
      const screens = log.scrollHeight / log.clientHeight
      expect(m.q('event-log-explanation').checkVisibility()).toBe(true)
      expect(screens, `at ${width}px opening it cost nothing — it drew nothing`).toBeGreaterThan(
        shutScreens,
      )
      expect(screens, `at ${width}px the open state got worse`).toBeLessThan(CEILING)
      m.unmount()
    }
  })

  /**
   * ⚑ **The worst reach sentence AND the narrowest drawer, because the review found I had pinned
   * the worst case at a width where it is not the worst.**
   *
   * ⛔ `237 §1`'s sentence has **twelve** distinct shapes — nine if the singular and plural arms
   * are merged — and its length is UNBOUNDED in two places: `from` and `behind` are uncapped
   * integers, so `from: 12510` already gives 152 characters. The fixture below is the longest
   * ordinary one, 151: a released window, cut mid-turn, off the tail.
   *
   * 🔴 **The true worst case in the product is 4.03 screens, at `DRAWER_W_MIN`** — the fit a
   * pane row between 880 and 940 px gets, and the one the overlay uses. ⚠️ An earlier version of
   * this test mounted only 368 px and pinned `< 4`, which held **because 320 was never mounted**.
   * That is a rule measured only where it happens to pass.
   */
  it('⛔ a WINDOWED tab stays under SHUT at every width, and under the ceiling open', async () => {
    const worst: Partial<WindowState> = {
      from: 1251,
      hasOlder: true,
      turnAligned: false,
      atTail: false,
      behind: 137,
    }

    for (const width of WIDTHS) {
      const shut = await eventsTab(90, false, worst, width)
      expect(shut.q('event-log-reach').textContent).toContain('cut mid-turn')
      const shutLog = shut.q('event-log')
      expect(
        shutLog.scrollHeight / shutLog.clientHeight,
        `a windowed tab at ${width}px costs more scroll shut than measured`,
      ).toBeLessThan(SHUT)
      shut.unmount()

      const open = await eventsTab(90, true, worst, width)
      const openLog = open.q('event-log')
      expect(
        openLog.scrollHeight / openLog.clientHeight,
        `the worst case at ${width}px got worse`,
      ).toBeLessThan(WINDOWED_CEILING)
      open.unmount()
    }
  })

  it('⛔ a row is one height whatever is on it, or `--row-px` cannot be a `calc()` at all', async () => {
    const m = await eventsTab(90)
    const log = m.q('event-log')
    const heights = [...log.querySelectorAll<HTMLElement>('li.raw-event')].map(
      (li) => li.getBoundingClientRect().height,
    )

    // Two font sizes on two lines and a third in the head — the row still has to be one number,
    // because 5,000 folded rows are sized from the arithmetic and not from their content.
    expect(new Set(heights).size, `rows came out at ${[...new Set(heights)].join(', ')}px`).toBe(1)
    expect(log.style.getPropertyValue('--row-px'), 'the engine disagreed with the tokens').toBe('')
  })

  it('⚑ the truncated half of a detail is reachable, which it was not', async () => {
    const m = await eventsTab(90)
    const log = m.q('event-log')
    const drawn = [...log.querySelectorAll<HTMLElement>('li.raw-event:not(.folded) .rdetail')]

    expect(drawn.length, 'no drawn detail to ask about').toBeGreaterThan(10)
    for (const detail of drawn) {
      expect(detail.getAttribute('title'), `${detail.textContent} has no title`).toBe(
        detail.textContent,
      )
    }
    // ⚠️ …and NOT on the folded ones, which is the priced half: a `title` there would be an
    // attribute on all five thousand rows, on the path `263` measured.
    const folded = log.querySelector<HTMLElement>('li.raw-event.folded .rdetail')
    expect(folded, 'nothing folded — the negative below is vacuous').not.toBeNull()
    expect(folded!.getAttribute('title')).toBeNull()
  })
})
