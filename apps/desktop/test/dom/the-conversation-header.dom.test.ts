import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { STANDING_LABEL } from '../../src/renderer/src/lib/agent-state'
import { HAND_IT_BACK } from '../../src/renderer/src/lib/handing-it-back'
import { ANOTHER_CALLER_IS_ON_IT } from '../../src/renderer/src/lib/standing-grants'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, cutsOf, drawnReady, titleRecovers } from './drawn'
import {
  META,
  contrast,
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  permission,
  record,
  show,
  unmountAll,
  visible,
  type Mounted,
} from './harness'
import { usageCards } from './usage-cards'

/**
 * Measure header actions and status at the app's minimum and default widths, after the rail
 * takes its column. The drawing sensor catches clipped labels that textContent cannot detect.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⛔ Derived from `tokens.css`, not chosen — see the file note. */
const APP_MIN_W = 1180
const RAIL_W = 251.68
/** The two boxes this header is really given: the app at its floor, and the app as it opens. */
const PANE_WIDTHS = [APP_MIN_W - RAIL_W, 1200 - RAIL_W] as const
const PANE_H = 808

/** A conversation with every fact the host can report, so nothing below measures an empty bar. */
const RUNNING = {
  ...META,
  liveness: {
    ...META.liveness,
    agent: [
      { label: 'model', value: 'claude-opus-5' },
      { label: 'reasoning', value: 'high' },
    ],
  },
}

/**
 * ⛔ The worst case the bar can be in: yolo — and a grants list and another caller, which the bar
 * no longer draws (§4 measures that they cost the header nothing).
 */
const LOUD = {
  ...RUNNING,
  approvalMode: 'auto' as const,
  hasACommander: true,
  blanketGrants: ['Bash(git status)', 'Write', 'Read'],
}

/**
 * ⚑ **D-017b · the same, taken over by this window** — so the bar draws *Hand it back*, the one act
 * on it that carries a WORD since the End conversation press left it. ⛔ The acts a section
 * measures are the acts it can see, and without this the bar holds two icons.
 */
const LOUD_TAKEN = { ...LOUD, mayHandItBack: true, startedWithoutAWindow: true }

function pane(meta: typeof META, width: number, status = 'idle'): Mounted {
  ;(window as { api?: unknown }).api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const held = record([{ type: 'status', state: status } as never])
  held.meta = meta
  return mount(ConversationPane, paneProps({ record: held }), { width, height: PANE_H })
}

/**
 * 🔴 **Every element on the bar that carries a STATE string, found in the mount rather than listed.**
 *
 * ⛔ **`.header-title` is excluded, and it is the one exclusion here.** That block is the
 * conversation's IDENTITY — its `<h1>` — not a state: the title is the one thing on this bar that
 * is supposed to outrank the standing (§2's second test measures exactly that).
 *
 * ⚑ **The exclusion is paid for** in {@link theIdentityBlockHidesNoControl}. ⚠️ Until D-016 the
 * breadcrumb's `Home` was a `<button>` drawn as text, and the price was that it still looked
 * pressable beside the crumb that is not; D-016 took Home away, so the price now is that the block
 * the act census skips holds no control at all.
 */
function stateWords(m: Mounted): HTMLElement[] {
  const bar = m.q('session-header')
  return [...bar.querySelectorAll<HTMLElement>('[data-cy]')].filter(
    (el) =>
      el.tagName !== 'BUTTON' &&
      el.closest('button') === null &&
      el.closest('.header-title') === null &&
      // ⛔ **Carriers, not the groups that hold them.** `.agent-standing` wraps the plate and the
      // word and inherits the page's own size; comparing the standing against its own parent would
      // be comparing it against itself and would fail for a reason that means nothing.
      el.querySelector('[data-cy]') === null &&
      el.innerText.trim() !== '',
  )
}

/** The acts, likewise: the bar's controls, never anything in the identity block. */
function acts(m: Mounted): HTMLElement[] {
  return [...m.q('session-header').querySelectorAll<HTMLElement>('button')].filter(
    (el) => el.closest('.header-title') === null,
  )
}

/**
 * ⛔ The price of excluding the identity block: it hides no control from {@link acts}, so a button
 * found in it is an act the census above never measured.
 */
function theIdentityBlockHidesNoControl(m: Mounted): void {
  const block = m.q('session-header').querySelector<HTMLElement>('.header-title')
  expect(block, 'the identity block is gone — the exclusion names nothing').not.toBeNull()
  expect(block!.querySelector('[data-cy="conversation-title"]')).not.toBeNull()
  expect(
    [...block!.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')].map(
      (el) => el.dataset['cy'] ?? el.textContent?.trim(),
    ),
    'a control sits in the block the act census skips',
  ).toEqual([])
}

