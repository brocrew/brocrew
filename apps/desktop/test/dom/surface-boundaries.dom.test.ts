import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type Component } from 'vue'
/**
 * ⚠️ **The module, not the package index — and this is a browser-mode constraint, not a style
 * choice.** `@brobot2/runtime`'s barrel re-exports `codex/generated-image.ts`, which imports
 * `node:fs`; Vite externalizes that for the browser and the whole test file fails to import before
 * a single assertion runs. This path pulls in three files instead of the whole barrel: this one,
 * which imports the two capability constants as VALUES, and those two, whose only imports are types.
 * Nothing node-shaped is reachable from any of them. (The first version of this comment said all
 * three import only types, which is wrong about this file — the reason the import is safe survives,
 * the stated mechanism did not. Raised in review.) The SSR tests can say `@brobot2/runtime` because
 * they run in node — this project cannot.
 */
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import ReadingPane from '../../src/renderer/src/components/ReadingPane.vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import type { LibraryEntry, LibraryPage, LibraryQuery } from '../../src/shared/runtime-ipc'
import type { WindowState } from '../../src/renderer/src/lib/transcript-window'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import {
  channelGap,
  luminance,
  mount,
  paintedBackground,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * **The other three `data-chat-theme` boundaries** (091, from 083 §5.1).
 *
 * 083 named this gap in its own review and costed it as the cheapest thing on its list:
 *
 * > *"Three of the four `data-chat-theme` boundaries are untested. `NewConversation`, `ReadingPane`
 * > and `SessionLibrary` each carry their own. The new tests mount `ConversationPane` only. **Moving
 * > the attribute in `NewConversation.vue` — 080's defect exactly — would be caught by nothing.**"*
 *
 * And `NewConversation` is what a fresh install opens on, so the untested boundary is also the
 * first one anybody sees.
 *
 * ⚠️ **What tier 0 covered, checked rather than assumed — and it is not the same answer for all
 * three.**
 *  - *Placement.* `conversation-chrome.render.test.ts` asserts the attribute appears exactly once
 *    and on the pane. It is the only cardinality assertion in the repo and it names
 *    `ConversationPane` alone. **None of these three had one**, which is 083's finding verbatim.
 *  - *Tokens.* `chat-theme.test.ts` checks the tokens its components paint against the light block,
 *    off the hand-written `READING_SURFACE` list. `NewConversation` was ALREADY on that list; the
 *    reading pane and the session library were not. So the launcher's tokens were covered and its
 *    placement was not, and the other two were covered in neither half. 091 adds the missing two to
 *    that list, which is what turned `--panel-3` from a shipped defect into a build failure.
 *
 * So this duplicates nothing: placement is new for all three, and the token half is new for two.
 *
 * ## What this file asserts, and what it deliberately does not
 *
 * Two questions, and 083's point is that they are different questions:
 *
 *  1. **Placement** — the attribute is on exactly one element, and it is the one that owns the
 *     surface. This is the *mechanism*, and it is what moving the attribute breaks.
 *  2. **Enumeration** — nothing rendered inside is left behind when the light comes on. This is the
 *     *outcome*, and it is the half that caught the image viewer, *"which no token test can see,
 *     by construction."*
 *
 * It does **not** assert contrast, ink colour, or spacing. `paintedBackground` composites
 * backgrounds and cannot see `color` — established by mutation in 087, where deleting three light
 * `--success-*` tokens left the stranded-walk in `context-tab.dom.test.ts` green and only the token
 * guard in `chat-theme.test.ts` went red. That class belongs there, and the two are complementary —
 * which is why 091 also adds the two missing surfaces to that file's list rather than only here.
 *
 * ⚠️ **The walk below is the same shape as `scope-membership.dom.test.ts`'s and is not shared with
 * it.** Sharing it needs one of two things 091 forbids: hoisting it into `harness.ts` (extending the
 * harness) or re-pointing that file's `stranded()`, which hard-codes `m.q('conversation-pane')`
 * (editing an existing test). It is duplication, it is named here rather than hidden, and the
 * response says so.
 */

/* ------------------------------------------------------------------ fixtures */

/**
 * ⚠️ **`SessionLibrary` is the one surface that cannot mount on props alone.** It calls
 * `window.api.runtime.listLibrary()` from `onMounted` — the only IPC any of the three touches
 * before a click — and with `window.api` undefined it catches its own TypeError, sets `error`, and
 * renders a single banner. A walk over that surface would report a clean sweep having looked at
 * almost nothing, which is the vacuous pass this file exists to avoid.
 *
 * The stub lives here rather than in `harness.ts` deliberately: 091 forbids extending the harness,
 * and a fake IPC layer is exactly the kind of capability that would make the harness answerable for
 * a component's data instead of its paint.
 */
const LIBRARY_PAGE: LibraryPage = {
  entries: [
    {
      // Ours, archived, and behind its raw bytes — Read and Rebuild, plus the "behind" line.
      id: 'claude::thread-stale',
      provider: 'claude',
      providerSessionId: 'thread-stale',
      recordId: 'sess_stale',
      cwd: '/work/project-alpha',
      title: 'Refactor the authentication module',
      preview: 'Can you help me refactor the authentication module?',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_003_600_000,
      bytes: 1_048_576,
      origin: 'user-home',
      onDisk: true,
      readable: true,
      derived: 'stale',
      lastEnding: 'completed',
      unresumableReason: null,
      child: null,
    },
    {
      // In a provider home and not ours yet — the Import row, and the only one that offers it.
      id: 'codex::thread-unimported',
      provider: 'codex',
      providerSessionId: 'thread-unimported',
      recordId: null,
      cwd: '/work/project-beta',
      title: 'Write a parser for the config format',
      preview: 'Write a parser for the config format.',
      createdAt: 1_699_900_000_000,
      updatedAt: 1_699_907_200_000,
      bytes: 204_800,
      origin: 'user-home',
      onDisk: true,
      readable: false,
      derived: null,
      lastEnding: null,
      unresumableReason: 'it is still in your provider home and has not been imported',
      child: null,
    },
    {
      // Ours, its provider file gone, and its projection failed — the third badge state.
      id: 'sess_failed',
      provider: 'claude',
      providerSessionId: null,
      recordId: 'sess_failed',
      cwd: '/work/project-gamma',
      title: '',
      preview: '',
      createdAt: 1_699_800_000_000,
      updatedAt: 1_699_801_800_000,
      bytes: null,
      origin: 'ours',
      onDisk: false,
      readable: true,
      derived: 'failed',
      lastEnding: 'unknown',
      unresumableReason: null,
      child: null,
    },
  ],
  matched: 3,
  counts: {
    total: 3,
    ours: 1,
    userHome: 2,
    restored: 0,
    imported: 1,
    notImported: 1,
    onlyHere: 1,
    // The Provider facet's options come from here (121) — the backend's tally, so the renderer
    // never has to know a provider's name.
    providers: [{ provider: 'claude', total: 3 }],
  },
  skipped: [
    { provider: 'claude', path: '/homes/claude/sessions/bad.jsonl', reason: 'unexpected EOF' },
  ],
  // Larger than `skipped.length`, so the "…and N more" line renders too.
  skippedTotal: 2,
}

/**
 * ⚠️ **The stub's signature matches the real one, and the cast goes through `unknown`.** `window.api`
 * is globally declared, so a narrower `listLibrary()` is not comparable to the declared
 * `listLibrary(input: LibraryQuery)` and `vue-tsc` says so — which is the type system pointing out
 * that the fake and the thing it stands in for had drifted on the first line. Widening the global
 * to accommodate a test would be the wrong way round; matching it is free.
 */
type LibraryApi = { runtime: { listLibrary: (input: LibraryQuery) => Promise<LibraryPage> } }

const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

const READING_ENTRY: LibraryEntry = {
  id: 'sess_read',
  provider: 'claude',
  providerSessionId: 'thread-1',
  recordId: 'sess_read',
  cwd: '/work/parser',
  title: 'Fix the parser',
  preview: 'the parser drops a line',
  createdAt: 1_699_000_000_000,
  updatedAt: 1_699_000_060_000,
  bytes: 4_096,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  // `stale` rather than null: it is what renders the "behind" banner, one more painted band.
  derived: 'stale',
  // 222 — this fixture drives the reading pane, not the ending cell; `completed` is the row
  // shape the rest of the page assumes and keeps this fixture describing one thing.
  lastEnding: 'completed',
  unresumableReason:
    "one of your own Claude conversations, found in Claude's own folder — BroBot can read it " +
    "here, but a reopen would start Claude in BroCrew's own folder, where this conversation is not",
  child: null,
}

const READING_HISTORY: WindowState = {
  entries: [
    {
      sessionId: 'sess_read',
      ordinal: 0,
      at: 1_699_000_000_000,
      event: { type: 'user_turn', text: 'why does the parser drop a line?' },
    },
    {
      sessionId: 'sess_read',
      ordinal: 1,
      at: 1_699_000_001_000,
      event: { type: 'assistant_message', text: 'Because the reader stops at the first newline.' },
    },
    {
      sessionId: 'sess_read',
      ordinal: 2,
      at: 1_699_000_002_000,
      event: { type: 'tool_call', id: 't1', name: 'Read', summary: 'parser.ts' },
    },
  ],
  from: 0,
  // With `onLoadOlder` supplied this is what renders the paging control.
  hasOlder: true,
  turnAligned: true,
  atTail: true,
  behind: 0,
}

/**
 * ⚑ **The `MODELS` fixture went with the control that read it** (417, HO-022 §2).
 *
 * A `ProviderModelMap` stood here to feed the launcher's `models` prop, which fed the `model-input`
 * datalist inside the `Fine-tune` fold. *"Opening a new conversation opens a conversation with
 * BroBot. That is all."* — the fold, the box and the prop are gone, and `RuntimeScreen` no longer
 * hands the launcher a catalogue at all. ⛔ **Nothing on this file's question changed**: a model
 * name is not paint, and the walk below never looked at one.
 */

/* ------------------------------------------------------------------ the surfaces */

/**
 * ⚑ The clock *Waiting on you* measures ages against — any fixed instant; the queue it is handed is
 * empty. It was the demo seed's `FIXTURE_NOW` until D-016 deleted the fixtures.
 */
const WAITING_CLOCK = 1_700_000_000_000

interface Surface {
  /** What it is called in a failure message. */
  readonly what: string
  readonly component: Component
  /** The element that owns the boundary — where the attribute must be, and nowhere else. */
  readonly rootCy: string
  readonly props: () => Record<string, unknown>
  /**
   * ⚠️ **The non-vacuity guard, per surface.** Every assertion below is of the form "nothing is
   * wrong", and a mount that rendered an error banner and three words would satisfy all of them.
   * These are `data-cy` that must be on screen for the walk to have looked at the surface at all.
   */
  readonly evidence: readonly string[]
  /**
   * 🔴 **579 · openers to press before the walk runs**, for a surface that keeps some of its ink
   * behind a disclosure.
   *
   * ⛔ **Without this the fold would be a HOLE in this file's coverage**, and a silent one: the
   * walk would go on returning `[]` over a subtree that simply is not there, which is `577`'s
   * repaired vacuous absence in a different file. ⚑ The point of this suite is that nothing inside
   * a surface is stranded when the light comes on, and a paragraph a person can reveal is inside
   * the surface.
   */
  readonly reveal?: readonly string[]
  /** A floor on how many elements the walk covers — the same guard, as a number. */
  readonly minElements: number
  /**
   * Where the boundary is moved to in the mutation test — 080's defect, which was the scope
   * shrinking onto an inner column and leaving the chrome around it outside everything.
   */
  readonly innerCy: string
}

const SURFACES: readonly Surface[] = [
  {
    what: 'the launcher — what a fresh install opens on',
    component: NewConversation,
    rootCy: 'new-conversation-surface',
    props: () => ({
      busy: false,
      error: 'failed: no such binary — is codex installed?',
      debug: true,
      draft: 'Refactor the auth module to use the new token store',
      defaultProvider: 'claude',
      // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
      // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
      // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
      // bindings, so a silently-absent one is a silently-absent control.
      models: null,
      choices: NO_LAUNCH_CHOICES,
      // 🔴 **579 · required since `500` and never passed here** — omitted it arrives as
      // `undefined`, and the control renders with no state class and an empty `<strong>`, so the
      // ink this file measures on it would be the ink of a state the app cannot produce.
      defaultApprovalMode: 'ask',
      capabilities: allProviderCapabilities(),
      // ⛔ The launcher's draft transaction (292 §2) — required since the paths and the operations
      // that produce them became one object.
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
    }),
    /**
     * 🔴 **417 re-pointed all three of these at what is left of the screen** (HO-022 §2).
     *
     * They read `['new-conversation-settings', 'provider-select', 'command-error', 'plan-mode']`,
     * `minElements: 40` and `innerCy: 'new-conversation-settings'` — three of the four hooks and
     * the inner column were the settings frame and the `Fine-tune` fold, which the dispatch
     * removed with every control they held. ⚠️ **Three of the four hooks vanishing is what this
     * repair is for**: a `data-cy` that no longer exists makes `m.q` throw, so the non-vacuity
     * guard would have taken the whole surface down rather than measuring it.
     *
     * ⚑ **What they name now is the same surface asked the same question**: the column
     * (`launcher-column`), the two always-on notes above the composer, the launch error this
     * fixture's `error` prop puts on screen, and the composer itself — the one control the front
     * door still has. `minElements` is a floor rather than a count, and the surface it is a floor
     * for lost a settings frame and a disclosure fold; 35 still refuses a mount that rendered a
     * banner and three words, which is the only thing it was ever asked to refuse.
     */
    // The shortened launcher retains the composer and model picker; explanation folds are gone.
    evidence: ['launcher-column', 'model-picker-face', 'command-error', 'prompt-input'],
    minElements: 25,
    innerCy: 'launcher-column',
  },
  {
    what: 'a recording being read',
    component: ReadingPane,
    rootCy: 'reading-pane',
    props: () => ({
      entry: READING_ENTRY,
      history: READING_HISTORY,
      mode: 'normal',
      onLoadOlder: async (): Promise<void> => {},
    }),
    evidence: ['read-only-banner', 'reading-behind', 'reading-transcript', 'reading-title'],
    minElements: 25,
    innerCy: 'reading-transcript',
  },
  {
    what: 'the session library',
    component: SessionLibrary,
    rootCy: 'session-library',
    props: () => ({}),
    evidence: ['library-counts', 'library-rows', 'library-search', 'library-skipped'],
    minElements: 40,
    innerCy: 'library-rows',
  },
  /**
   * ⚑ **344's two — Home and the project workspace — went with D-016.** They were the reason this
   * file gained a fifth and sixth entry rather than a screenshot: neither had ever been rendered on
   * paper, and this walk is what catches an element that paints a dark colour of its OWN. Both
   * drew the demo seed and both are deleted with it, so their rows are gone rather than re-aimed.
   */
  /**
   * 🔴 **606 · `EXT-008` §3's two destinations, each walked like any other body surface.**
   *
   * ⛔ **Both are real and both are the seed-free half of what Home used to hold**: their worlds
   * are the live queue and a ledger reading, and each is handed one here.
   */
  {
    what: 'Waiting on you, which 606 split off Home',
    component: WaitingOnYou,
    rootCy: 'waiting-on-you',
    props: () => ({ needsYou: [], clock: WAITING_CLOCK }),
    evidence: ['waiting-stat', 'waiting-intro', 'waiting-bound', 'attention-clear'],
    minElements: 12,
    innerCy: 'attention-clear',
  },
  {
    what: 'Recent activity, which 606 split off Home',
    component: RecentActivity,
    rootCy: 'recent-activity',
    props: () => ({
      reading: {
        window: { from: WAITING_CLOCK - 12 * 3_600_000, to: WAITING_CLOCK },
        read: { walk: 'one-window-over-every-agents-conversation', ledgers: 2, rowsUnread: 0 },
        lines: [
          {
            id: 'a',
            at: WAITING_CLOCK - 60_000,
            what: 'finished',
            register: 'claimed',
            piece: { id: 'a', label: 'W1.1', title: 'Check the release notes' },
            agent: 'Ada',
            conversation: 'sess_a',
          },
        ],
        capped: false,
      },
      windowMs: 12 * 3_600_000,
      clock: WAITING_CLOCK,
    }),
    evidence: ['activity-window', 'activity-list', 'activity-line'],
    minElements: 12,
    innerCy: 'activity-list',
  },
]

/* ------------------------------------------------------------------ the walk */

beforeEach(() => {
  stubbed().api = { runtime: { listLibrary: () => Promise.resolve(LIBRARY_PAGE) } }
})

/**
 * ⚠️ **One hook, because two would run in the wrong order.** Vitest runs same-scope `afterEach`
 * hooks LIFO, so `afterEach(unmountAll)` followed by `afterEach(() => delete …api)` tears the stub
 * away FIRST and unmounts second — a component whose teardown touched IPC would then fail on a
 * `window.api` that had already gone. Nothing in these three does today, which is exactly why it
 * would have sat here unnoticed. Raised in review.
 */
afterEach(() => {
  unmountAll()
  delete stubbed().api
})

/** Below this a surface is chrome rather than paper — `--bg` is L 0.003, `--app-bg` L 0.004. */
const CHROME = 0.2

/**
 * ⚠️ **The one exemption, carried over from `scope-membership.dom.test.ts` as a RULE rather than a
 * list.** `[data-on-white]` began as 082's agent plate: a subtree that re-declares its own colours
 * because it is a white island on *every* surface, dark chrome and paper alike, so it is outside
 * this question by design. `agent-state.test.ts` is what covers it instead.
 *
 * ⚠️ **It has three carriers now, not one** — 126 gave it to `ChildWorkViewer`'s paper and 129 to
 * `DocumentBody`'s, which is the rule working as written rather than a surprise. Measured on the
 * fixtures this file mounts, the two new ones remove **0** elements from the walk; the paper covers
 * itself in `paper-ink.dom.test.ts`, which measures its whole subtree property by property.
 *
 * ⚠️ **It is LIVE in the launcher, and the first version of this comment said the opposite.** It
 * claimed no descendant of the three carried the attribute, "checked" — measured, that is false:
 * `NewConversation` renders `SessionHeader`, which renders `AgentState size="compact"`, and compact
 * is 24px against a `PLATE_FLOOR` of 24, so `isDotOnly` is false and the plate is drawn. One plate,
 * counted in a browser rather than argued from the source. The exemption is right; the claim about
 * it was wrong, which is the same defect class as the token comments this task went on to correct.
 *
 * The floor inside `strandedUnder` is what stops the exemption emptying a walk — but only in the
 * total case. A large exempted island holding stranded elements, with enough left outside it to
 * clear the floor, would still pass here and is covered only by that subtree's own test.
 */
const OWN_SCOPE = '[data-on-white]'

interface Painted {
  el: HTMLElement
  bg: Rgba
}

function paintOf(root: HTMLElement): Painted[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => !el.closest(OWN_SCOPE))
    .map((el) => ({ el, bg: paintedBackground(el) }))
}

