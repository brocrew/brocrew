import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { HOLDING_SAYS, whatHoldsIt, type IdentityUse } from '../../src/shared/agent-roster'
import {
  platePx,
  SIZES,
  STANDING_LABEL,
  STANDING_TONE,
} from '../../src/renderer/src/lib/agent-state'
import { OPEN_IN_ANOTHER_WINDOW } from '../../src/renderer/src/lib/taking-over'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { agentStateWords } from '../../src/shared/agent-state'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import type { ConversationAtWork, WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { assertDrawn, clipsOf, describeCarrier, drawnReady, lineCount, sweep } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **593 · the paint on the Team card** — `EXT-012` §1/§2, and every claim here is one SSR cannot
 * see.
 *
 * ## ⛔ What this file is for
 *
 * The Team page must say both who the agents are and what they are doing. Check the plate,
 * state line, live-conversation rows, and two disclosures through layout, computed style,
 * clipping, and visibility. `team-workspace.dom.test.ts`’s SSR-shaped neighbor and
 * `*.test.ts` suites cannot observe those properties.
 *
 * ## ⚠️ What it is NOT
 *
 * ⛔ **It is not the app.** `the-dom-runner-draws-overlay-scrollbars` — 11 px in the Electron window,
 * 0 px here — so a width measured here is not a width a person has. ⚑ Every case below is either a
 * RELATION between two elements measured in one pass, or a `never`-reach clip verdict, and the
 * scrollbar difference moves neither (`drawn.ts` limit 4).
 *
 * ⛔ **It edits nothing under `src/`.** One finding that belongs to the product rather than to these
 * tests is recorded in §1's second case and is asserted around rather than asserted away.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⛔ **The pane floor** — `--app-min-w` 1180 less `--rail-w` 208, the same arithmetic `588` uses. */
const FLOOR = 972

/**
 * ⚑ **Anchored to the WALL CLOCK and not to a fixture epoch**, and that is load-bearing here in a
 * way it is not one surface over. ⛔ The page measures every age it draws from the live minute, so
 * a 2023 constant would draw *1085d ago* beside a conversation the same mount calls *4s ago*.
 */
const NOW = Date.now()

const CHOSEN = {
  maxDepth: 'default',
  canMessage: 'default',
  canAssignWork: 'default',
  canCreateAgents: 'default',
  canWriteRules: 'default',
} as unknown as AgentIdentity['chosen']

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: NOW - 86_400_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
  ...over,
})

const use = (slug: string, over: Partial<IdentityUse> = {}): IdentityUse => ({
  slug,
  conversations: 0,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: null, from: 'nothing-yet' },
  ...over,
})

/**
 * ⚑ **Five identities, one per arm of {@link WhatTheyAreDoing} this page can draw a face for.**
 *
 * ⛔ `ada` is the only one with a live conversation, deliberately: `plateFor` draws a real avatar
 * only where `byIdentity` returned exactly ONE row, so a second running conversation on the same
 * identity would take §1's avatar away and the case would be measuring the refusal instead.
 */
const ADA_USE = use('ada', { conversations: 4 })
const STARTER_USE = use('starter', {
  conversations: 2,
  isLaunching: true,
})