/* ------------------------------------------------- §0 · the two components, drawn on their own */

/**
 * 🔴 **The two components this file carries a `measured` standing for, mounted as themselves.**
 *
 * ⛔ **Every other section drives them through `ConversationPane`, which is how the app draws
 * them** — and that is the right subject for a question about what a PERSON sees. ⚠️ But the
 * clipped-text ledger's word is about a COMPONENT: *"a dom suite draws this component with
 * `drawn.ts`, at a width the app really uses"*, and a claim about `SessionHeader.vue` that can only
 * be made through a parent is a claim that would survive the parent being the thing that fixed it.
 *
 * ⚑ **So each is swept on its own, in its own box, at the pane's own narrowest real width** — and
 * `.header-title`'s `<h1>` is the one carrier admitted to overflow, which is the half-leading the
 * ledger's note has named since `531`.
 */
describe('§0 · the bar and the strip, drawn as themselves (the ledger’s own claim)', () => {
  it('🔴 `SessionHeader` draws every string it carries, in its own box', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    const m = mount(
      SessionHeader,
      {
        session: LOUD_TAKEN,
        status: 'idle',
        debug: false,
        capabilities: null,
        facets: { doing: 'idle', being: 'live' },
      },
      { width, height: PANE_H },
    )
    // ⛔ `.conversation-pane` is a COLUMN and this component has more than one root; the harness box
    // is a row by default, which is a geometry the app never draws.
    m.host.style.flexDirection = 'column'
    await nextTick()
    await drawnReady()

    const bar = m.q('session-header')
    for (const el of [...bar.querySelectorAll<HTMLElement>('*')].filter(
      (one) => one.children.length === 0 && (one.textContent ?? '').trim() !== '',
    )) {
      if (el.closest('.header-title') !== null) continue
      if (cutsOf(el, bar).length === 0) continue
      expect(titleRecovers(el, bar), `"${el.textContent?.trim()}" is cut and nothing tells`).toBe(
        true,
      )
    }
    // ⚑ **D-017b** — the act drawn whole here was *End conversation*; it is *Hand it back* now.
    assertDrawn(m.q('hand-it-back'), 'Hand it back, in the bar’s own box')
    assertDrawn(m.q('session-status'), 'the standing, in the bar’s own box')
  })

  it('🔴 `UsageCards` draws every cell it carries, in its own box', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    // ⚑ The cards as the title bar opens them, at the pane's narrowest.
    const m = await usageCards(width, 300)
    await drawnReady()

    const strip = m.q('shelf-settings')
    // ⚑ The usage cells, each drawn whole in the strip's own box at the pane's narrowest.
    for (const key of ['claude-5h', 'claude-week', 'codex-week']) {
      assertDrawn(m.q(`shelf-usage-${key}`), `the ${key} cell in the strip’s own box`, strip)
    }
    // ⛔ **Named, so the list is a measurement**: the session's settings left the strip.
    for (const key of ['model', 'reasoning', 'profile', 'plan', 'approval']) {
      expect(m.all(`shelf-${key}`)).toHaveLength(0)
    }
  })
})

/* ------------------------------------------------------ §1 · the control that was losing (§1.2) */

