import { createApp, nextTick, type Component } from 'vue'
import { expect } from 'vitest'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { createSessionRecord, type SessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { createWindow } from '../../src/renderer/src/lib/transcript-window'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import type { DrawerFit, DrawerTab } from '../../src/renderer/src/lib/drawer'

/**
 * ⚠️ **The real stylesheet, and it is the whole point of this project** (083).
 *
 * Every other test in this repo asserts over markup with no CSS loaded at all, so it can see that a
 * component NAMES `--drawer-bg` but never what `--drawer-bg` RESOLVES TO where that component sits.
 * That is the gap both of 080's escapes fell through. Importing `base.css` — which imports
 * `tokens.css` — puts the real cascade in the page, so `getComputedStyle` answers the question the
 * string could not.
 */
import '../../src/renderer/src/assets/base.css'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'

/* ------------------------------------------------------------------ mounting */

export interface Mounted {
  /** The element the component was mounted into. */
  readonly host: HTMLElement
  /**
   * The mounted root, which carries whatever the component `defineExpose`s (151).
   *
   * ⚑ **The same handle a parent holds through a `ref`.** `RuntimeScreen` reaches `SideRail` and
   * `SessionLibrary` this way to settle a reopen, and a test that faked the state instead would
   * stay green through a rename of the exposed method — the hop is the thing worth asserting.
   */
  readonly vm: Record<string, unknown>
  /** One element by `data-cy`, asserted to exist — a query that returns null is a vacuous test. */
  q(cy: string): HTMLElement
  /** Every element by `data-cy`, possibly none. */
  all(cy: string): HTMLElement[]
  unmount(): void
}

const live: (() => void)[] = []

/**
 * Mount a component into a real, SIZED box.
 *
 * ⚠️ **The width is a parameter because layout is the point.** `drawerFit` reads the measured width
 * of the row the transcript and drawer share, so a component mounted into an unsized div would
 * measure 0 and every layout assertion would be about nothing.
 */
export function mount(
  component: Component,
  props: Record<string, unknown>,
  box: { width: number; height?: number } = { width: 1200 },
): Mounted {
  const host = document.createElement('div')
  host.style.width = `${box.width}px`
  host.style.height = `${box.height ?? 800}px`
  // `display: flex` so a `flex: 1` root (which `.conversation-pane` is) actually fills the box
  // rather than collapsing to its content — the app's own shell does the same.
  host.style.display = 'flex'
  document.body.append(host)

  const app = createApp(component, props)
  // ⚠️ **Registered BEFORE the mount, because a mount can throw.** The host is already in the
  // document by this line; if `app.mount` raised and cleanup were registered after it, the div
  // would survive `afterEach` and sit in `document.body` for every later test in the file — where
  // `paintedBackground` walks parents and a stray sized box is exactly the kind of thing that
  // changes an answer. Found in review.
  const tearDown = (): void => {
    // `finally`, so a component whose `onUnmounted` throws still loses its box. A sized div left in
    // `document.body` is not inert here: it is an ancestor the next test's walk could climb.
    try {
      app.unmount()
    } finally {
      host.remove()
    }
  }
  live.push(tearDown)
  const vm = app.mount(host) as unknown as Record<string, unknown>

  const mounted: Mounted = {
    host,
    vm,
    q(cy) {
      const el = host.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
      expect(el, `nothing with data-cy="${cy}" is in the DOM`).not.toBeNull()
      return el!
    },
    all(cy) {
      return [...host.querySelectorAll<HTMLElement>(`[data-cy="${cy}"]`)]
    },
    unmount: tearDown,
  }
  return mounted
}

/** Tear down anything a test forgot. Call from `afterEach`. */
export function unmountAll(): void {
  while (live.length) {
    try {
      live.pop()!()
    } catch {
      // Already unmounted by the test itself — the point of this is only that nothing survives
      // into the next one, and a double unmount achieves that just as well. `host.remove()` above
      // is unconditional for the same reason: if `app.unmount()` throws, the box must still go.
    }
  }
}

/* ------------------------------------------------------------------ colour */

export type Rgba = [number, number, number, number]

/**
 * ⚑ **Hex is accepted as well as `rgb()`/`rgba()` since 384 §1.3.** Chromium emits `rgb()` for
 * everything it COMPUTES, which is why this only ever needed the functional forms — but a caller
 * reading a raw custom property (`--paper-bg: #f7f8fa`) gets the authored token stream back, and a
 * `null` there is a colour the walk would drop silently. `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`.
 */
export function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim())
  if (hex) {
    const digits = hex[1]!
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8)
      return null
    const wide = digits.length > 4
    const size = wide ? 2 : 1
    const channel = (i: number): number => {
      const raw = digits.slice(i * size, i * size + size)
      return parseInt(wide ? raw : raw + raw, 16)
    }
    const alpha = digits.length === 4 || digits.length === 8 ? channel(3) / 255 : 1
    return [channel(0), channel(1), channel(2), alpha]
  }
  // ⚑ **W4.183 · `color(srgb r g b / a)`** — what Chromium computes a `color-mix()` to, with each
  // channel from 0 to 1. The card's tints are the theme's accent mixed into its panel.
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value.trim())
  if (srgb) {
    const parts = srgb[1]!
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) return null
    return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1]
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (!m) return null
  const parts = m[1]!
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
}