const AGENTS: AgentIdentities = {
  identities: [
    ident('ada', { displayName: 'Ada', provider: 'claude' }),
    ident('ali', { displayName: 'Ali', provider: 'codex' }),
    ident('newbie'),
    ident('starter', { displayName: 'Mo', provider: 'codex' }),
  ],
  foldersWithoutARow: [],
  use: [
    ADA_USE,
    use('ali', { conversations: 3, runsOn: { provider: 'codex', from: 'saved' } }),
    use('newbie'),
    STARTER_USE,
  ],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const working = (
  conversation: string,
  identity: string,
  detail: string | null = 'Bash',
): ConversationAtWork => ({
  conversation,
  identity,
  told: { said: 'an-activity', phase: 'tool', detail },
  // ⛔ **593's own new field** — without it `sessionDoing` may not let the phase say anything at
  // all (`099`: status FRAMES, activity REFINES), and the plate would be faceless.
  status: 'working',
  streaming: false,
  since: NOW - 4_000,
  context: null,
})

const done = (rows: readonly ConversationAtWork[]): WhatIsBeingDone => ({
  readAt: NOW,
  conversations: rows,
})

const BUSY = done([working('sess_live', 'ada')])

/** ⚑ **One conversation as the rail lists it** — D-016: the one list every shelf narrows. */
const listed = (over: Partial<ListedConversation> & { sessionId: string }): ListedConversation => ({
  provider: 'claude',
  label: 'Ada',
  identity: 'ada',
  place: null,
  state: { is: 'active' },
  // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece: its shelf row names no work.
  named: null,
  inAnotherWindow: false,
  updatedAt: NOW - 60_000,
  ...over,
})

const LIST: readonly ListedConversation[] = [
  listed({ sessionId: 'sess_live' }),
  listed({ sessionId: 'sess_old', state: { is: 'idle' } }),
  // ⚑ **Somebody else's, on the same list** — so the shelf's narrowing is measured rather than
  // assumed.
  listed({ sessionId: 'sess_ali', identity: 'ali', label: 'Ali', provider: 'codex' }),
]

const STORE = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

interface Room {
  readonly m: Mounted
}

const room = async (over: Record<string, unknown> = {}, width = FLOOR): Promise<Room> => {
  await page.viewport(width, 900)
  const m = mount(
    TeamWorkspace,
    {
      agents: AGENTS,
      store: STORE,
      beingDone: BUSY,
      held: [],
      conversations: LIST,
      ...over,
    },
    { width, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return { m }
}

/** One element by `data-cy` INSIDE one card — never off the page, which is the whole of `169`'s
 *  `an-assertion-can-be-satisfied-by-a-neighbouring-element` on a surface drawing five cards. */
const q = (root: HTMLElement, cy: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
  expect(el, `nothing with data-cy="${cy}" is inside this card`).not.toBeNull()
  return el!
}

const cardOf = (m: Mounted, slug: string): HTMLElement => m.q(`team-card-${slug}`)

const size = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)
const weight = (el: Element): number => Number.parseInt(getComputedStyle(el).fontWeight, 10)

/**
 * ⚠️ **A `<details>` toggle is an ASYNCHRONOUS task.** ⛔ Setting `.open` queues the `toggle` event
 * rather than dispatching it, so a bare `await nextTick()` can measure a disclosure that has not
 * opened yet. ⚑ The toggle is awaited on the element itself, then the macrotask queue is drained,
 * so what is measured is the settled frame (`drawn.ts` limit 6).
 */
const press = async (details: HTMLDetailsElement): Promise<void> => {
  const toggled = new Promise<void>((resolve) => {
    details.addEventListener('toggle', () => resolve(), { once: true })
  })
  details.open = !details.open
  await toggled
  for (let round = 0; round < 3; round++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  await drawnReady()
}

/** ⚑ The conversations disclosure on one card — the one with a door behind it. */
const theirs = (card: HTMLElement, slug: string): HTMLDetailsElement =>
  q(card, `team-conversations-${slug}`).closest('details') as HTMLDetailsElement

/** ⚑ The engine/count/removal disclosure on one card. */
const more = (card: HTMLElement, slug: string): HTMLDetailsElement =>
  q(card, `team-more-${slug}`).closest('details') as HTMLDetailsElement

beforeEach(() => vi.clearAllMocks())

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ══════════════════════════════════════════════════════════════════════════════ §1 · the plate */

describe('§1 · the plate is the answer, at the size this page asks for', () => {
  /**
   * An active conversation visibly animates the agent’s icon so its working state is apparent
   * without reading an explanation.
   *
   * ⛔ **Measured as a PAINTED size and not as a prop.** `size="card"` is a string in the template;
   * what a person gets is `platePx('card')` px of plate, and `box-sizing: border-box` in `base.css`
   * is what makes the two the same number. ⚑ **It differs from the default**, which is the reason
   * this is a measurement: `platePx(undefined)` is `SIZES.avatar`, 28 px, and a card drawing that
   * would pass any assertion that only read *a plate is here*.
   */
  it('🔴 a card draws its plate at the card rung of the scale, not at the default one', async () => {
    const { m } = await room()
    const plate = q(cardOf(m, 'ada'), 'agent-plate')
    expect(plate.getBoundingClientRect().width).toBeCloseTo(SIZES.card, 0)
    expect(plate.getBoundingClientRect().height).toBeCloseTo(SIZES.card, 0)
    // ⚠️ **The control for the number above**: the plate is NOT at the size a caller that said
    // nothing would get, so `toBeCloseTo(SIZES.card)` is about this page's choice.
    expect(platePx(undefined), 'the default rung moved and this case stopped measuring').not.toBe(
      SIZES.card,
    )
    // ⛔ **And it is above `PLATE_FLOOR`, so it is an avatar and not a dot** — the rung below the
    // floor draws `agent-dot` and no plate at all.
    expect(m.all('agent-dot')).toHaveLength(0)
  })

  /**
   * 🔴 **A busy agent draws a FACE, a quiet one draws a different face, and one nothing has ever
   * run as draws none.**
   *
   * ⛔ **Three arms in one mount, and the faces are compared against EACH OTHER** — a hard-coded
   * `src` would go green the day the six illustrations are re-exported under new names, and would
   * say nothing about whether the page picked the right one.
   *
   * ⚠️ **`data-doing` is the phase the fold settled on**, and for `ada` it is the ACTIVITY's
   * (`tool`) rather than the status's (`working`) — which is the whole of `593`'s wire change:
   * without `ConversationAtWork.status` the activity may not speak at all (`099`) and this reads
   * `unknown`.
   */
  it('🔴 busy draws the phase’s face, quiet-but-run draws idle, never-run draws the faceless ring', async () => {
    const { m } = await room()
    const busy = q(cardOf(m, 'ada'), 'agent-state')
    const quiet = q(cardOf(m, 'ali'), 'agent-state')
    const cold = q(cardOf(m, 'newbie'), 'agent-state')

    expect(busy.dataset.doing, 'the tool phase did not reach the plate').toBe('tool')
    expect(quiet.dataset.doing).toBe('idle')
    expect(cold.dataset.doing).toBe('unknown')

    const busyFace = q(busy, 'agent-avatar') as HTMLImageElement
    const quietFace = q(quiet, 'agent-avatar') as HTMLImageElement
    expect(visible(busyFace), 'the busy agent’s avatar is in the DOM and not on the screen').toBe(
      true,
    )
    expect(visible(quietFace)).toBe(true)
    // ⛔ **Two arms, two illustrations** — the assertion is the DIFFERENCE, so a component that
    // drew one face for every state could not satisfy it.
    expect(busyFace.src, 'busy and idle are drawn with the same illustration').not.toBe(
      quietFace.src,
    )
    expect(busyFace.getBoundingClientRect().width).toBeGreaterThan(0)

    // 🔴 **The honest seventh** — nothing has ever run as `newbie`, so there is no face to claim.
    expect(cold.querySelectorAll('[data-cy="agent-avatar"]')).toHaveLength(0)
    const ring = q(cold, 'agent-unknown')
    expect(visible(ring), 'the faceless ring is not drawn').toBe(true)
    // ⚑ **A dashed ring rather than a filled mark**, which is what makes it read as a refusal.
    expect(getComputedStyle(ring).borderStyle).toBe('dashed')
  })

  /**
   * 🔴 **No card on this page paints an underline, and the slot is still there** — `plateFor`'s
   * own closing line, *"No underline in any arm. It is the PROVIDER's liveness and this page has
   * no read for one."*
   *
   * ⛔ **`visibility`, not `display`, and the difference is the whole point** (`AgentState`'s own
   * `.underline.none` rule): a facet arriving must not make the row taller, so the assertion is a
   * PAIR — unpainted AND still occupying its 3 px.
   *
   * ⚠️ **The sensor is exercised in both directions in this case**, which is `harness.ts`'s own
   * standing request: a sensor nobody has seen return `false` is a sensor nobody has tested. The
   * plate beside it answers `true` on the same mount.
   *
   * ⛔ **And the limit of the claim, named rather than asserted away.** *Every arm* here means
   * every arm THIS ROSTER folds. `plateFor` returns `sessionFacets(toldOf(one))` for a single live
   * conversation, and a published row carrying `status: 'errored'` or `'ended'` would make
   * `sessionBeing` answer `errored`/`ended` and paint one — see the report for `593`.
   */
  it('🔴 every card leaves the underline unpainted and still holding its place', async () => {
    const { m } = await room()
    const underlines = m.all('agent-underline')
    // ⚑ **Non-vacuity**: five identities are in the fixture and each draws one plate.
    expect(underlines.length).toBe(AGENTS.identities.length)
    for (const line of underlines) {
      expect(visible(line), 'a card painted an underline').toBe(false)
      // ⛔ **The paired positive** — it is laid out, so nothing reflows when a facet arrives.
      expect(line.getBoundingClientRect().height, 'the underline slot collapsed').toBeGreaterThan(0)
    }
    // ⚠️ **The same sensor, answering the other way, on the same mount.**
    expect(visible(q(cardOf(m, 'ada'), 'agent-plate'))).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════ §2 · the state line */

describe('§2 · the state line is the one line a person reads first', () => {
  /**
   * 🔴 **Every tone the app names is a different ink AND a different dot, walked off the table.**
   *
   * ⛔ **`588`'s shape one surface over, and for its reason**: a tone may be reachable by no fixture
   * this page can build (until D-017b, `error` needed a `liveness` the Team read has no column for),
   * so rather than delete a rule `STANDING_TONE` says should exist, the class is applied directly
   * and the PAINT is asserted (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
   *
   * ⚑ **Over the distinct TONES and never over the nine standings** — `working` and `background`
   * are deliberately one tone, and a loop over the standings would report that agreement as a
   * collision.
   *
   * ⚠️ **A blank tone is BLANK on purpose** (`STANDING_TONE`'s own note): nothing is in progress,
   * and painting a schedule the same blue would claim a running machine.
   */
  it('🔴 every distinct tone is a distinct ink-and-dot pair, and the blank one is the base', async () => {
    const { m } = await room()
    const line = q(cardOf(m, 'ada'), 'team-now-ada')
    const dot = line.querySelector('.dot')!
    const readAs = (tone: string): string => {
      line.className = tone === '' ? 'team-now' : `team-now ${tone}`
      return `${getComputedStyle(line).color} / ${getComputedStyle(dot).backgroundColor}`
    }
    const blank = readAs('')
    const tones = [...new Set(Object.values(STANDING_TONE))]
    const seen = new Map<string, string>()
    for (const tone of tones) {
      const pair = readAs(tone)
      if (tone === '') {
        expect(pair, 'the blank tone is not the base pair').toBe(blank)
        continue
      }
      expect(pair, `tone "${tone}" is painted as the blank one`).not.toBe(blank)
      const already = seen.get(pair)
      expect(already, `tones "${tone}" and "${already}" are painted identically`).toBeUndefined()
      seen.set(pair, tone)
    }
    // ⚑ **A FLOOR rather than a count** — a new tone is not a red here, an eliminated one is.
    // ⚑ **D-017b · four became two, deliberately**: `ended` and `error` were process words (`05`
    // rule 5) and left with the standings that wore them; `live` and `waiting` are what is left.
    const named = tones.filter((tone) => tone !== '')
    expect(named.length).toBeGreaterThanOrEqual(2)
    expect(seen.size).toBe(named.length)
  })

  /**
   * 🔴 **`EXT-012` §1's complaint was three lines set identically.** ⛔ The state line has to
   * outweigh the facts beside it in BOTH axes of weight — size and boldness — or the card is the
   * stack it was before.
   *
   * ⚑ **Asserted as a comparison against the quiet lines in the same mount**, never as a pinned
   * `--text-2xs`: a number goes green the day the scale moves.
   */
  it('🔴 the state line outweighs the quiet lines beside it in size and in boldness', async () => {
    const { m } = await room()
    const card = cardOf(m, 'ada')
    const state = q(card, 'team-now-ada')
    // ⚑ **D-014 · the role tag is gone, and D-016 · the places label** — the slug is the quiet
    // line left.
    const quiet: readonly [string, HTMLElement][] = [
      ['the slug', card.querySelector<HTMLElement>('.team-slug')!],
    ]
    for (const [what, el] of quiet) {
      expect(size(state), `the state line is not larger than ${what}`).toBeGreaterThan(size(el))
      expect(weight(state), `the state line is not bolder than ${what}`).toBeGreaterThan(weight(el))
    }
    // ⚑ **And it says the app's own word for the arm it is in**, so the loudness is carrying a
    // fact rather than a placeholder.
    expect(state.textContent?.trim()).toBe(STANDING_LABEL.working)
  })
})

/* ════════════════════════════════════════════════════════════════════ §3 · the conversations door */

describe('§3 · the conversations disclosure', () => {
  /**
   * 🔴 **Closed on mount, and a closed disclosure paints nothing** — `086`'s fact: nobody has
   * asked, so nothing is drawn.
   *
   * ⛔ **`visible` and not a `textContent` check**: the shelves are in the DOM the whole time, and
   * every colour, rect and string sensor in this directory reads them exactly the same whether the
   * `<details>` is open or shut.
   */
  it('🔴 it is closed on mount and paints nothing', async () => {
    const { m } = await room()
    const card = cardOf(m, 'ada')
    const disclosure = theirs(card, 'ada')
    expect(disclosure.open).toBe(false)
    expect(
      visible(q(card, 'team-conversation-sess_live')),
      'a shut disclosure paints its body',
    ).toBe(false)
    // ⚑ **The summary itself is drawn** — the same sensor, the other way, on the same mount.
    expect(visible(q(card, 'team-conversations-ada'))).toBe(true)
    assertDrawn(
      q(card, 'team-conversations-ada'),
      'the disclosure summary at the pane floor',
      m.host,
    )
  })

  /**
   * ⛔ **One tab stop per disclosure and not one per paragraph** — `a-custom-focus-trap-is-the-tab-
   * order` in the place it would have cost most. ⚑ The `<summary>` is focusable by the browser's
   * own rules and nothing inside a SHUT disclosure may be.
   *
   * ⚠️ **The pair is the OPEN state**, where the presses really are stops — without it this case
   * measures a selector that matches nothing rather than a closed door.
   */
  it('⛔ the shut summary is exactly one tab stop, and opening it adds the presses', async () => {
    const { m } = await room()
    const card = cardOf(m, 'ada')
    const disclosure = theirs(card, 'ada')
    const summary = disclosure.querySelector('summary')!
    summary.focus()
    expect(document.activeElement).toBe(summary)
    const stops = '[tabindex]:not([tabindex="-1"]), button, a[href], input, select'
    // ⚠️ **D-016 · the rows are in the DOM before the door opens** — the one list is handed down,
    // not read on the press — so a stop is counted only where it is DRAWN: a browser takes nothing
    // inside a shut `<details>` into the tab order, because nothing inside it is rendered.
    const drawnStops = (): number =>
      [...disclosure.querySelectorAll<HTMLElement>(stops)].filter((one) => visible(one)).length
    expect(
      disclosure.querySelectorAll(stops).length,
      'the shut shelf holds no rows',
    ).toBeGreaterThan(0)
    expect(drawnStops()).toBe(0)
    await press(disclosure)
    expect(drawnStops(), 'an opened disclosure offers no press at all').toBeGreaterThan(0)
  })

  /**
   * 🔴 **Opening it draws the one list narrowed to the agent** — D-016: the rows are the rail's
   * own, so there is no read per project and no group per project any more.
   */
  it('🔴 opening it draws the agent’s own conversations, and nobody else’s', async () => {
    const { m } = await room()
    const card = cardOf(m, 'ada')
    await press(theirs(card, 'ada'))
    for (const conversation of ['sess_live', 'sess_old']) {
      const row = q(card, `team-conversation-${conversation}`)
      expect(visible(row), `the row for ${conversation} is not drawn`).toBe(true)
    }
    // ⛔ **The narrowing is REAL** — the list holds a conversation of Ali's and ada's shelf does
    // not list it.
    expect(card.querySelector('[data-cy="team-conversation-sess_ali"]')).toBeNull()
  })

  /**
   * ⛔ **An answered list holding none of theirs says so in a sentence about the agent** — the
   * shelf's own absence, re-aimed from the per-project *Nothing of theirs* (D-016). ⚑ The case
   * above is its positive control: the same shelf draws rows when the list holds some.
   */
  it('⛔ a list with none of theirs says so, and draws no row', async () => {
    const { m } = await room({ conversations: LIST.filter((row) => row.identity !== 'ada') })
    const card = cardOf(m, 'ada')
    await press(theirs(card, 'ada'))
    const shelf = q(card, 'team-shelf-ada')
    const quiet = shelf.querySelector<HTMLElement>('.shelf-quiet')
    expect(quiet, 'an empty shelf draws no sentence at all').not.toBeNull()
    expect(visible(quiet!)).toBe(true)
    expect(quiet!.textContent?.trim()).toBe('No conversation on the list runs as it.')
    expect(shelf.querySelectorAll('.shelf-row')).toHaveLength(0)
  })

  /**
   * ⛔ **A list that has not answered is not an empty one** (`086`: *not read* is not *none*) — the
   * shelf says it has not answered, and never that the agent has nothing.
   */
  it('⛔ a list that has not answered says so, and not that there is nothing', async () => {
    const { m } = await room({ conversations: null })
    const card = cardOf(m, 'ada')
    await press(theirs(card, 'ada'))
    const shelf = q(card, 'team-shelf-ada')
    const quiet = shelf.querySelector<HTMLElement>('.shelf-quiet')
    expect(quiet, 'an unanswered shelf draws no sentence at all').not.toBeNull()
    expect(visible(quiet!)).toBe(true)
    const said = quiet!.textContent?.trim()
    expect(said).toBe('The list of conversations has not answered yet.')
    expect(said, 'not answered and none of theirs read the same').not.toBe(
      'No conversation on the list runs as it.',
    )
    expect(shelf.querySelectorAll('.shelf-row')).toHaveLength(0)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════ §4 · the row */

describe('§4 · one conversation, as the shelf draws it', () => {
  /**
   * Check both halves of the compressed state display, including removal of the redundant
   * “this app is not running it” sentence.
   *
   * ⛔ **A row says its state once** — `222` §4's rule is one phrase per fact. ⚑ **D-017b · re-aimed**:
   * nothing a row says is about whether a process runs (`05` rule 5) — there is no *Ended*, no
   * *this app is not running it*, no *not open in any window* — so a conversation nothing runs wears
   * the one state's word and no second phrase. ⚠️ **The one fact about WHERE a conversation is that a
   * row still carries** is that another window has it open — a message from here is refused there —
   * so the two rows are asserted in ONE mount: dropping the second half would leave a test that a
   * string is never drawn rather than a test of when it is.
   *
   * ⚑ **The words come from `OPEN_IN_ANOTHER_WINDOW` and are not typed here**, so the vocabulary
   * and the assertion cannot drift apart.
   */
  it('🔴 a row nothing runs says its state once; a row another window has open says where it is', async () => {
    // ⚑ The live row, held by ANOTHER window — the one arm that still says where it is.
    const elsewhere = LIST.map((row) =>
      row.sessionId === 'sess_live' ? { ...row, inAnotherWindow: true } : row,
    )
    const { m } = await room({ conversations: elsewhere })
    const card = cardOf(m, 'ada')
    await press(theirs(card, 'ada'))

    // ⚑ **D-016 · the row says the one state in the rail's own words** (`agentStateWords`).
    const recording = q(card, 'team-conversation-sess_old')
    expect(recording.querySelector('.team-now')!.textContent?.trim()).toBe(
      agentStateWords({ is: 'idle' }),
    )
    assertDrawn(recording.querySelector<HTMLElement>('.team-now')!, 'the state', m.host)
    expect(
      recording.querySelector('.shelf-where'),
      'the row nothing runs says a second phrase',
    ).toBeNull()
    expect(recording.textContent, 'a process word is back on the row').not.toMatch(
      /ended|not running|not open in any window/i,
    )

    // 🔴 **The other half, same mount** — and it is also the control that proves the search above
    // is a search: the same shape DOES find the phrase where the phrase belongs.
    const live = q(card, 'team-conversation-sess_live')
    expect(live.querySelector('.shelf-where')!.textContent?.trim()).toBe(OPEN_IN_ANOTHER_WINDOW)
    expect(live.querySelector('.team-now')!.textContent?.trim()).toBe(
      agentStateWords({ is: 'active' }),
    )
    assertDrawn(live.querySelector<HTMLElement>('.shelf-where')!, 'where the live row is', m.host)
  })

  /**
   * 🔴 **The press takes its own LINE rather than being squeezed** — `.shelf-row`'s own note: *"a
   * card is ~280px and the action is a sentence, so when the two do not fit on one line the button
   * takes its own, and neither is clipped."* The card-face row does the same: the doing line is
   * drawn whole (a short tool name is never cut), and the press wraps below it when both do not fit.
   *
   * ⛔ **The width is MEASURED, never assumed.** `.team-grid` is `repeat(auto-fit, minmax(280px,
   * 1fr))`, so at the pane floor the card a person actually gets is whatever the grid resolves to
   * — the premise is asserted before the geometry is read.
   *
   * ⚑ **The control is the same card-face row in a card wide enough for both**: there the press
   * stays BESIDE the doing line, so the wrap above is the width's doing and not a property every
   * flex row on the page happens to have.
   */
  it('🔴 at the card’s real width both presses wrap below, and the card-face press stays beside in a wide card', async () => {
    // ⚑ **D-016 · a shelf row whose words are a sentence** — the one state, where it is and its
    // folder — because a row reading only *active* fits beside its press and has nothing to wrap.
    const wordy = LIST.map((row) =>
      row.sessionId === 'sess_live' ? { ...row, inAnotherWindow: true, place: 'garden-dev' } : row,
    )
    const { m } = await room({ conversations: wordy })
    const card = cardOf(m, 'ada')
    // ⛔ **The premise** — this really is a card at the grid's own minimum band.
    const width = card.getBoundingClientRect().width
    expect(width, `the grid resolved a ${String(width)}px card`).toBeGreaterThanOrEqual(280)
    expect(width).toBeLessThan(330)

    // ⚑ **Below**: the card-face row's press, under the doing line it would have squeezed.
    const doing = q(card, 'team-doing-sess_live')
    expect(
      q(card, 'team-go-sess_live').getBoundingClientRect().top,
      'the card-face press is still beside the doing line, so it was squeezed rather than wrapped',
    ).toBeGreaterThanOrEqual(doing.getBoundingClientRect().bottom - 1)
    assertDrawn(q(card, 'team-go-sess_live'), 'the card-face press at the pane floor', m.host)
    assertDrawn(
      doing.querySelector<HTMLElement>('.doing-word')!,
      'the doing line at the pane floor',
      m.host,
    )

    // 🔴 **Below**: the shelf row, which does too.
    await press(theirs(card, 'ada'))
    const row = q(card, 'team-conversation-sess_live')
    const act = q(card, 'team-conversation-go-sess_live')
    const body = row.querySelector<HTMLElement>('.shelf-body')!
    expect(
      act.getBoundingClientRect().top,
      'the shelf press is still beside the body, so it was squeezed rather than wrapped',
    ).toBeGreaterThanOrEqual(body.getBoundingClientRect().bottom - 1)
    // ⛔ **And nothing was cut to achieve it**, which is the half `textContent` cannot see.
    assertDrawn(act, 'the shelf press at the pane floor', m.host)
    assertDrawn(body, 'the shelf body at the pane floor', m.host)

    // ⚑ **The control, in a card with room for both.**
    const wide = await room({ conversations: wordy }, 1800)
    const roomy = cardOf(wide.m, 'ada')
    expect(roomy.getBoundingClientRect().width, 'the wide card is not wide').toBeGreaterThan(340)
    const beside = q(roomy, 'team-go-sess_live').getBoundingClientRect()
    expect(beside.top, 'the card-face press left its line in a card that has room').toBeLessThan(
      q(roomy, 'team-doing-sess_live').getBoundingClientRect().bottom,
    )
  })

  /**
   * 🔴 **An unbounded tool name shortens to ONE line, cut by its OWN box** — a provider's `detail`
   * is a word it chose and nothing this app owns bounds it.
   *
   * ⛔ **Three facts, because a looser reading passes over two of them** (`588` M13's lesson):
   * a wrapped line and an ellipsised one are both short enough to satisfy a height bound, and
   * `text-overflow` does nothing at all without a clipper — so `lineCount` says it did not wrap,
   * and `Clip.by` says WHICH box did the cutting.
   *
   * ⚑ **`never`, not `by-scrolling`** — an ellipsis is the mark for ink a person cannot reach.
   *
   * ⚠️ **D-016 · read on the card-face row**: the shelf's rows are the one list's and draw no tool
   * name any more, and the card-face doing line is `588`'s treatment declaration for declaration.
   */
  it('🔴 an unbounded tool name is one line, cut by its own box, and takes nothing with it', async () => {
    const { m } = await room({ beingDone: done([working('sess_live', 'ada', 'a'.repeat(160))]) })
    const card = cardOf(m, 'ada')
    const row = q(card, 'team-doing-sess_live')
    const word = row.querySelector<HTMLElement>('.doing-word')!
    expect(lineCount(word), 'the tool name wrapped instead of shortening').toBe(1)
    const cut = clipsOf(word, m.host).find((clip) => clip.axis === 'x')
    expect(cut, 'the tool name is not cut on the x axis at all').toBeDefined()
    expect(
      cut!.by,
      `the word is cut by ${cut!.byCy ?? cut!.by.className} and not by its own box, so no ellipsis is drawn`,
    ).toBe(word)
    expect(cut!.reach).toBe('never')
    // ⛔ **The fixed parts keep their place** — the dot is a 5px mark and a squeezed one is a mark
    // nobody sees; the age is the fact beside it.
    const dot = row.querySelector<HTMLElement>('.dot')!
    expect(dot.getBoundingClientRect().width, 'the doing dot was squeezed').toBeCloseTo(5, 0)
    assertDrawn(
      row.querySelector<HTMLElement>('.doing-since')!,
      'the age beside a long name',
      m.host,
    )
    // ⚑ **The paired negative, and it needs its OWN mount.** ⚠️ The control is the SAME element of
    // the SAME row at the SAME width, with an ordinary tool name — so the verdict above is about
    // this string and not about this element (`a-control-must-be-trapped-the-way-the-subject-is`).
    const fits = await room()
    const ordinary = q(cardOf(fits.m, 'ada'), 'team-doing-sess_live').querySelector<HTMLElement>(
      '.doing-word',
    )!
    expect(ordinary.textContent).toBe('running Bash')
    expect(clipsOf(ordinary, fits.m.host), 'a tool name that fits is cut anyway').toEqual([])
    expect(lineCount(ordinary)).toBe(1)
  })
})

/* ══════════════════════════════════════════════════════════════════ §5 · behind the second door */

describe('§5 · what moved behind the disclosure is still readable there', () => {
  /**
   * 🔴 **`EXT-012` §1 exactly** — *"three different KINDS of fact — a count, a category, an engine
   * — set identically and stacked."* ⛔ The two that stayed are LABELLED, and the label is a
   * different register from the value rather than the same line twice.
   *
   * ⚠️ **Read off the narrowest elements.** `toContain` on a card is satisfied by any neighbour
   * holding the word (`an-assertion-can-be-satisfied-by-a-neighbouring-element`); the key and the
   * value are separate elements and each is read where it lives.
   */
  it('🔴 the engine and the archival count each wear a label in a different register', async () => {
    const { m } = await room()
    const card = cardOf(m, 'ali')
    await press(more(card, 'ali'))
    const pairs: readonly [string, HTMLElement, string][] = [
      ['Engine', q(card, 'team-provider-ali'), 'codex'],
      ['Recorded', q(card, 'team-recorded-ali'), '3 conversations'],
    ]
    for (const [label, value, says] of pairs) {
      const key = value.closest('.more-fact')!.querySelector<HTMLElement>('.more-key')!
      expect(key, 'the value and its label are the same element').not.toBe(value)
      expect(key.textContent?.trim()).toBe(label)
      expect(value.textContent?.trim()).toBe(says)
      // ⛔ **A different register and not merely a different string** — uppercased and quieter,
      // which is what lets a person tell at a glance which half of the line is the question.
      expect(getComputedStyle(key).textTransform).toBe('uppercase')
      expect(getComputedStyle(value).textTransform).toBe('none')
      expect(getComputedStyle(key).color, 'the label is the value’s ink').not.toBe(
        getComputedStyle(value).color,
      )
      assertDrawn(key, `the ${label} label`, m.host)
      assertDrawn(value, `the ${label} value`, m.host)
    }
  })

  /**
   * 🔴 **`EXT-012` §1.2:** *"`Removal unavailable: conversations, a-project, this-app, a-launch.`
   * Four internal reason codes shown to a person as a comma list. `a-project` and `a-launch` are
   * not English."*
   *
   * ⛔ **The un-English key is planted**, and the plant is the fold's own answer rather than a claim
   * of this test (⚑ D-016 took `a-project`, the second one, out with projects): `whatHoldsIt` is
   * asked for the very `IdentityUse` the page is folding, so the key is known to be in the model at
   * the moment the screen is searched for it.
   *
   * ⚑ **And the search shape is proved on the same text** — it finds every sentence
   * `HOLDING_SAYS` supplies, so *it does not find the keys* is a measurement and not a broken
   * query (`a-negative-is-only-as-strong-as-the-search-shape`).
   *
   * 🔴 **The negative is scoped to the keys that are NOT English, and the scope is DERIVED.**
   * ⛔ `EXT-012` §1.2 names exactly those two — *"`a-project` and `a-launch` are not English"* —
   * and `conversations` is a key whose spelling IS the ordinary word: it is on this card twice, in
   * `HOLDING_SAYS.conversations`' own sentence and in *2 conversations*, and a sweep that refused
   * it would be refusing the repair. ⚑ So the filter is *the key carries a hyphen* rather than a
   * hand-written pair, and the count is asserted so it cannot quietly narrow to nothing.
   */
  it('🔴 the refusal is in English, and neither reason key reaches the card', async () => {
    const { m } = await room()
    const card = cardOf(m, 'starter')
    await press(more(card, 'starter'))
    const held = whatHoldsIt(STARTER_USE)
    // ⛔ **The plant**: `EXT-012` §1.2's un-English key that is left really is what the fold holds.
    expect(held).toContain('a-launch')
    const refusal = q(card, 'team-removal-refusal-starter')
    // ⚑ **The search shape, proved positive first.**
    for (const why of held) expect(refusal.textContent).toContain(HOLDING_SAYS[why])
    assertDrawn(refusal, 'the removal refusal at the pane floor', m.host)
    // 🔴 **And then the negative, over the WHOLE card** — a key on any line of it is the defect.
    const notEnglish = held.filter((why) => why.includes('-'))
    expect(notEnglish, 'the plant no longer carries an un-English key').toEqual(['a-launch'])
    for (const key of notEnglish) {
      expect(card.textContent, `the reason key "${key}" is on the card`).not.toContain(key)
    }
    // ⛔ **The press it explains is really refused**, so the sentence is not decoration.
    expect(q(card, 'team-remove-starter').hasAttribute('disabled')).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════ §6 · the floor */

describe('§6 · the whole card at the width a person actually has', () => {
  /**
   * 🔴 **Every string this surface DRAWS, swept, at the pane floor, with both disclosures open.**
   *
   * ⛔ **A sweep rather than an assertion per line**, which is `531`'s own finding: *"an assertion
   * per line only ever covers the lines somebody already suspected, and all three of the sentences
   * repaired at 531 were read by suites that were green."*
   *
   * ⚑ **`Carrier.cut` is `notDrawn` and not `cutsOf`** — so a line whose ink lands entirely
   * outside a `hidden` box counts too, and a string of which NOTHING is painted cannot pass as
   * *drawn in full*. ⚠️ Below the fold of `.team-workspace`'s own scroller is `by-scrolling` and is
   * deliberately not a defect.
   *
   * ⛔ **Compared per carrier and never by total** (`drawn.ts` limit 8): the assertion is the LIST,
   * named, so a repair that merely pushed a row out of the box could not read as a repair.
   */
  it('🔴 nothing on any card is cut at the pane floor, with every disclosure open', async () => {
    const { m } = await room()
    for (const slug of ['ada', 'ali', 'newbie', 'starter']) {
      const card = cardOf(m, slug)
      if (card.querySelector(`[data-cy="team-conversations-${slug}"]`))
        await press(theirs(card, slug))
      await press(more(card, slug))
    }
    const carriers = sweep(m.host)
    // ⚑ **Non-vacuity**: a sweep that found nothing would report no cuts either.
    expect(carriers.length, 'the sweep measured almost nothing').toBeGreaterThan(40)
    const cut = carriers.filter((carrier) => carrier.cut !== null)
    expect(cut.map(describeCarrier), 'strings a person cannot read at the pane floor').toEqual([])
  })

  /**
   * ⛔ **The positive control for the sweep above** — *nothing is cut* is only a measurement if
   * this sensor, on this surface, at this width, CAN say otherwise
   * (`a-positive-assertion-must-differ-from-the-default`).
   *
   * ⚑ **Planted the way the product would really produce one**: an unbounded tool name, which is
   * §4's own case read through the sweep rather than through a single element.
   */
  it('⛔ the same sweep does report a cut when an unbounded name is on the card', async () => {
    const { m } = await room({
      beingDone: done([working('sess_live', 'ada', 'b'.repeat(200))]),
      held: ['sess_live'],
    })
    const cut = sweep(cardOf(m, 'ada')).filter((carrier) => carrier.cut !== null)
    expect(cut.length, 'the sweep cannot see a cut on this surface at all').toBeGreaterThan(0)
    expect(cut.every((carrier) => carrier.cut!.reach === 'never')).toBe(true)
  })
})