describe('§1 · the act that carries a word keeps it, at every width the app can be (EXT-010 §1.2)', () => {
  it.each(PANE_WIDTHS)(
    '🔴 drawn in full at %ipx — the pane at the app’s own floor and default',
    async (width) => {
      await page.viewport(width, PANE_H)
      const m = pane(LOUD_TAKEN, width)
      await nextTick()
      await drawnReady()

      // ⚑ **D-017b · re-aimed from `End conversation`**, which left the bar, onto the one act that
      // still carries a word.
      const act = m.q('hand-it-back')
      // ⛔ **The word, not the element.** A button drawn as a 30px box with `Han` in it passes every
      // assertion about markup.
      expect(act.innerText.replace(/\s+/g, ' ').trim()).toBe('Hand it back')
      assertDrawn(act, `the Hand it back button at ${width}px`)
    },
  )

  it('⛔ …and so does every other act — the acts group cannot give', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    const m = pane(LOUD_TAKEN, width)
    await nextTick()
    await drawnReady()

    // ⚑ **Derived from the mount**: every button in the bar, whatever it happens to be today.
    // ⚑ **D-017b · three, not four** — *End conversation* left the bar; hand-back, the lifecycle
    // toggle and the drawer toggle are what stand in it.
    const buttons = acts(m)
    expect(
      buttons.length,
      'the bar drew no buttons — this measures nothing',
    ).toBeGreaterThanOrEqual(3)
    for (const act of buttons) {
      expect(visible(act), `an act is not visible at ${width}px`).toBe(true)
      assertDrawn(act, `${act.dataset['cy'] ?? act.className} at ${width}px`)
    }
  })

  it('⚑ the standing cannot give either — it and the acts are the two that never shrink', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    const m = pane(LOUD, width, 'working')
    await nextTick()
    await drawnReady()

    const word = m.q('session-status')
    expect(word.innerText.trim()).toBe(STANDING_LABEL.working)
    assertDrawn(word, `the standing at ${width}px`)
    // ⛔ **The plate beside it too** — one lockup, and a plate squeezed into the word is what a
    // default `flex-shrink: 1` did before this dispatch pinned both halves.
    const plate = m.q('agent-state')
    const wordBox = word.getBoundingClientRect()
    expect(plate.getBoundingClientRect().right).toBeLessThanOrEqual(wordBox.left + 0.5)
  })

  /**
   * 🔴 **The hazard is PLANTED, and saying so is the honest half of this section.**
   *
   * ⛔ **Today's bar cannot overflow at any width the app can be.** Moving the three warnings off the
   * row took ~500px of unshrinkable `nowrap` text out of it (`578` put them in a band under the bar,
   * and 2026-10-01 took the band away), the `<h1>` ellipsises, and the pending marker shrinks — so
   * nothing left on the strip can push the acts. ⚠️ **That
   * makes `flex: 0 0 auto` on the acts and on the standing a rule about the NEXT pill somebody
   * adds**, and a rule nothing can make fail is not carrying anything
   * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
   *
   * ⚑ **So the pressure is put on the path the code walks**: one wide, unshrinkable element in the
   * state group, which is exactly the shape the three warnings were. ⛔ `578`'s mutation table has
   * both rows and neither goes red without this.
   */
  it('🔴 a wide unshrinkable state pushes NOTHING off — the acts and the standing do not give', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    const m = pane(LOUD_TAKEN, width, 'working')
    await nextTick()
    await drawnReady()

    const group = m.host.querySelector<HTMLElement>('.header-state')
    expect(group, 'the state group is gone — this plants nothing').not.toBeNull()
    const hazard = document.createElement('span')
    // ⚑ **D-017b · longer than it was** — the bar gave the state group the room *End conversation*
    // took, and the first sentence then fit in it (555px of 555px): the control below went red,
    // which is its job. The plant is re-sized; the rule it presses on is not.
    hazard.textContent =
      'a state nobody has written yet, stated at length and unwilling to wrap, ' +
      'and then stated again at greater length still'
    hazard.style.cssText = 'white-space:nowrap;font-size:14px;flex:0 0 auto'
    group!.append(hazard)
    await nextTick()
    await drawnReady()

    // ⚑ **The control: the hazard really is wider than the room it was given**, so the two
    // assertions under it are readings rather than a plant that changed nothing.
    expect(hazard.getBoundingClientRect().width).toBeGreaterThan(300)
    const bar = m.q('session-header')
    expect(group!.scrollWidth).toBeGreaterThan(group!.clientWidth)

    assertDrawn(m.q('hand-it-back'), 'Hand it back under pressure', bar)
    assertDrawn(m.q('session-status'), 'the standing under pressure', bar)
    expect(m.q('hand-it-back').innerText.replace(/\s+/g, ' ').trim()).toBe('Hand it back')
  })

  it('⛔ nothing on the bar is cut without a tooltip that brings it back', async () => {
    const width = PANE_WIDTHS[0]
    await page.viewport(width, PANE_H)
    const m = pane(LOUD, width)
    await nextTick()
    await drawnReady()

    const bar = m.q('session-header')
    const carriers = [...bar.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim() !== '',
    )
    // ⚑ The title and the standing at least.
    expect(carriers.length, 'nothing on the bar carries text').toBeGreaterThanOrEqual(2)
    for (const el of carriers) {
      const cuts = cutsOf(el, bar)
      if (cuts.length === 0) continue
      // ⚠️ **A cut is allowed only where the whole string is recoverable**, which in this app means
      // a `title` on the element or on an ancestor — the shipped good pattern the clipped-text
      // census calls `shortened-on-purpose`.
      expect(
        titleRecovers(el, bar),
        `"${el.textContent?.trim()}" is cut at ${width}px and nothing brings it back`,
      ).toBe(true)
    }
  })
})