/** Split on top-level commas — a gradient's stops, without cutting inside `rgba(…)`. */
function splitStops(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let at = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++
    else if (list[i] === ')') depth--
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(at, i))
      at = i + 1
    }
  }
  out.push(list.slice(at))
  return out
}

/**
 * ⚠️ **A gradient sets NO `background-color`, and missing that made the walk lie.** Chromium
 * returns `rgba(0, 0, 0, 0)` for an element painted only with a `linear-gradient`, so a walk that
 * looked at `backgroundColor` alone stepped straight THROUGH the permission card and the user-input
 * card — both of which are gradients (`--waiting-card-bg`, `--input-card-bg`) — and composited
 * whatever was inside them onto the page instead. Found in review.
 *
 * The FIRST stop is taken, which is the same approximation `chat-theme.test.ts` already makes and
 * for the same reason: it is the worst case for anything at the top of the card. A gradient is not
 * one colour and this pretends it is — true, bounded, and better than pretending it is not there.
 */
export function firstGradientStop(image: string): Rgba | null {
  const m = /^(?:linear|radial|conic)-gradient\((.*)\)$/s.exec(image.trim())
  if (!m) return null
  for (const stop of splitStops(m[1]!)) {
    const colour = parseColor(stop.trim().replace(/\s+[\d.]+%$/, ''))
    if (colour) return colour
  }
  return null
}

/**
 * One element's own paint, TOP LAYER FIRST: a gradient paints over the background-color, so it
 * comes first and the solid colour is what shows through wherever the gradient is translucent.
 */
function ownLayers(el: Element): Rgba[] {
  const style = getComputedStyle(el)
  const declared = style.backgroundColor
  const solid = parseColor(declared)
  // ⚠️ Loud rather than silent. Chromium emits `rgb()`/`rgba()` for every token in this repo today,
  // but if it ever emits `color(srgb …)` or `oklch(…)` the old code returned null and the element
  // simply vanished from the composite — a wrong answer that looked like a right one.
  if (!solid && declared && declared !== 'transparent') {
    throw new Error(`unparseable background-color "${declared}" — the colour model needs updating`)
  }
  const layers: Rgba[] = []
  const gradient = firstGradientStop(style.backgroundImage)
  if (gradient && gradient[3] > 0) layers.push(gradient)
  if (solid && solid[3] > 0) layers.push(solid)
  return layers
}