/** A short, human name for an element, so a failure says WHERE rather than "an element". */
const name = (el: HTMLElement): string => {
  const cy = el.getAttribute('data-cy')
  if (cy) return `[data-cy=${cy}]`
  const cls =
    el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''
  const owner = el.closest('[data-cy]')?.getAttribute('data-cy')
  return `${el.tagName.toLowerCase()}${cls}${owner ? ` (inside [data-cy=${owner}])` : ''}`
}

/**
 * Everything under `root` that paints chrome-dark in dark mode and the *identical* colour in light.
 *
 * The tree is read twice from ONE mount, by flipping the attribute the prop drives — two mounts
 * would have to be paired by index, and the day the trees differ by a node that pairing silently
 * starts comparing unrelated elements. `scope` is a parameter because the mutation test has to move
 * the boundary somewhere else and then look at the same tree.
 */
function strandedUnder(root: HTMLElement, scope: HTMLElement, floor: number): string[] {
  scope.setAttribute('data-chat-theme', 'dark')
  const dark = paintOf(root)
  scope.setAttribute('data-chat-theme', 'light')
  const light = paintOf(root)

  /**
   * ⚠️ **The non-vacuity guard lives HERE, not at the call sites, and that is the whole point.**
   * Every caller ends in `toEqual([])`, which a walk that covered NOTHING satisfies perfectly — and
   * `expect(light).toHaveLength(dark.length)` below is `expect([]).toHaveLength(0)` in exactly that
   * case, so it cannot catch it either. Review found the floor on one call site out of four; the
   * other three were each one collapsed mount away from passing over an empty tree. Putting it
   * inside means no future caller can be written without it.
   */
  expect(
    dark.length,
    `the walk covered only ${dark.length} elements — it saw nothing`,
  ).toBeGreaterThanOrEqual(floor)
  expect(light).toHaveLength(dark.length)

  return dark
    .map((d, i) => ({ d, l: light[i]! }))
    .filter(({ d, l }) => luminance(d.bg) < CHROME && channelGap(d.bg, l.bg) === 0)
    .map(({ d }) => `${name(d.el)} paints ${show(d.bg)} in BOTH themes`)
}