/* --------------------------------------------------- §2 · the fact that may not give (§1.4) */

describe('§2 · the standing carries visible priority over everything else on the strip (EXT-010 §1.4)', () => {
  /**
   * 🔴 **The PO's sentence, as a property rather than a picture.**
   *
   * > ⛔ *"`Idle` is the only thing telling a person the turn has finished — same size, same
   * > weight, same treatment as `not planning`."*
   *
   * ⚑ **So the assertion is a comparison in ONE mount**: the standing's computed size and weight
   * against every other state string on the bar. ⛔ It is deliberately not a number — a pinned
   * `11px` would go green the day everything else grew to 11px too, which is the exact state this
   * dispatch was sent to end.
   */
  it('🔴 it is the largest and the heaviest state string on the bar — measured, not pinned', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    const m = pane(LOUD, PANE_WIDTHS[1], 'working')
    await nextTick()
    await drawnReady()

    const standing = m.q('session-status')
    const mine = getComputedStyle(standing)
    const others = stateWords(m).filter((el) => el !== standing)
    expect(
      others.length,
      'nothing else on the bar states anything — no comparison was made',
    ).toBeGreaterThanOrEqual(2)

    for (const other of others) {
      const theirs = getComputedStyle(other)
      expect(
        parseFloat(mine.fontSize),
        `${other.dataset['cy']} is drawn as large as the standing`,
      ).toBeGreaterThan(parseFloat(theirs.fontSize))
      expect(
        Number(mine.fontWeight),
        `${other.dataset['cy']} is drawn as heavy as the standing`,
      ).toBeGreaterThanOrEqual(Number(theirs.fontWeight))
    }
  })

  it('⛔ …and only the title outranks it, which is the one thing that should', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    const m = pane(RUNNING, PANE_WIDTHS[1], 'working')
    await nextTick()
    const standing = parseFloat(getComputedStyle(m.q('session-status')).fontSize)
    const title = parseFloat(getComputedStyle(m.q('conversation-title')).fontSize)
    expect(title).toBeGreaterThan(standing)
  })

  it('⚠️ every tone it can wear is legible on the bar it sits on', async () => {
    // ⛔ **The header is inside the pane's LIGHT scope**, and `--waiting-text-label` /
    // `--accent-text-pale` / `--danger-text` were chosen as ink in a PILL. ⚑ The pill is gone, so
    // the ink now sits on the bar's own fill and the contrast is re-measured rather than assumed
    // (`an-alpha-fill-in-a-light-scope-is-not-a-light-surface`).
    for (const [status, ended] of [
      ['working', false],
      ['waiting_permission', false],
      ['idle', false],
      ['idle', true],
    ] as const) {
      await page.viewport(PANE_WIDTHS[1], PANE_H)
      const m = pane(RUNNING, PANE_WIDTHS[1], status)
      await nextTick()
      const word = m.q('session-status')
      if (ended) word.setAttribute('data-status', 'ended')
      // ⛔ `parseColor` answers `null` for a value it cannot read, and a test that coerced that
      // away would report a contrast about a colour nobody resolved.
      const ink = parseColor(getComputedStyle(word).color)
      expect(ink, `${status}: the standing's ink did not resolve`).not.toBeNull()
      const ground = paintedBackground(word)
      expect(
        contrast(ink!, ground),
        `${status}: ${show(ink!)} on ${show(ground)}`,
      ).toBeGreaterThanOrEqual(4.5)
      m.unmount()
    }
  })
})

/* --------------------------------------------- §3 · state is text, controls are boxes (§1.3/§2.1) */