/** Composite a possibly-translucent colour over what is behind it. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  if (fg[3] >= 1) return [fg[0], fg[1], fg[2], 1]
  return [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as Rgba
}

/**
 * What an element ACTUALLY READS AS: its own background composited over every ancestor's, down to
 * the first opaque one.
 *
 * ⚠️ **This is the sensor both of 080's escapes needed and nothing in this repo had.** The header
 * declares `--surface-header-bg` and the drawer declares `--drawer-bg`; both are translucent, so
 * what either one looks like is decided by what is *behind* it — and "what is behind it" is exactly
 * what a scope boundary in the wrong place changes without changing a single declaration.
 *
 * ⚠️ **`backdrop-filter: blur()` is deliberately not modelled.** A blur redistributes a backdrop, it
 * does not change its average colour, so over a flat surface the composite below is what the eye
 * gets.
 *
 * 🔴 **That paragraph used to end *"against a PATTERNED backdrop this would be an approximation and
 * the comment would be a lie — say so if that day comes."* 384 §1.3 is that day.** The light
 * surfaces now carry `--paper-wash`, two radial gradients, so the page is a RANGE and not a value.
 * ⚑ **This walk models the range by its strongest end** — {@link firstGradientStop} takes the first
 * colour stop, which is the worst case for anything at the top of the card — so what it reports is a
 * bound rather than a sample, and a band that "belongs" by this measure belongs everywhere on the
 * surface. ⚠️ Only `OverlayHost` blurs, and it blurs over the app frame rather than over a washed
 * surface, so the blur half of this note is untouched by the change.
 *
 * ⛔ **`opacity` IS NOT MODELLED HERE, and unlike the blur that is a real blind spot** (126). An
 * ancestor with `opacity: 0.5` fades this element's whole group toward whatever is behind the
 * group, and this walk reads none of it: `TranscriptView`'s `.entry.summarised-out` is exactly that
 * shape, and a walk built on this function reported 12.49:1 for ink Chromium painted at 2.86:1.
 * Found in 126's review. Use {@link paintedInk} for anything that asks "can this be READ" — this
 * one answers "what surface is this", which is what its callers in 080/083/091 ask.
 */
export function paintedBackground(el: Element): Rgba {
  const layers: Rgba[] = []
  let node: Element | null = el
  let floor: Rgba | null = null
  outer: while (node) {
    for (const own of ownLayers(node)) {
      if (own[3] >= 1) {
        floor = own
        break outer
      }
      layers.push(own)
    }
    node = node.parentElement
  }
  // ⚠️ **Unreachable in a page that loaded its stylesheet**, because `base.css` gives `body` an
  // opaque `--bg` and the walk always terminates there. It is white rather than anything cleverer
  // so that a page with NO stylesheet composites to plain white — which is what the browser would
  // actually show, and what the "did the sheet load" assertions in `theme-scope.dom.test.ts` are
  // written to catch. Do not "fix" this to `--bg`: that would disguise a missing stylesheet as a
  // correctly-themed dark app.
  let out: Rgba = floor ?? [255, 255, 255, 1]
  while (layers.length) out = over(layers.pop()!, out)
  return out
}

/** One element's own `opacity`, as a number — `1` for anything unparseable. */
function opacityOf(el: Element): number {
  const value = Number.parseFloat(getComputedStyle(el).opacity)
  return Number.isFinite(value) ? value : 1
}

/**
 * What an element's TEXT and the surface under it actually end up as, `opacity` included.
 *
 * ⛔ **This is the sensor {@link paintedBackground} could not be** (126). Group opacity is not a
 * property of a colour — it fades an element and its whole subtree toward what is behind the
 * *outermost* fading ancestor — so the only honest way to read it is to fold the whole chain from
 * the root back down, applying each node's accumulated factor to its own layers. `.entry
 * .summarised-out { opacity: .5 }` is that shape in this app, and it moved real ink by 4×.
 *
 * ⚠️ **Opaque text is the case this gets exactly right, which is every case it is used for.** At a
 * pixel the text covers, the group's own colour IS the text colour, so the fill behind it inside
 * the group cannot change the answer — only the factor and the backdrop can, and both are folded
 * here. Translucent text (`color: rgba(…, .5)` inside a faded group) is composited in the right
 * order but is one approximation deep: the group is flattened per-layer rather than as a bitmap.
 * Nothing in this repo paints that today.
 *
 * ⚠️ **`transform`, `filter`, `mix-blend-mode` and `clip-path` are not modelled** — none is used on
 * a text-bearing element in this tree, and each would need a real compositor rather than a fold.
 */