/** Mount one surface and wait for whatever it does on the way up. */
async function open(s: Surface): Promise<Mounted> {
  const m = mount(s.component, s.props(), { width: 1200 })
  // Two ticks: one for the resolved `listLibrary` promise, one for the render it schedules. Cheap
  // and unconditional — the two synchronous surfaces are simply already settled.
  await nextTick()
  await nextTick()
  // ⚑ **579 · whatever this surface keeps behind a press** — see {@link Surface.reveal}.
  for (const opener of s.reveal ?? []) (m.q(opener) as HTMLButtonElement).click()
  if (s.reveal) await nextTick()
  return m
}

/* ------------------------------------------------------------------ 1 · placement */

describe('each surface carries its theme boundary exactly once, on the element that owns it', () => {
  it.each(SURFACES.map((s) => ({ s, what: s.what })))('$what', async ({ s }) => {
    const m = await open(s)

    // The surface really rendered — without this the queries below run over a banner.
    for (const cy of s.evidence) m.q(cy)

    const carriers = [...m.host.querySelectorAll<HTMLElement>('[data-chat-theme]')]
    expect(
      carriers.map(name),
      `${s.what}: the boundary must be on exactly one element`,
    ).toHaveLength(1)
    expect(carriers[0]).toBe(m.q(s.rootCy))
    /**
     * Each body surface has exactly one theme carrier and its value is always `light`. There
     * is no `chatLight` choice; asserting the single value makes a quiet return to `dark`
     * fail rather than become another supported mode.
     */
    expect(carriers[0]!.getAttribute('data-chat-theme')).toBe('light')

    m.unmount()
  })
})