describe('§3 · a state word is not styled as a control (EXT-010 §1.3, and §2.2’s mirror)', () => {
  /**
   * ⛔ **`EXT-010` §2.1's rail, measured in both directions in one mount.**
   *
   * > ⛔ *"All of them are state; none of them is pressable."*
   *
   * ⚠️ **Both halves, because either alone is satisfiable by a blank bar**: no state element may
   * declare a solid border or a painted fill, AND every control must declare both. ⛔ The two sets
   * are derived from the mounted tree — `BUTTON` or not — rather than from a list of classes,
   * which is what stops this going quiet the day a fourth chip arrives.
   */
  it('🔴 no state element wears button chrome, and every control does', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    // ⚑ **D-017b · taken over**, so the bar still holds a word-carrying `ghost-button` among its
    // controls now that *End conversation* — the one that was — has left it.
    const m = pane(LOUD_TAKEN, PANE_WIDTHS[1])
    await nextTick()

    // ⚠️ **An unreadable colour is not a transparent one.** `parseColor` answers `null` where it
    // cannot resolve the value, and treating that as *no fill* would let an unparsed background
    // satisfy the state half of this rule silently.
    const painted = (el: HTMLElement): boolean => {
      const fill = parseColor(getComputedStyle(el).backgroundColor)
      expect(
        fill,
        `${el.dataset['cy'] ?? el.className}: its background did not resolve`,
      ).not.toBeNull()
      return fill![3] > 0
    }
    const solid = (el: HTMLElement): boolean => {
      const s = getComputedStyle(el)
      return s.borderStyle === 'solid' && parseFloat(s.borderTopWidth) > 0
    }

    const states = stateWords(m)
    expect(
      states.length,
      'no state strings were found — nothing was measured',
    ).toBeGreaterThanOrEqual(3)
    for (const el of states) {
      expect(painted(el), `${el.dataset['cy']} is painted like a control`).toBe(false)
      expect(solid(el), `${el.dataset['cy']} wears a solid border like a control`).toBe(false)
    }

    // ⚑ **The other half.** A bar whose controls had also lost their chrome would pass the loop
    // above and be a worse surface than the one this dispatch was sent to fix.
    const buttons = acts(m)
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    for (const act of buttons) {
      expect(painted(act), `${act.dataset['cy']} is a control with no fill`).toBe(true)
      expect(solid(act), `${act.dataset['cy']} is a control with no border`).toBe(true)
    }

    theIdentityBlockHidesNoControl(m)
  })
})

/* ------------------- §4 · the facts the header used to answer with a row cost it no height */

/** ⚑ `740`'s measured Claude rule — *"Yes, and don't ask again for: make build \*"* — kept here. */
const MAKE_BUILD = { kind: 'tool' as const, tool: 'Bash', content: 'make build *' }

/** ⚑ The card that asked it, answered *Always allow*: the one fact the pane derives rather than reads. */
const KEPT_HERE: TranscriptEvent[] = [
  {
    type: 'permission_request',
    id: 'req_kept',
    kind: 'command',
    action: 'Bash',
    detail: 'make build',
    scope: {
      cwd: '/work/checkout',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_always: [MAKE_BUILD],
        alwaysFile: '/work/checkout/.claude/settings.local.json',
      },
      amendments: [],
      availableDecisions: ['allow', 'allow_always', 'deny'],
      underDisclosed: true,
    },
  } as never,
  {
    type: 'user_decision',
    requestId: 'req_kept',
    outcome: 'allow_always',
    by: { who: 'a-person' },
  },
]

/** One conversation the header can be handed — its host facts, its folded rows and its status. */
interface Carries {
  readonly meta: typeof META
  readonly events: readonly TranscriptEvent[]
  readonly status: string
}

/** ⚑ The ordinary conversation: none of the facts below. */
const NONE: Carries = { meta: RUNNING, events: [], status: 'idle' }

/**
 * 🔴 **Each fact the header used to answer with a row of its own, toggled ONE at a time** — and
 * then all of them at once. ⚑ Every arm is the ordinary conversation one fact over.
 */
const ONE_FACT_OVER: ReadonlyArray<readonly [string, Carries]> = [
  ['another caller can drive it', { ...NONE, meta: { ...RUNNING, hasACommander: true } }],
  [
    'it is not asked again about five tools',
    {
      ...NONE,
      meta: {
        ...RUNNING,
        blanketGrants: ['Bash(git status)', 'Write', 'Read', 'Glob', 'WebFetch(docs)'],
      },
    },
  ],
  ['a rule was kept with Always allow', { ...NONE, events: KEPT_HERE }],
  [
    'this window can hand it back',
    { ...NONE, meta: { ...RUNNING, mayHandItBack: true, startedWithoutAWindow: true } },
  ],
  [
    'this window can hand it back while a question waits',
    {
      meta: { ...RUNNING, mayHandItBack: true, startedWithoutAWindow: true },
      events: [permission('req_open')],
      status: 'waiting_permission',
    },
  ],
  [
    'all of them',
    {
      meta: {
        ...RUNNING,
        hasACommander: true,
        blanketGrants: ['Bash(git status)', 'Write', 'Read', 'Glob', 'WebFetch(docs)'],
        mayHandItBack: true,
        startedWithoutAWindow: true,
      },
      events: KEPT_HERE,
      status: 'idle',
    },
  ],
]