export function paintedInk(el: Element, colour: Rgba): { fg: Rgba; bg: Rgba } {
  const chain: Element[] = []
  for (let node: Element | null = el; node; node = node.parentElement) chain.push(node)

  // factor[i] = the opacity every layer of chain[i] is finally multiplied by — its own and every
  // ancestor's, which is why it is accumulated from the ROOT inward rather than from the element.
  const factor: number[] = new Array<number>(chain.length)
  let accumulated = 1
  for (let i = chain.length - 1; i >= 0; i--) {
    accumulated *= opacityOf(chain[i]!)
    factor[i] = accumulated
  }

  // ⚠️ Folded from the root down and started on white, rather than short-circuited at the first
  // opaque ancestor: an opaque layer that is FADED no longer hides what is under it, so the
  // short-circuit `paintedBackground` takes would drop exactly the layers this exists to keep.
  let ground: Rgba = [255, 255, 255, 1]
  for (let i = chain.length - 1; i >= 0; i--) {
    // `ownLayers` is top-first (a gradient over its background-color); paint bottom-first.
    for (const own of ownLayers(chain[i]!).reverse()) {
      ground = over([own[0], own[1], own[2], own[3] * factor[i]!], ground)
    }
  }
  return { fg: over([colour[0], colour[1], colour[2], colour[3] * factor[0]!], ground), bg: ground }
}

/**
 * Is this element actually SHOWN — the one question every other sensor here is blind to (142 §4.3).
 *
 * ⛔ **`paintedInk` says so in its own docstring and 141 caught a test relying on it anyway.** Ink,
 * contrast, `textContent`, a `use` href, a bounding rect: `visibility: hidden` leaves every one of
 * them exactly as it was. An element can be laid out, sized, coloured and unreadable, and 126 left
 * that limit written down on purpose rather than pretending the colour sensors covered it. This is
 * the sensor that closes it instead of the comment that names it.
 *
 * ⚠️ **The ENGINE answers, not a style-string comparison.** `checkVisibility` is Chromium's own
 * implementation of the question — it walks `display:none` ancestors, `visibility:hidden` and
 * `collapse` (which inherit, and which a descendant may override back to `visible`), `content-
 * visibility`, and with `opacityProperty` a fully transparent subtree. Reimplementing that walk here
 * would be a second, worse implementation of a thing the browser is already right about.
 *
 * ⚑ **Paired with a box check** because `checkVisibility` is true for an element with no boxes at
 * all in some cases (an SVG child, a zero-size wrapper), and "shown" has to mean it occupies the
 * screen. Every assertion using this should also assert the negative somewhere — a sensor nobody has
 * seen return `false` is a sensor nobody has tested.
 */
export function visible(el: Element): boolean {
  const shown = el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  const box = el.getBoundingClientRect()
  return shown && box.width > 0 && box.height > 0
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(c: Rgba): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const s = c[i]! / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The largest per-channel gap between two painted colours — "do these read as the same surface". */
export function channelGap(a: Rgba, b: Rgba): number {
  return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i]! - b[i]!)))
}

/**
 * WCAG contrast ratio, 1 (invisible) to 21 (black on white) — "can this text be read".
 *
 * ⚠️ **Both arguments must already be OPAQUE**, which is why it takes colours rather than elements:
 * the background half is `paintedBackground`'s job and the ink half is `getComputedStyle().color`,
 * and neither is meaningful composited the wrong way round. `chat-theme.test.ts` computes the same
 * ratio off the stylesheet's own text; this one asks the engine what actually got painted, which is
 * the difference between the two projects and the reason `125`'s and `126`'s defects survived it.
 */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05)
}

export const show = (c: Rgba): string =>
  `rgb(${c.slice(0, 3).map(Math.round).join(', ')}) L=${luminance(c).toFixed(3)}`

/* ------------------------------------------------------------------ fixtures */