/* ------------------------------------------------------------------ 2 · enumeration */

describe('nothing inside these surfaces is left behind when the light comes on', () => {
  it.each(SURFACES.map((s) => ({ s, what: s.what })))('$what', async ({ s }) => {
    const m = await open(s)
    for (const cy of s.evidence) m.q(cy)

    const root = m.q(s.rootCy)
    // `strandedUnder` asserts the floor itself, so this `toEqual([])` cannot pass over an empty tree.
    const report = strandedUnder(root, root, s.minElements)
    expect(report, `stranded on paper in ${s.what}:\n  ${report.join('\n  ')}`).toEqual([])
  })

  /**
   * ⚠️ **The pairing, and without it every `toEqual([])` above passes over nothing.** A detector
   * that can never fire — a stylesheet that did not load, a `paintedBackground` that returns one
   * colour for everything — satisfies all three. So: reproduce 080's defect on each surface in
   * turn, and require the detector to name what it stranded.
   *
   * 080's shape, in its own words, was the scope splitting so that the reading column kept the
   * light and the chrome around it did not. Here that is the boundary sliding off the root and onto
   * an inner column, which is precisely the move 083 said *"would be caught by nothing."*
   */
  it.each(SURFACES.map((s) => ({ s, what: s.what })))(
    '⚠️ …and moving the boundary into $what strands what it left behind',
    async ({ s }) => {
      const m = await open(s)
      const root = m.q(s.rootCy)

      const clean = strandedUnder(root, root, s.minElements)
      expect(clean, `${s.what} was not clean to begin with`).toEqual([])

      // 080's defect, applied: the scope shrinks onto an inner column and the surface's own chrome
      // — its header, its banners, its page — falls outside everything.
      const inner = m.q(s.innerCy)
      root.removeAttribute('data-chat-theme')

      const report = strandedUnder(root, inner, s.minElements)
      expect(
        report.join('\n'),
        `the boundary moved to [data-cy=${s.innerCy}] and the walk still reported nothing`,
      ).toContain(`[data-cy=${s.rootCy}]`)

      /**
       * ⚠️ **The pairing, and it has to be reversibility rather than "the inner column is absent
       * from the report".** That was the obvious assertion and it is FALSE: an element painting no
       * background of its own composites to its nearest painted ancestor, which after this mutation
       * is the surface root the boundary just left — so half of what is genuinely inside the moved
       * scope reads dark in both themes and is reported, correctly. Measured, not reasoned: the
       * first version of this test failed on `reading-transcript` for exactly that reason.
       *
       * Putting the boundary back is the claim actually worth making. The same walk over the same
       * tree goes quiet again, so the report above is a response to the boundary rather than a
       * detector that names everything it sees — which is what a stylesheet that never loaded, or a
       * paint read that returns one colour, would produce.
       *
       * ⚠️ **What this does NOT prove, since the wording invited the stronger reading:** it restores
       * the ATTRIBUTE, not Vue's binding — `strandedUnder` sets it directly, so a component whose
       * `:data-chat-theme` had been deleted would still pass here. That claim belongs to the
       * placement tests above, which read the attribute the prop actually produced. Raised in review.
       */
      inner.removeAttribute('data-chat-theme')
      const restored = strandedUnder(root, root, s.minElements)
      expect(
        restored,
        `${s.what} did not come back when the boundary did:\n  ${restored.join('\n  ')}`,
      ).toEqual([])
    },
  )

  /**
   * The flip is only a faithful stand-in for what the component SHIPS if it produces the same
   * pixels — the whole detector rests on it, so it is asserted against surfaces mounted the
   * ordinary way.
   *
   * ⚠️ **It compared the flip against a prop until 344, and the prop is gone.** The comparison it
   * makes now is the one that survives: the surface as it mounts, against the same element with the
   * attribute set by hand. `toBe(0)` says the walk's mechanism reproduces the shipped rendering;
   * the `> 100` pairing says the attribute is doing something rather than the two reads being one
   * unchanging colour. ⛔ **And the roles have swapped** — `light` is now what mounts and `dark` is
   * what has to be reached for, which is exactly the claim the response is about.
   */
  it.each(SURFACES.map((s) => ({ s, what: s.what })))(
    'the flip reproduces what $what actually ships',
    async ({ s }) => {
      const asShipped = await open(s)
      const shipped = paintedBackground(asShipped.q(s.rootCy))

      const byHand = await open(s)
      byHand.q(s.rootCy).setAttribute('data-chat-theme', 'light')
      expect(channelGap(shipped, paintedBackground(byHand.q(s.rootCy)))).toBe(0)

      // The pairing: dark really is a different colour, so the equality above is agreement rather
      // than two reads of one unchanging thing — and it is what the surface no longer renders.
      const dark = await open(s)
      dark.q(s.rootCy).setAttribute('data-chat-theme', 'dark')
      expect(
        channelGap(shipped, paintedBackground(dark.q(s.rootCy))),
        `${s.what} paints the same colour in both themes — the attribute does nothing`,
      ).toBeGreaterThan(100)
    },
  )
})