/** ⚑ The pane as the app draws it, with the drawer open on Info — where these facts ARE said. */
function carrying(what: Carries, width: number): Mounted {
  ;(window as { api?: unknown }).api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const held = record([...what.events, { type: 'status', state: what.status } as never])
  held.meta = what.meta
  return mount(ConversationPane, paneProps({ record: held, drawerOpen: true, drawerTab: 'info' }), {
    width,
    height: PANE_H,
  })
}

/**
 * ⛔ **What the header component draws, measured in the engine** — the `<header>` AND every element
 * after it up to the shelf the pane draws next, because this component has more than one root and
 * a row under the bar is a sibling of the bar, not inside it.
 */
function footprint(m: Mounted): { bar: number; drawn: number; shelfAt: number; roots: string[] } {
  const bar = m.q('session-header')
  const shelf = m.q('session-shelf')
  const roots: HTMLElement[] = []
  let at: Element | null = bar
  while (at !== null && at !== shelf) {
    roots.push(at as HTMLElement)
    at = at.nextElementSibling
  }
  // ⚑ The premise: the shelf really is the next thing the pane draws, so the walk above stopped at
  // the header's last root rather than running off the end of the pane.
  expect(at, 'the shelf is not drawn after the header — the walk measured the wrong thing').toBe(
    shelf,
  )
  // ⚑ From the PANE's top, so a row the header drew ABOVE its bar is counted too.
  const top = m.q('conversation-pane').getBoundingClientRect().top
  return {
    bar: bar.getBoundingClientRect().height,
    drawn: Math.max(...roots.map((el) => el.getBoundingClientRect().bottom)) - top,
    shelfAt: shelf.getBoundingClientRect().top - top,
    roots: roots.map((el) => el.dataset['cy'] ?? el.className),
  }
}

describe('§4 · the facts the header used to answer with a row cost it no height (2026-10-01)', () => {
  /**
   * Conversation warnings must not change the header’s height when switching between agents.
   *
   * ⛔ **The header drew a row under its bar for each of these facts, and only when it was true** —
   * a band of warnings (another caller, the grants not asked again, the grants kept) and a line
   * under the hand-back press — so the page under it moved as a person went from one agent to the
   * next. ⚑ **Every fact is still SAID, in the drawer's Info tab**, and each arm reads it there in
   * the same mount: the header's height is measured beside a reading that the fact really arrived.
   * ⚠️ **One occasional row remains, outside this ruling and not measured here**: the
   * `.liveness-detail` line, drawn under the bar when the provider is not live and says why.
   */
  it.each(PANE_WIDTHS)(
    '🔴 at %ipx, a commander, grants, a kept grant and a hand-back offer change neither the bar nor what is under it',
    async (width) => {
      await page.viewport(width, PANE_H)
      const quiet = carrying(NONE, width)
      await nextTick()
      await drawnReady()
      const ordinary = footprint(quiet)
      // ⚑ The ordinary conversation draws its bar and nothing under it — the height every other
      // arm is held to — and none of the facts below is on its Info tab.
      expect(ordinary.bar, 'the bar drew no height — nothing was measured').toBeGreaterThan(20)
      expect(ordinary.drawn, `drawn under the bar: ${ordinary.roots.join(', ')}`).toBeCloseTo(
        ordinary.bar,
        0,
      )
      expect(quiet.q('session-cwd').innerText.trim()).toBe('/work/checkout')
      for (const cy of ['info-has-a-commander', 'info-grants', 'info-kept', 'hand-it-back']) {
        expect(quiet.all(cy), `${cy} on the ordinary conversation`).toHaveLength(0)
      }
      quiet.unmount()

      for (const [fact, what] of ONE_FACT_OVER) {
        const m = carrying(what, width)
        await nextTick()
        await drawnReady()
        // ⚑ **The premise, read on the same mount**: the fact arrived, and the window says it.
        if (what.meta.hasACommander) {
          expect(m.q('info-has-a-commander').innerText).toContain(ANOTHER_CALLER_IS_ON_IT)
        }
        if (what.meta.blanketGrants.length > 0) {
          expect(m.q('info-grants').innerText).toContain('WebFetch(docs)')
        }
        if (what.events === KEPT_HERE) {
          expect(m.q('info-kept').innerText).toBe(
            'commands starting with make build (Bash(make build *))',
          )
        }
        if (what.meta.mayHandItBack) {
          expect(m.q('hand-it-back').innerText.replace(/\s+/g, ' ').trim()).toBe(HAND_IT_BACK)
          // ⛔ …and its sentence did not move onto the press as a tooltip.
          expect(m.q('hand-it-back').getAttribute('title') ?? '').not.toContain('lets go of it')
        }
        if (what.status === 'waiting_permission') {
          expect(m.q('session-status').dataset['status']).toBe('waiting_permission')
        }

        // ⛔ **The withdrawal itself**, each absence beside the Info reading above: none of the removed
        // marks and no hand-back sentence is drawn by the header — as a row, in the bar, or as words.
        for (const gone of [
          'header-warnings',
          'hand-it-back-line',
          'session-has-a-commander',
          'session-blanket-grants',
          'session-kept-grants',
        ]) {
          expect(m.all(gone), `${fact}: ${gone} is drawn again`).toHaveLength(0)
        }
        const barSays = m.q('session-header').innerText
        for (const said of ['without you', 'not asked again', 'kept beyond', 'lets go of it']) {
          expect(barSays, `${fact}: the bar says "${said}" again`).not.toContain(said)
        }

        const loaded = footprint(m)
        // The same bar remains, with nothing added beneath it, and the shelf stays in the
        // same position.
        expect(loaded.bar, `${fact}: the bar changed height`).toBeCloseTo(ordinary.bar, 1)
        expect(
          loaded.drawn,
          `${fact}: the header grew under its bar — it drew ${loaded.roots.join(', ')}`,
        ).toBeCloseTo(ordinary.drawn, 1)
        expect(loaded.shelfAt, `${fact}: the page under the header moved`).toBeCloseTo(
          ordinary.shelfAt,
          1,
        )
        m.unmount()
      }
    },
  )
})