/**
 * ⚠️ **A second copy of `conversation-chrome.render.test.ts`'s fixture, and that is a real cost.**
 * The SSR file declares its props inline, as every `*.render.test.ts` in this repo does; hoisting
 * them into one module would have meant editing a 560-line test file that 083 told me not to
 * disturb. Two descriptions of one session can drift, and if they do these tests will disagree
 * about which app they are asserting on — named in the response as the thing to fix, not hidden.
 */
const SCOPE = {
  cwd: '/work',
  paths: ['write /work/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

export const permission = (id: string): TranscriptEvent =>
  ({
    type: 'permission_request',
    id,
    kind: 'command',
    action: 'Bash',
    detail: 'run: ls',
    scope: SCOPE,
  }) as never

export const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
  profileId: DEFAULT_PROFILE_ID,
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-opus-5',
    authNote: null,
    files: [],
  },
  // ⚠️ **Empty on the shared fixture, and that is the assertion every OTHER test here makes**
  // (158): a session that was told nothing renders no instructions block at all, so every mount in
  // this directory that does not opt in is also a negative test for the empty case.
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: 1_700_000_000_000 },
  hasACommander: false,
  // 523 · a conversation a window started: there is nobody to hand it back to.
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

/**
 * ⚑ **The id is a parameter since `527`**, because `SessionRecord.sessionId` is readonly and a
 * test about switching CONVERSATION has to be able to build a second one. ⛔ `meta.sessionId` is
 * the host's echo of the same fact; a fixture that moved only the echo would leave the two halves
 * disagreeing and any guard reading the record would pass for the wrong reason.
 */
/**
 * Open every closed work-report card in a mount, as a person pressing its line would, so a test
 * can read the body. A report starts closed unless a person has to act on it.
 */
export async function openWorkReports(m: Pick<Mounted, 'all'>): Promise<void> {
  for (const card of m.all('work-report')) {
    const toggle = card.querySelector<HTMLElement>('[data-cy="exchange-toggle"]')
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
  }
  await nextTick()
}

export function record(events: TranscriptEvent[], sessionId = 'sess_1'): SessionRecord {
  const r = createSessionRecord(sessionId)
  r.meta = META
  r.phase = 'open'
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

/**
 * 🔴 **The agent's side, mounted on its own** (`527` §3.1).
 *
 * ⛔ **This is a thing no test could do before this dispatch.** `SessionInstructions` emitted
 * `<dt>`/`<dd>` fragments for `SessionInfo`'s `<dl>`, sized by a `font-size` inherited from that
 * component's root, so every file that wanted to assert what the block draws had to mount the
 * whole drawer on the Info tab and go looking. ⚑ `525` named the cost — *"must become
 * independently mountable"* — and seven test files are the evidence that it now is.
 *
 * ⚠️ **`relaunched: false` is the state, not a shortcut** — a fixture conversation really has no
 * earlier life (`SessionRecord.liveFrom === null`), and a test about the relaunch sentence passes
 * `true` and gets the other one.
 */
export const toldProps = (
  instructions: CreatedSession['instructions'],
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({ instructions, relaunched: false, ...over })

export const paneProps = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  record: record([permission('req_1'), { type: 'status', state: 'waiting_permission' } as never]),
  mode: 'normal' as const,
  debug: false,
  // ⚠️ **`false`, to match `conversation-chrome.render.test.ts` exactly.** It was `true` here, and
  // review pointed out that the drift this file's comment above WARNS about had already happened —
  // in the same commit that wrote the warning. Every caller that needs the drawer now says so.
  drawerOpen: false,
  drawerTab: 'open' as DrawerTab,
  models: null,
  // See `drawerProps` below: null is the state the drawer has to render, not a shortcut.
  capabilities: null,
  draft: '',
  // ⛔ **The conversation's attachment transaction** (292 §2) — required on this component since the
  // staged paths and the operations that produce them became one object. A fresh book per fixture:
  // each mount is its own app run.
  handing: createAttachmentBook().handing(draftKey('sess_1')),
  ...over,
})

