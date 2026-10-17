import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ImageViewer from '../../src/renderer/src/components/ImageViewer.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import SessionTools from '../../src/renderer/src/components/SessionTools.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import ToastStack from '../../src/renderer/src/components/ToastStack.vue'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import {
  channelGap,
  contrast,
  luminance,
  mount,
  over,
  paintedBackground,
  parseColor,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * **346 · The overlays too — measured in a real cascade rather than looked at.**
 *
 * Overlay sheets use the light scheme, including decision surfaces outside the body’s scope.
 *
 * ⛔ **The risk this file exists for is not the one `344` guarded against.** A stranded-token scan
 * looks for the WRONG colour — a near-black chip on paper — and every failure mode here is the
 * right colour twice over:
 *
 *  1. **A white document dissolving into a white sheet.** `DocumentBody`'s `.doc-paper` is
 *     `--paper-bg`, designed to be the light thing on dark chrome; a sheet at `--panel` is `#fff`
 *     in a light scope. Measured below: their fills are **8 channel levels apart**, which is
 *     nothing, so the fill cannot be what separates them and this file says which thing is.
 *  2. **A dim tuned for near-black, over paper.** `--overlay-backdrop` is 58% black on `:root` and
 *     32% of a blue-grey in a light scope; the second has existed since `080` and, until 346,
 *     `OverlayHost` could not reach it.
 *  3. 🔴 **An INK that was never re-resolved.** `color` inherits as a resolved colour rather than as
 *     the `var()` that produced it, so `body`'s `#e7ecf3` reached inside the scope and every sheet
 *     computed the chrome's near-white on its own root. Nothing was invisible — every text element
 *     in those sheets declares a colour of its own — so no screenshot and no fill assertion could
 *     have found it. It was caught by reading the live probe's own output, and it is 091's
 *     `--panel-3` arriving through a property nobody had thought to name.
 *
 * ⚠️ **Every panel is mounted inside a real `OverlayHost`**, not into a div with the attribute set
 * by hand. The carrier is the thing 346 changed, so a test that set the scope itself would stay
 * green through the attribute being deleted from the host — which is the entire dispatch.
 */

/**
 * ⚠️ **`StartAsAgent` reaches the preload bridge in `setup`** — the window's agent store is built
 * over `window.api.runtime` — **and throws without one.** The stub answers nothing this file reads;
 * it only asks what the sheet paints, and a sheet that threw during setup paints nothing at all.
 * ⚑ D-016 · it answered `ProjectSheet`'s row too, until that sheet was deleted.
 */
const stubbed = (): { api?: unknown } => window as unknown as { api?: unknown }
stubbed().api = {
  runtime: {
    checkCwd: async () => ({ ok: true, path: '/work/brobot2' }),
  },
  chooseCwd: async () => null,
}

/**
 * A store already holding one identity, so the sheet paints its controls rather than its
 * *"reading…"* line — a panel that drew one sentence would measure almost nothing (355).
 */
function capabilityStore(): AgentStore {
  const store = createAgentStore({
    agentIdentities: async () => ({
      identities: [
        {
          id: 'agp:default:pm',
          slug: 'pm',
          displayName: null,
          createdAt: 1_700_000_000_000,
          provider: null,
          capabilities: DEFAULT_CAPABILITIES,
          chosen: {
            maxDepth: 'default',
            canMessage: 'default',
            canAssignWork: 'default',
            canCreateAgents: 'default',
            canWriteRules: 'default',
          },
        },
      ],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
    }),
  } as unknown as RuntimeBridge)
  void store.load()
  return store
}

afterEach(() => {
  unmountAll()
  // The overlay store is a module singleton: a toast raised here would otherwise be on screen for
  // whatever mounts next.
  useOverlays().toasts.value = []
})

/** The app as it really is at this layer: a host that is the backdrop, with one panel on it. */
const Hosted = (panel: Component, props: Record<string, unknown>): Component =>
  defineComponent({
    name: 'HostedOverlay',
    setup() {
      return () => h(OverlayHost, { label: 'A sheet' }, { default: () => h(panel, props) })
    },
  })

interface Overlay {
  what: string
  component: Component
  props: Record<string, unknown>
  /** The element that carries the panel's own fill — never the host, which is the backdrop. */
  cy: string
  /** A floor for the walk, so `toEqual([])` cannot pass over a panel that failed to render. */
  minElements: number
  /** Whether this panel renders a `DocumentBody` — §1's whole risk. */
  paper: boolean
  /**
   * ⚠️ **One panel is deliberately TRANSLUCENT and it is not the odd one out by accident.** The
   * image viewer is a frosted sheet over the transcript (`--drawer-bg`, 60% in light and 40% in
   * dark), so `paintedBackground` — which walks up until something is opaque — answers about what
   * is behind it and not about it. Measured that way it reads `rgb(161, 162, 165)`, which is a
   * correct reading of the wrong element. Its own declared fill is what carries the theme, and the
   * opaque thing under it is its `.stage` mat, which is `--paper-bg` in both themes by design.
   */
  translucent?: true
}

const OVERLAYS: readonly Overlay[] = [
  {
    /**
     * 🔴 **358's sheet, and it is on this list because this list is HAND-WRITTEN.** There is no
     * completeness check tying it to what the app hosts, so a panel omitted here is silently
     * unchecked rather than red — which is exactly how a new surface comes to be the one nobody
     * measured. ⚑ Raised by `ConversationPane`'s own host, INSIDE a surface that has carried the
     * light scope since `344`, so it inherits and declares nothing.
     */
    what: 'the tools sheet, which is a per-conversation inventory rather than a document',
    component: SessionTools,
    props: {
      tools: {
        set: {
          naming: { prefix: 'mcp__', separator: '__' },
          declared: {
            server: 'brobot',
            tools: [
              {
                name: 'spawn_agent',
                description: 'Create another agent.',
                parameters: [{ name: 'profile_slug', type: 'string', required: true }],
              },
            ],
          },
          published: {
            tools: ['Bash', 'mcp__brobot__spawn_agent'],
            servers: [{ name: 'brobot', status: 'connected' }],
          },
        },
        dropped: 0,
        // ⛔ **444 relay 1 made this REQUIRED and this literal was still missed**, because
        // `Overlay.props` is `Record<string, unknown>` — so `vue-tsc` checks nothing here and the
        // sheet mounted for real with `at: undefined`, drawing a dangling `Stated .` that none of
        // this file's three assertions can see. ⚑ Found reviewing the diff; the formatter is
        // guarded now as well, so this is the belt and `inventoryAsOf` is the braces.
        at: Date.UTC(2023, 4, 17, 9, 41, 7),
      },
    },
    cy: 'session-tools',
    minElements: 15,
    // ⛔ **`false` — it renders no `.doc-paper`, and that is a ruling rather than an omission.** The
    // document-viewer standard is about a DOCUMENT: Markdown/Raw views on white paper, wherever one
    // renders. An inventory is data about the conversation, like the Changes pane or the context
    // meter, and wrapping a tool list in a document body would claim there is a file behind it —
    // which is the whole misconception `358` exists to correct.
    paper: false,
  },
  {
    /**
     * 🔴 **510 · the canonical document a work report names, and it is on this list because the
     * list is HAND-WRITTEN.** ⛔ The paragraph on `SessionTools` above predicted exactly this:
     * *"a panel omitted here is silently unchecked rather than red — which is exactly how a new
     * surface comes to be the one nobody measured."* ⚑ Nothing in the suite went red when this
     * panel shipped; the only thing that put a row here was a person reading that sentence.
     */
    what: 'the canonical document viewer, opened from a work report',
    component: CanonicalDocumentViewer,
    props: {
      result: {
        ok: true,
        documentId: 'doc:default:4:response',
        name: '004-response.md',
        text: '# The answer\n\nAll of it, on paper.\n',
        bytes: 36,
      },
    },
    cy: 'canonical-document-viewer',
    minElements: 5,
    // ⚑ **`true` — it renders `DocumentBody` whole**, which is what makes it a document rather
    // than an inventory: Markdown and Raw, on white, exactly as the standard requires.
    paper: true,
  },
  {
    /**
     * ⚠️ **The one 346 §3 said to think about twice**, and the thinking ends in a measurement
     * rather than a ruling. *"An image viewer's chrome exists to get out of the way of the image,
     * and dark chrome around an arbitrary picture is a defensible design that has nothing to do
     * with themes."* True — and it has not been dark since `344`: this viewer is raised by
     * `ConversationPane`'s own host, INSIDE a surface that has carried the light scope for a whole
     * dispatch. So there is no exception to make; there is a state to pin, which is what this row
     * is. ⛔ Its mat is `--paper-bg` in both themes and always was (`080`), so the picture itself
     * sits on exactly what it sat on before.
     */
    what: 'the image viewer, which 346 §3 asked about and which 344 had already lit',
    component: ImageViewer,
    props: { path: 'assets/a-generated-image.png', prompt: 'a chart of the failing runs' },
    cy: 'image-viewer',
    minElements: 5,
    paper: false,
    translucent: true,
  },
  {
    /**
     * ⚠️ **A WIRED sheet (355)**, and it reaches the bridge in `setup`. ⚑ D-016 · it was the
     * second, until `ProjectSheet` was deleted. Its store is injected rather than stubbed on
     * `window`, because the composable memoises the bridge at first call and this file mounts many
     * things: a `window.api` good enough for one sheet would be captured for every later test in
     * the file.
     */
    what: 'the capabilities sheet, which is drawn one control per capability',
    component: CapabilitiesSheet,
    props: { profileSlug: 'pm', store: capabilityStore() },
    cy: 'capabilities-sheet',
    minElements: 20,
    paper: false,
  },
  {
    /**
     * 🔴 **The app's second launch door (423 relay 1), and it is on this list for a reason the
     * other sheets are not: it puts a `PromptComposer` inside the overlay's light scope.**
     *
     * ⛔ **That combination is new.** The composer has only ever been drawn inside
     * `ConversationPane` and on the launcher — surfaces that carry their own `data-chat-theme` —
     * and `an-alpha-fill-in-a-light-scope-is-not-a-light-surface` is the measured hazard: a
     * translucent fill inside `OverlayHost`'s light scope shows the NEAR-BLACK app behind it, and
     * paper ink on it goes invisible. ⚑ This list is hand-written and has no completeness check,
     * so a surface left off it is silently unmeasured; this one is the least safe to leave off.
     */
    what: 'the placed-conversation door, which is the only sheet with a composer in it',
    component: StartAsAgent,
    props: { profileSlug: 'archivist', provider: 'codex' },
    cy: 'start-as-agent',
    minElements: 10,
    paper: false,
  },
]

/** Below this a surface is chrome rather than paper — `--bg` is L 0.003, `--panel` L 0.005. */
const CHROME = 0.2

const name = (el: Element): string => {
  const cy = el.getAttribute('data-cy')
  if (cy) return `[data-cy=${cy}]`
  const cls =
    typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''
  return `${el.tagName.toLowerCase()}${cls}`
}

/**
 * ⛔ **`[data-on-white]` is exempt, and the exemption is a RULE rather than a list** — the same one
 * `surface-boundaries.dom.test.ts` carries. A white island is white on every surface by design, and
 * `paper-ink.dom.test.ts` measures its whole subtree property by property.
 */
const OWN_SCOPE = '[data-on-white]'

const paintOf = (root: HTMLElement): { el: HTMLElement; bg: Rgba }[] =>
  [root, ...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => !el.closest(OWN_SCOPE))
    .map((el) => ({ el, bg: paintedBackground(el) }))

/**
 * Everything under the panel that paints chrome-dark in dark and the IDENTICAL colour in light.
 *
 * ⛔ **The flip goes on the HOST**, which is where 346 put the attribute. Setting it on the panel
 * would leave the carrier above still declaring the light values — they inherit straight past — so
 * the two readings would be the same reading and the criterion would silently collapse into "is it
 * dark", which names every 600-end amber dot on paper. That is not hypothetical: this dispatch's
 * live probe did exactly that on its first run and reported two sheets' state dots as islands.
 */
function strandedUnder(host: HTMLElement, panel: HTMLElement, floor: number): string[] {
  host.setAttribute('data-chat-theme', 'dark')
  const dark = paintOf(panel)
  host.setAttribute('data-chat-theme', 'light')
  const light = paintOf(panel)
  expect(
    dark.length,
    `the walk covered only ${dark.length} elements — it saw nothing`,
  ).toBeGreaterThanOrEqual(floor)
  expect(light).toHaveLength(dark.length)
  // ⛔ The flip has to MOVE something, or every comparison below is a value against itself.
  expect(
    dark.filter((d, i) => channelGap(d.bg, light[i]!.bg) > 0).length,
    'flipping the host changed nothing — this walk is comparing one reading with itself',
  ).toBeGreaterThan(0)
  return dark
    .map((d, i) => ({ d, l: light[i]! }))
    .filter(({ d, l }) => luminance(d.bg) < CHROME && channelGap(d.bg, l.bg) === 0)
    .map(({ d }) => `${name(d.el)} paints ${show(d.bg)} in BOTH themes`)
}

const open = async (o: Overlay): Promise<Mounted> => {
  const m = mount(Hosted(o.component, o.props), {}, { width: 1200, height: 900 })
  await nextTick()
  await nextTick()
  return m
}

/* --------------------------------------------------------------- 1 · the panels are paper */

describe('every overlay opens on paper (346)', () => {
  it.each(OVERLAYS.map((o) => ({ o, what: o.what })))('$what', async ({ o }) => {
    const m = await open(o)
    // A translucent panel is measured by what it DECLARES; everything else by what got painted.
    const read = (): Rgba =>
      o.translucent
        ? parseColor(getComputedStyle(m.q(o.cy)).backgroundColor)!
        : paintedBackground(m.q(o.cy))
    const panel = read()
    expect(luminance(panel), `${o.cy} is not paper: ${show(panel)}`).toBeGreaterThan(0.8)

    /**
     * ⚠️ **The paired negative, and it is what makes the line above mean anything.** Take the scope
     * off the host — which is exactly what deleting 346's one attribute does — and the same panel
     * goes back to near-black. Without this, a build where `--panel` had simply become white on
     * `:root` would pass the assertion above and have repainted the whole app.
     */
    m.q('overlay-host').setAttribute('data-chat-theme', 'dark')
    const asChrome = read()
    expect(luminance(asChrome), `${o.cy} paints ${show(asChrome)} with the scope off`).toBeLessThan(
      CHROME,
    )
  })

  /**
   * 🔴 **The ink, which the fill assertion above cannot see and which nearly shipped.**
   *
   * `color` is an INHERITED property, and what inherits is the resolved COLOUR — not the `var()`
   * that produced it. `body` resolves `var(--text)` outside every scope, so `#e7ecf3` (a near-white
   * for a near-black page) is handed down into everything, a light scope included, unless something
   * inside re-asks for the token. Measured on this dispatch's own live build before the fix: every
   * one of the five sheets and the command palette computed `rgb(231, 236, 243)` on its own root.
   *
   * ⚠️ **Nothing was invisible, and that is exactly why no screenshot could have caught it**: every
   * text element in those sheets happens to declare a colour of its own today. One line of new
   * markup would have been white on white — which is 091's `--panel-3` and 344's missing page,
   * arriving through a property nobody had thought to name.
   */
  it.each(OVERLAYS.map((o) => ({ o, what: o.what })))(
    'the ink inside $what is re-resolved, not inherited from the chrome',
    async ({ o }) => {
      const m = await open(o)
      const ink = parseColor(getComputedStyle(m.q(o.cy)).color)!
      expect(
        luminance(ink),
        `${o.cy} inherits ${show(ink)} — the chrome's ink, on paper`,
      ).toBeLessThan(0.2)
      // The paired negative: with the scope off it IS the chrome's near-white, which is what every
      // one of these panels computed before 346 put `color` on the carrier.
      m.q('overlay-host').setAttribute('data-chat-theme', 'dark')
      const asChrome = parseColor(getComputedStyle(m.q(o.cy)).color)!
      expect(
        luminance(asChrome),
        `${o.cy} computes ${show(asChrome)} with the scope off`,
      ).toBeGreaterThan(0.7)
    },
  )

  it.each(OVERLAYS.map((o) => ({ o, what: o.what })))(
    'nothing inside $what is left behind when the light comes on',
    async ({ o }) => {
      const m = await open(o)
      expect(strandedUnder(m.q('overlay-host'), m.q(o.cy), o.minElements)).toEqual([])
    },
  )
})

/* ------------------------------------------------- 2 · the document, and what separates it */

/**
 * 🔴 **346 §1, which is the reason `344` did not do this itself.**
 *
 * A white document needs an asserted edge against the light sheet it sits on, so two
 * near-white surfaces do not dissolve into one.
 *
 * ⛔ **Measured, and the answer is not the fill.** In a light scope the sheet is `#fff` and the
 * document is `--paper-bg` `#f7f8fa`: **1.06:1, eight channel levels.** The first assertion below
 * states that as a fact rather than hiding it, so a later change that tried to solve this with a
 * fill step would fail here and be told why.
 *
 * ⚑ **What separates them is an EDGE and an ELEVATION, and both are asserted.** `--paper-line`
 * `#d9dee6` is 38 levels off the sheet, and `--paper-shadow` puts a real drop shadow under the
 * paper. ⚠️ The edge alone is **1.35:1** — below the 3:1 a WCAG non-text boundary asks for — so the
 * shadow is not decoration here, it is half the separator, and a build that removed it would leave
 * a document held on by a hairline.
 *
 * ⚠️ **This is not new in 346 and the numbers say so**: the same pairing has shipped inside the
 * light CONVERSATION since `080`, where a plan document sits on `--chat-bg` — the same `#f7f8fa`,
 * so a fill gap of **0** and only the border and the shadow between them. Putting a document in a
 * sheet makes the pairing more visible, not worse.
 */
describe('a document does not dissolve into the sheet it sits on (346 §1)', () => {
  const withPaper = OVERLAYS.filter((o) => o.paper)

  it.each(withPaper.map((o) => ({ o, what: o.what })))(
    'the fill alone would lose it — $what',
    async ({ o }) => {
      const m = await open(o)
      const paper = m.q(o.cy).querySelector<HTMLElement>('.doc-paper')
      expect(paper, 'this overlay renders no document paper').not.toBeNull()
      const paperBg = paintedBackground(paper!)
      const sheetBg = paintedBackground(m.q(o.cy))
      // Both are paper — that is the point, and the reason a stranded-token scan is blind here.
      expect(luminance(paperBg)).toBeGreaterThan(0.8)
      expect(luminance(sheetBg)).toBeGreaterThan(0.8)
      expect(
        channelGap(paperBg, sheetBg),
        `the document and its sheet are ${show(paperBg)} / ${show(sheetBg)} — if this ever grew, the separator below stopped being the thing that matters`,
      ).toBeLessThan(24)
    },
  )

  it.each(withPaper.map((o) => ({ o, what: o.what })))(
    'so the edge and the elevation carry it — $what',
    async ({ o }) => {
      const m = await open(o)
      const paper = m.q(o.cy).querySelector<HTMLElement>('.doc-paper')!
      const style = getComputedStyle(paper)
      const sheetBg = paintedBackground(m.q(o.cy))

      const border = parseColor(style.borderTopColor)
      expect(
        border,
        `the document paper has no border colour: ${style.borderTopColor}`,
      ).not.toBeNull()
      expect(parseFloat(style.borderTopWidth), 'the document paper has no border').toBeGreaterThan(
        0,
      )
      expect(
        channelGap(over(border!, sheetBg), sheetBg),
        `the document's rule is ${style.borderTopColor} on ${show(sheetBg)} — it has stopped being an edge`,
      ).toBeGreaterThanOrEqual(30)

      // The other half. A hairline at 1.35:1 is not enough on its own, and this is what the eye
      // actually reads the document by — see the measurement in this block's own docblock.
      expect(style.boxShadow, 'the document paper casts no shadow').not.toBe('none')
      const shadow = parseColor(style.boxShadow.slice(0, style.boxShadow.indexOf(')') + 1))
      expect(shadow, `the shadow does not begin with a colour: ${style.boxShadow}`).not.toBeNull()
      expect(shadow![3], 'the document paper casts a transparent shadow').toBeGreaterThan(0.1)
    },
  )
})

/* --------------------------------------------------------------------- 3 · the backdrop */

/**
 * ⚑ **346 §2 · the dim, which is its own question.**
 *
 * The modal dim must distinguish the overlay without hiding the paper beneath it. A dim tuned
 * for a near-black page needs separate verification over a light body.
 *
 * ⛔ **Nothing paints the answer, so it is composited here.** `OverlayHost`'s background is
 * translucent by design; the number that matters is what it BECOMES over the two things it covers,
 * and the engine blends that at draw time. Measured: `rgba(46, 52, 64, 0.32)` over `--paper-bg`
 * lands at `rgb(183, 185, 190)` — the page is plainly still there and plainly not the subject —
 * against `rgba(3, 5, 8, 0.58)`, which would have composited to `rgb(107, 109, 112)` and made the
 * app look switched off.
 */
describe('the backdrop is a dim, not a wash (346 §2)', () => {
  const PAPER: Rgba = [253, 253, 255, 1]

  it('over paper it leaves the page visible, and a panel still reads as raised', async () => {
    const m = await open(OVERLAYS[0]!)
    const raw = parseColor(getComputedStyle(m.q('overlay-host')).backgroundColor)
    expect(raw, 'the overlay host paints no backdrop at all').not.toBeNull()
    expect(raw![3], 'the backdrop is opaque — that is a wash, not a dim').toBeLessThan(0.5)

    const dimmed = over(raw!, PAPER)
    // A dim: the page under it keeps most of its light. A wash would drop it toward the chrome.
    expect(luminance(dimmed), `the backdrop composites to ${show(dimmed)}`).toBeGreaterThan(0.35)
    // …and the panel on it is unmistakably in front.
    expect(contrast(paintedBackground(m.q(OVERLAYS[0]!.cy)), dimmed)).toBeGreaterThan(1.6)
  })

  it('⚠️ and with the scope off it is the near-black dim the chrome was tuned for', async () => {
    const m = await open(OVERLAYS[0]!)
    const host = m.q('overlay-host')
    host.setAttribute('data-chat-theme', 'dark')
    const chrome = parseColor(getComputedStyle(host).backgroundColor)!
    host.setAttribute('data-chat-theme', 'light')
    const paper = parseColor(getComputedStyle(host).backgroundColor)!
    expect(
      channelGap(chrome, paper),
      'the two dims are the same colour — the light one is not being reached',
    ).toBeGreaterThan(20)
    expect(
      luminance(over(chrome, PAPER)),
      'the chrome dim over paper would have been a wash, not a dim',
    ).toBeLessThan(luminance(over(paper, PAPER)))
  })
})

/* ------------------------------------------------------------------------ 4 · the toasts */

/**
 * ⚑ **The one floating surface with no backdrop under it.** A toast is fixed to the app frame, so
 * nothing hosts it and nothing dims behind it — its own fill and its own shadow are the whole of
 * what says it is above the page. `--toast-bg` and `--toast-shadow` had never been on anything but
 * near-black before 346.
 */
describe('a toast is a chip on paper, not a chip of the chrome (346)', () => {
  const openToast = async (): Promise<Mounted> => {
    useOverlays().notify('Preview only — nothing was sent.')
    const m = mount(ToastStack, {}, { width: 400, height: 200 })
    await nextTick()
    return m
  }

  it('paints paper, and goes back to near-black with the scope off', async () => {
    const m = await openToast()
    const toast = m.q('toast')
    const lit = parseColor(getComputedStyle(toast).backgroundColor)!
    expect(luminance(lit), `the toast paints ${show(lit)}`).toBeGreaterThan(0.8)
    // Near-opaque, which is what stops the words on it being read through whatever is behind.
    expect(lit[3]).toBeGreaterThan(0.9)

    m.q('toast-stack').setAttribute('data-chat-theme', 'dark')
    const chrome = parseColor(getComputedStyle(toast).backgroundColor)!
    expect(luminance(chrome), `the toast paints ${show(chrome)} with the scope off`).toBeLessThan(
      CHROME,
    )
  })

  it('its sentence is legible on it, and its shadow is what lifts it', async () => {
    const m = await openToast()
    const toast = m.q('toast')
    const style = getComputedStyle(toast)
    const fill = over(parseColor(style.backgroundColor)!, [253, 253, 255, 1])
    const ink = parseColor(style.color)!
    expect(contrast(over(ink, fill), fill), 'the toast’s own sentence').toBeGreaterThanOrEqual(4.5)
    expect(style.boxShadow, 'a toast with no backdrop and no shadow is a rectangle').not.toBe(
      'none',
    )
    const shadow = parseColor(style.boxShadow.slice(0, style.boxShadow.indexOf(')') + 1))!
    // Ink rather than pure black — the same restatement 344 made for `--shadow`.
    expect(
      shadow[0] + shadow[1] + shadow[2],
      'the toast shadow is still pure black',
    ).toBeGreaterThan(0)
  })
})