/* ---------------------------------------------------------------- §5 · the strip below it */

describe('§5 · the strip below the bar says usage; the settings are the Agent panel’s (EXT-010 §1.1)', () => {
  it('🔴 the model and the effort are on neither the bar nor the shelf', async () => {
    await page.viewport(PANE_WIDTHS[0], PANE_H)
    const m = pane(RUNNING, PANE_WIDTHS[0])
    await nextTick()
    await drawnReady()

    // ⛔ The same mount, so the one location is measured rather than two files read apart.
    for (const where of ['session-header', 'session-shelf']) {
      const words = m.q(where).innerText
      expect(words, `${where} says the model`).not.toContain('claude-opus-5')
      expect(words, `${where} says the effort`).not.toContain('high')
    }
    // ⚑ …and the bar drew: it names the provider. The usage cells are the title bar's now.
    expect(m.q('session-header').innerText).toContain('claude')
    expect(m.all('shelf-usage-claude-5h')).toHaveLength(0)
    const cards = await usageCards(PANE_WIDTHS[0], 300)
    await drawnReady()
    assertDrawn(cards.q('shelf-usage-claude-5h'), 'the first usage cell')
  })

  /**
   * 🔴 **`579` relay 3 · this test caught a shipped defect, and then the CLAIM was re-derived.**
   *
   * ⛔ **It read `toHaveLength(5)` and a division by five and six, all typed.** ⚠️ When the
   * `APPROVAL MODE` cell went, the count went red — correctly — but the stylesheet still said
   * `repeat(5, minmax(0, 1fr))`, so the strip drew **four cells and an empty fifth column**, and
   * the *fix* that only edited the number here would have gone green over it.
   *
   * ⚑ **So the grid counts its own children now** (`grid-auto-flow: column`), and this asserts the
   * PROPERTY rather than the number: **every cell is an equal share of the strip, whatever there
   * are of them, and nothing is left over.** ⛔ A typed `4` here would be the same trap one cell
   * further on.
   */
  it('⚠️ the cells share the strip equally, and none of it is left over', async () => {
    await page.viewport(PANE_WIDTHS[0], PANE_H)
    const m = await usageCards(PANE_WIDTHS[0], 300)
    const strip = m.host.querySelector<HTMLElement>('[data-cy="shelf-settings"]')
    expect(strip).not.toBeNull()
    // ⚑ The strip's own children: each cell holds hooks of its own (its age, its value).
    const cells = [...strip!.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-cy^="shelf-"]'),
    )
    // ⚑ **A floor, not a count** — the strip has to have drawn something for the rest to mean
    // anything, and pinning the number is what went stale twice.
    expect(cells.length, 'the strip drew nothing').toBeGreaterThan(2)

    // 🔴 **Every cell is 1/N of the strip, and N is what the strip DREW.** ⛔ This is the
    // assertion that catches the empty-column defect: with `repeat(5, …)` and four cells each
    // cell is a fifth, `4 × (w/5) < w`, and the leftover is the hole.
    // ⚠️ **`clientWidth`, not the bounding box** — `.shelf-settings` carries a 1px border, so the
    // grid's tracks fill the CONTENT box and the two borders are exactly the 2px the first
    // version of this assertion was out by. ⛔ Measured, not nudged: the tolerance stayed at 2px
    // and the denominator was corrected, because a tolerance widened to absorb a known offset is
    // a tolerance that would also absorb the hole this test exists to find.
    const stripWidth = strip!.clientWidth
    const widths = cells.map((cell) => cell.getBoundingClientRect().width)
    for (const width of widths) {
      expect(Math.abs(width - stripWidth / cells.length)).toBeLessThan(2)
    }
    // ⛔ **…and they add up to the whole strip**, which is the same claim said once and is the one
    // a hole cannot satisfy.
    expect(Math.abs(widths.reduce((a, b) => a + b, 0) - stripWidth)).toBeLessThan(2)
  })
})