export const drawerProps = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  session: META,
  state: createTranscript(),
  shown: createTranscript(),
  mode: 'normal',
  // 237 §1: the drawer takes the WINDOW, not its entries — the Events tab has to be able to say
  // whether what it draws is the whole ledger.
  window: createWindow(),
  sessionRef: META.ref,
  status: 'idle',
  // ⚑ **D-017b** — a conversation this window runs: what is set here reaches it, and it is not drawn
  // from its ledger.
  fixed: false,
  recorded: false,
  models: null,
  // Null on purpose: the capabilities read is asynchronous and can fail, so "not declared yet" is a
  // state the drawer has to render — and the Dropped tab's foot says so in words (087; `718`:
  // *Not offered. Not declared…*, the control dark).
  capabilities: null,
  waiting: 0,
  tab: 'open' as DrawerTab,
  fit: 'docked' as DrawerFit,
  facets: { doing: 'idle' as const, being: 'live' as const },
  // ⛔ **`relaunched` was REMOVED here at `fe-1 relay 3`, and the removal is the point.**
  // ⚠️ `SessionDrawer` stopped declaring it at `527` (`14d0c62f`), so every mount through this
  // helper passed a prop nothing takes — Vue warned *"Extraneous non-props attributes
  // (relaunched) … could not be automatically inherited because component renders fragment or
  // text or teleport root nodes"*, fourteen times a run, on a fragment root that swallows it.
  // 🔴 **That noise cost a real diagnosis**: it was read as naming the cause of two failures it
  // has nothing to do with, and the actual cause was a stale lookup table.
  // ⚑ **`toldProps` above still sets it**, because `SessionInstructions` really does declare it —
  // this line was the copy aimed at a component that had stopped listening.
  // ⛔ **`null` because a fresh fixture conversation has had no work read for it yet** (508) — the
  // state every real drawer is in on its first frame, and not a shortcut. ⚠️ A test about the Work
  // tab passes a reading and gets rows; a test that says nothing is asserting about a conversation
  // whose work has not been read, which is what this harness builds.
  work: null,
  /** ⚑ `null` until the identities read lands — a cold window names every row by its slug. */
  identities: null,
  ...over,
})

/**
 * Press the card’s “All tasks” and return its popup as a separate {@link Mounted}. The card
 * displays only the current piece; read the complete piece list in the popup.
 */
export async function allTasks(m: Mounted): Promise<Mounted> {
  m.host.querySelector<HTMLElement>('[data-cy="card-tasks-all"]')?.click()
  await nextTick()
  return within(m, 'all-tasks-dialog')
}

/** ⚑ A {@link Mounted} scoped to one element under it, found by `data-cy`. */
export function within(m: Mounted, cy: string): Mounted {
  const host = m.q(cy)
  return {
    host,
    vm: m.vm,
    q(name: string): HTMLElement {
      const found = host.querySelector<HTMLElement>(`[data-cy="${name}"]`)
      expect(found, `nothing with data-cy="${name}" is in ${cy}`).not.toBeNull()
      return found!
    },
    all: (name: string) => [...host.querySelectorAll<HTMLElement>(`[data-cy="${name}"]`)],
    unmount: () => m.unmount(),
  }
}

/** Open the agent folds before an existing test inspects their detailed content. */
export async function expandAgentCards(m: Mounted): Promise<Mounted> {
  for (const toggle of m.all('exchange-toggle')) {
    if (toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  }
  await nextTick()
  return m
}

/** Read the sender and recipient from the compact heading, which remains on expansion. */
export function agentCardSides(el: Element): string {
  const card =
    el.closest('[data-cy="outside-card"]') ?? el.querySelector('[data-cy="outside-card"]')
  const heading = card?.querySelector('.exchange-heading')
  return (heading?.textContent ?? el.textContent ?? '')
    .split(' · ')[0]!
    .replace(' → ', ' to ')
    .replace(/\s+/g, ' ')
    .trim()
}
export function agentCardRecipient(m: Mounted): string {
  const sides = agentCardSides(m.q('outgoing'))
  return sides.includes(' to ')
    ? sides.split(' to ').slice(1).join(' to ')
    : (m.q('outgoing-recipient').textContent ?? '').trim()
}