/* ------------------------------------------- §6 · one plate says who it is, and never none */

describe('§6 · the small plate is drawn only where the panel’s card does not show the agent', () => {
  /** The pane with its panel in a given state, at a width that docks it or floats it. */
  function withPanel(width: number, drawerOpen: boolean, drawerTab = 'open'): Mounted {
    ;(window as { api?: unknown }).api = {
      runtime: {
        listResumable: () => Promise.resolve([]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const held = record([{ type: 'status', state: 'idle' } as never])
    held.meta = RUNNING
    return mount(ConversationPane, paneProps({ record: held, drawerOpen, drawerTab }), {
      width,
      height: PANE_H,
    })
  }

  /** The plates drawn inside the header, and inside the panel. */
  async function plates(m: Mounted): Promise<{ header: number; panel: number; fit: string }> {
    await nextTick()
    await drawnReady()
    const panel = m.host.querySelector('[data-cy="session-drawer"]')
    return {
      header: m.q('session-header').querySelectorAll('[data-cy="agent-state"]').length,
      panel: panel?.querySelectorAll('[data-cy="agent-state"]').length ?? 0,
      fit: m.host.querySelector<HTMLElement>('.pane-body')?.dataset['fit'] ?? '',
    }
  }

  it('🔴 docked open on its Open tab, the card’s plate is the one plate', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    const drawn = await plates(withPanel(PANE_WIDTHS[1], true))
    expect(drawn.fit, 'the panel does not dock at this width — this measures nothing').toBe(
      'docked',
    )
    expect(drawn.panel).toBeGreaterThanOrEqual(1)
    expect(drawn.header).toBe(0)
  })

  it('⛔ …and the standing still reads, beside where the plate was', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    const m = withPanel(PANE_WIDTHS[1], true)
    await plates(m)
    assertDrawn(m.q('session-status'), 'the standing with no plate beside it')
  })

  it.each([
    ['the panel is shut', PANE_WIDTHS[1], false, 'open'],
    ['the panel shows another tab', PANE_WIDTHS[1], true, 'info'],
    ['the panel floats over a narrow pane', 760, true, 'open'],
  ] as const)('⚑ the header keeps its plate when %s', async (_, width, open, tab) => {
    await page.viewport(width, PANE_H)
    const drawn = await plates(withPanel(width, open, tab))
    expect(drawn.header).toBe(1)
    if (width === 760) expect(drawn.fit).toBe('overlay')
    if (tab !== 'open' || !open) expect(drawn.panel).toBe(0)
  })

  it('🔴 the header keeps its height whether the plate is drawn or not — nothing under it moves', async () => {
    await page.viewport(PANE_WIDTHS[1], PANE_H)
    const measured: Array<{ state: string; header: number; plate: number; bodyAt: number }> = []
    for (const [state, open, tab] of [
      ['shut', false, 'open'],
      ['docked on Open', true, 'open'],
      ['docked on Info', true, 'info'],
    ] as const) {
      const m = withPanel(PANE_WIDTHS[1], open, tab)
      const drawn = await plates(m)
      const top = m.q('conversation-pane').getBoundingClientRect().top
      measured.push({
        state,
        header: m.q('session-header').getBoundingClientRect().height,
        plate: drawn.header,
        bodyAt: m.host.querySelector('.pane-body')!.getBoundingClientRect().top - top,
      })
      m.unmount()
    }
    // ⚑ The premise: the plate really is drawn in one state and left out in another.
    expect(measured.map((one) => one.plate)).toEqual([1, 0, 1])
    const [first] = measured
    for (const one of measured) {
      expect(one.header, `${one.state}: the header changed height`).toBeCloseTo(first!.header, 1)
      expect(one.bodyAt, `${one.state}: the page under the header moved`).toBeCloseTo(
        first!.bodyAt,
        1,
      )
    }
  })
})
