import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { facetsOfState, type RailSays } from '../../src/renderer/src/lib/agent-state'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'
import { DRAWER_W_MAX, DRAWER_W_MIN, TRANSCRIPT_MIN } from '../../src/renderer/src/lib/drawer'
import { NOBODY_IN_THIS_APP_SPAWNED_IT } from '../../src/renderer/src/lib/working-together'
import {
  OPEN_IN_ANOTHER_WINDOW,
  OPEN_THE_CONVERSATION,
} from '../../src/renderer/src/lib/taking-over'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { ForestNode } from '../../src/shared/the-whole-forest'
import { forestView } from '../../src/renderer/src/lib/the-forest'
import { conv, forestDrawn, forestOf } from './forest-fixture'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { assertClippedButTold, assertDrawn, describeCarrier, drawnReady, sweep } from './drawn'
import { META, drawerProps, mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **547 · the first picture of who called whom** — `540` §7 slice 1's renderer half, drawn in a
 * real engine at the widths the drawer really takes.
 *
 * ## ⛔ Why every assertion here fails on `main` as of `1ea784ce`
 *
 * ⚠️ **`543` built `RuntimeHost.whoCalledWhom` and NOTHING drew it.** The first tab's body was the
 * bot, the open rows and a sentence pointing at the Work tab; there is no `[data-cy="working-together"]`
 * in that build, so §1 below cannot find its band and every card query returns null. ⛔ **A read
 * with no reader is a read whose shape nobody has tested against a person**, which is what §7 is
 * about — the fields `543` did not carry, measured rather than argued.
 *
 * ## 🔴 §0 is the whole reason `543` exists, and it is standing rule 12
 *
 * ⛔ **TWO conversations of the SAME identity**, which is the case a slug cannot tell apart: v2.8's
 * own reason for making a card a CONVERSATION — *"a role-first list merges distinct conversations
 * made from one identity"* — and the exact shape `WorkGivenOut.givenToProfile` collapses.
 *
 * ## ⚠️ What this file measures rather than asserts
 *
 * ⛔ **§6 draws the longest realistic card at `--drawer-w-narrow`** — 320px, the narrowest column
 * the drawer is ever laid out in before it floats — and reads the INK with `drawn.ts` rather than
 * `textContent`. ⚑ `530` F1: *"`textContent` is identical whether a browser drew a string or
 * clipped it"*, and four suites were green over a value that had never fitted its column.
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The channel is a window-level singleton**, so a reading left behind would be the next
  // test's premise. ⚠️ Reset to the cold state rather than to an empty band — they are different
  // facts and this file asserts about both.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.railSays.value = null
})

/** ⚑ A stable instant, so every age below is a fact about the fixture rather than about the clock. */
const NOW = Date.now()

const identity = (slug: string, displayName: string | null = null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: NOW - 86_400_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  // ⚑ **The shipped defaults**, because nothing on this band reads a capability — a grant invented
  // here would be a fact about this file rather than about the app.
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const spawn = (over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation: 'sess_child',
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

const edge = (over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece: 'work_one',
  label: 'W1.4',
  title: 'read the brief and report',
  from: META.sessionId,
  fromIdentity: 'default',
  to: 'sess_child',
  toIdentity: 'worker',
  state: 'working',
  givenAt: NOW - 120_000,
  endedAt: null,
  ...over,
})

/**
 * The strip’s `<li>` elements draw one chip per agent, with a small plate and name, side by
 * side.
 */
const agentRows = (strip: HTMLElement): HTMLElement[] => [
  ...strip.querySelectorAll<HTMLElement>(':scope > li'),
]

/**
 * A graph piece is drawn on the card of the conversation holding it. The right panel shows
 * only the current agent’s card; the Graph tab shares the Team page’s forest.
 */
const rowOf = (line: Element): HTMLElement | null =>
  line.closest<HTMLElement>('[data-kind="a-conversation"]')

/** ⚑ **One agent's card in the graph** — every card is drawn at once, so finding it is the whole act. */
function kidIn(m: Mounted, conversation: string): HTMLElement {
  return m.q(`forest-row-${conversation}`)
}

/** ⚑ **The pieces drawn on one agent's card**, in the card's order. */
const piecesOn = (card: HTMLElement): HTMLElement[] => [
  ...card.querySelectorAll<HTMLElement>('[data-kind="a-task"]'),
]

/** ⚑ **The pieces this conversation GAVE** — on the cards of the ones holding them, never its own. */
const given = (m: { graph: Mounted }): HTMLElement[] =>
  [...m.graph.host.querySelectorAll<HTMLElement>('[data-kind="a-task"]')].filter(
    (row) => row.dataset.conversation !== META.sessionId,
  )

/**
 * ⚑ **The forest this reading describes** — this conversation, its parent above it, the ones it
 * spawned under it, any other it gave work to at the root, and every piece on the card that holds
 * it. ⚠️ The Graph tab draws the WHOLE forest from its own read; a reading of one conversation is the
 * part of it these assertions are about.
 */
function forestFrom(read: WhoCalledWhom, identities: readonly AgentIdentity[] | null) {
  const rows: ForestNode[] = []
  if (read.parent)
    rows.push(conv(read.parent.conversation, null, { identity: read.parent.identity }))
  rows.push(conv(META.sessionId, read.parent?.conversation ?? null, { identity: 'default' }))
  const drawn = new Set([META.sessionId, read.parent?.conversation])
  for (const child of read.children.rows) {
    rows.push(
      conv(child.conversation, META.sessionId, {
        identity: child.identity,
        running: child.running,
      }),
    )
    drawn.add(child.conversation)
  }
  for (const work of [...read.workGivenOut.rows, ...read.workTakenIn.rows]) {
    if (!drawn.has(work.to)) {
      rows.push(conv(work.to, null, { identity: work.toIdentity ?? 'worker' }))
      drawn.add(work.to)
    }
    rows.push({
      node: 'a-task',
      under: { is: 'a-conversation', conversation: work.to },
      givenBy:
        work.from === null
          ? { is: 'the-person' }
          : { is: 'a-conversation', conversation: work.from },
      work,
    } as unknown as ForestNode)
  }
  return forestView({
    forest: forestOf(rows),
    atWork: null,
    waits: null,
    identities,
    held: new Set<string>(),
  })
}

const walk = <Row>(
  rows: readonly Row[],
  kind: LedgerWalkKind,
  over: Partial<LedgerWalk<Row>> = {},
): LedgerWalk<Row> => ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0, ...over })

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

interface Shown {
  read: WhoCalledWhom | null
  answered?: boolean
  identities?: readonly AgentIdentity[] | null
  /** ⚑ Absent ⇒ no screen above the drawer, so the band draws no press at all. */
  press?: string[]
  /**
   * ⚑ **632 · what each running conversation was last told it is doing**, or absent for a band that
   * has no such reading — which is the state every case written before `632` is in.
   */
  atWork?: WhatIsBeingDone | null
  width?: number
  /** ⚑ The main panel's width for the graph — a wide column unless a test measures a narrow one. */
  graphWidth?: number
  /** ⚑ **UI-004 · the rail's rows**, so a chip says its state word — absent is no rail on screen. */
  rail?: ReadonlyMap<string, RailSays>
}

/**
 * Read the right panel and main graph together. Both use the same who-called-whom channel;
 * seek a hook first in the drawer and then in the graph, so the assertion follows whichever
 * surface draws the fact.
 */
function beside(drawer: Mounted, graph: Mounted): Mounted & { drawer: Mounted; graph: Mounted } {
  return {
    ...drawer,
    drawer,
    graph,
    q(cy: string): HTMLElement {
      const el =
        drawer.host.querySelector<HTMLElement>(`[data-cy="${cy}"]`) ??
        graph.host.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
      expect(el, `nothing with data-cy="${cy}" is in the DOM`).not.toBeNull()
      return el!
    },
    all: (cy: string): HTMLElement[] => [...drawer.all(cy), ...graph.all(cy)],
  }
}

async function show(over: Shown) {
  const cast = useWhoCalledWhom()
  cast.reading.value =
    over.read === null
      ? null
      : {
          conversation: META.sessionId,
          read: over.read,
          answered: over.answered ?? true,
          atWork: over.atWork ?? null,
        }
  cast.goTo.value = over.press ? (conversation) => over.press!.push(conversation) : null
  cast.railSays.value = over.rail ?? null
  const drawer = mount(
    SessionDrawer as never,
    drawerProps({ identities: over.identities ?? null }),
    {
      width: over.width ?? DRAWER_W_MIN,
      height: 900,
    },
  )
  const graph = mount(
    TeamForest,
    {
      view: over.read === null ? null : forestFrom(over.read, over.identities ?? null),
      current: META.sessionId,
    },
    { width: over.graphWidth ?? 1000, height: 900 },
  )
  // ⚑ Vue Flow draws the forest's cards a frame after the mount.
  await forestDrawn()
  return beside(drawer, graph)
}

/* ------------------------------------------------------------------ §0 */

describe('§0 · the premise — two conversations of one identity', () => {
  /**
   * 🔴 **Standing rule 12, and the case the whole read exists for.** ⛔ One identity, two
   * conversations, both spawned from here — and `WorkGivenOut` can name only the IDENTITY, so a
   * band built on it would draw one row for two different agents doing two different things.
   */
  it('🔴 two children of ONE identity are two tiles with one name and two conversation ids', async () => {
    // ⚑ W4.183 · at the panel's widest, where two cards share a row (one per row toward 360px).
    const m = await show({
      identities: [identity('worker', 'Worker')],
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
      }),
      width: DRAWER_W_MAX,
    })

    // 🔴 **631 · a child is a TILE in the strip now** — the card, its name row and its reason line
    // went; what survives is the PROPERTY: one identity, two conversations, two things on screen,
    // each addressed by the conversation it IS.
    const strip = m.q('cast-children-strip')
    const tiles = agentRows(strip)
    expect(tiles).toHaveLength(2)
    const named = [...m.host.querySelectorAll<HTMLElement>('[data-cy^="cast-tile-name-"]')]
    // ⛔ **One NAME**, because there is one identity — which is exactly what makes a slug useless.
    expect(named.map((el) => el.textContent?.trim())).toEqual(['Worker', 'Worker'])
    // ⚑ **Two CONVERSATIONS**, which is the fact `540` measured as missing. ⛔ The id moved off a
    // card's `data-conversation` onto the tile's own `data-cy`, and it is still the only thing on
    // this band that tells these two apart.
    expect(named.map((el) => el.dataset.cy)).toEqual([
      'cast-tile-name-sess_a',
      'cast-tile-name-sess_b',
    ])
    // Measure two boxes side by side. Counting elements cannot distinguish two separate
    // conversations from overlapping chips or a merged presentation behind one name.
    expect(tiles[0]!.checkVisibility()).toBe(true)
    expect(tiles[1]!.checkVisibility()).toBe(true)
    expect(tiles[0]!.getBoundingClientRect().right).toBeLessThanOrEqual(
      tiles[1]!.getBoundingClientRect().left,
    )
  })

  /**
   * ⛔ **The same identity on both ends of one piece of work**, which is the other half of `543`
   * §0: the work row names the recipient CONVERSATION, so two tasks to two conversations of one
   * identity nest under two cards rather than one.
   */
  it('⛔ work to two conversations of one identity names the conversation it was given to', async () => {
    const m = await show({
      identities: [identity('worker', 'Worker')],
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
        workGivenOut: walk(
          [
            edge({ piece: 'work_a', label: 'W1.1', to: 'sess_a', title: 'the first half' }),
            edge({ piece: 'work_b', label: 'W1.2', to: 'sess_b', title: 'the second half' }),
          ],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })

    // The work row identifies its recipient conversation through `data-conversation` and a
    // visible piece label. In the graph, each line belongs inside its recipient’s card; the
    // other recipient’s line must be absent from that card.
    const seen: HTMLElement[] = []
    for (const [conversation, label, sentence] of [
      ['sess_a', 'W1.1', 'the first half'],
      ['sess_b', 'W1.2', 'the second half'],
    ] as const) {
      const work = [...piecesOn(kidIn(m, conversation))]
      expect(work.map((el) => el.dataset.conversation)).toEqual([conversation])
      const row = work[0]!
      expect(row.textContent, `${conversation} lost its label`).toContain(label)
      expect(row.textContent, `${conversation} lost its sentence`).toContain(sentence)
      // ⚑ **The line sits in its own recipient's block**, the one the open chip names — the case a
      // slug cannot tell apart, told apart by the conversation the block is.
      expect(rowOf(row)?.dataset.conversation).toBe(conversation)
      seen.push(row)
    }
    expect(seen[0]).not.toBe(seen[1])
    // 🔴 **…and both conversations have a face in the strip**, so the plates and the task lines
    // cannot disagree about how many agents are in this picture.
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ §1 */

describe('§1 · the property — who started it, what it started, and what passed between', () => {
  it('🔴 the panel draws the parent, this conversation and the child, by conversation id', async () => {
    const m = await show({
      identities: [identity('default', 'BroBot'), identity('project-manager', 'Project manager')],
      read: answer({
        parent: spawn({
          conversation: 'sess_parent',
          identity: 'default',
          running: 'in-a-window',
        }),
        children: walk(
          [spawn({ conversation: 'sess_pm', identity: 'project-manager' })],
          'every-conversation-this-one-spawned',
        ),
        workGivenOut: walk(
          [edge({ to: 'sess_pm', toIdentity: 'project-manager' })],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })

    expect(m.q('working-together')).toBeTruthy()

    // 🔴 **631 · the parent is drawn ABOVE the big avatar now, not in this band.** ⛔ The band's own
    // copy was removed once the row carried every fact it had — see `WorkingTogether`'s note where
    // it stood. ⚑ `show()` mounts the whole `SessionDrawer`, so the row is in this tree and these
    // are the same assertions re-pointed rather than dropped.
    expect(m.all('cast-parent-name'), 'the band stopped drawing the parent').toHaveLength(0)
    expect(m.q('came-from-name').textContent?.trim()).toBe('BroBot')
    // ⚑ **D-016 · the parent row carries no reason and no age** — the spawn edge says only who
    // started whom (the brief is the piece's own row), so the `came-from-reason` and
    // `came-from-since` hooks went with `spawnReason` and `spawnedAt`.
    // 🔴 **631 · the root line is gone and its job moved one element up.** ⛔ It said *this
    // conversation* above the children; the big avatar says WHO this conversation is, with a plate
    // and a name rather than in words. ⚑ Re-pointed rather than dropped — `show()` mounts the
    // whole `SessionDrawer`, so the bot is in this tree.
    const bot = m.q('session-bot')
    expect(bot.querySelector('[data-cy="session-bot-name"]')?.textContent?.trim()).toBe('BroBot')
    // ⚠️ **…and the picture is read top to bottom, in PIXELS** — who called it, this conversation,
    // then what it called. ⚑ **UI-006 (F045)** — the way UP is its own row at the top of the
    // panel, above the card and outside the card's scroller: never in the card, never below it.
    const band = m.q('working-together')
    const up = m.q('panel-came-from')
    expect(bot.contains(up), 'the way up is still in the card’s header').toBe(false)
    expect(up.getBoundingClientRect().bottom).toBeLessThanOrEqual(bot.getBoundingClientRect().top)
    // ⛔ The pair: the band is inside the card's scroller, and the way up is not.
    expect(band.closest('[data-cy="panel-body"]'), 'the band left the scroller').not.toBeNull()
    expect(up.closest('[data-cy="panel-body"]'), 'the way up scrolls away').toBeNull()
    expect(bot.getBoundingClientRect().top).toBeLessThan(band.getBoundingClientRect().top)
    // 🔴 **631 · the child is a TILE, addressed by its conversation** — the card and its name row
    // were replaced, the id and the name were not.
    expect(m.q('cast-tile-name-sess_pm').textContent?.trim()).toBe('Project manager')
    // Read the profile on its graph card.
    expect(kidIn(m, 'sess_pm').querySelector('[data-cy="forest-slug"]')?.textContent?.trim()).toBe(
      'project-manager',
    )
    // ⛔ **The recipient is not drawn twice** (v2.8 §01) — it was spawned AND given work, and that
    // is ONE tile plus one task line naming it, never a second tile minted from the work edge.
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(1)
    const work = given(m)
    expect(work).toHaveLength(1)
    expect(work[0]!.dataset.conversation).toBe('sess_pm')
    // ⚑ The line sits under its recipient's node, rather than naming it again.
    expect(rowOf(work[0]!)?.dataset.conversation).toBe('sess_pm')
  })

  /*
   * Given-out work is drawn on each holder’s forest card
   * (`who-called-whom-as-generations.dom.test.ts` §4). `TaskList`’s latest-three limit,
   * earlier count, and Markdown stripping are tested at its actual mount in
   * `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`.
   */

  /**
   * Every strip chip opens its agent’s conversation, moving down one level; the card’s ↑
   * moves up. The right panel displays only the current agent’s card.
   */
  it('🔴 every agent is a chip, and a press opens that agent’s conversation', async () => {
    const press: string[] = []
    const m = await show({
      press,
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_quiet' }), spawn({ conversation: 'sess_busy' })],
          'every-conversation-this-one-spawned',
        ),
        workGivenOut: walk([edge({ to: 'sess_busy' })], 'every-conversation-this-one-gave-work-to'),
      }),
    })
    const chips = agentRows(m.q('cast-children-strip'))
    expect(
      chips.map((one) => one.querySelector('[data-cy^="cast-tile-name-"]')?.textContent),
    ).toEqual(['worker', 'worker'])
    // ⚑ Each chip draws its small plate.
    for (const chip of chips) expect(chip.querySelector('[data-cy="agent-plate"]')).toBeTruthy()
    chips[1]!.querySelector('button')!.click()
    expect(press).toEqual(['sess_busy'])
    // ⛔ …and no card opens under the strip: the panel is this agent's card alone.
    expect(m.drawer.host.querySelectorAll('.agent')).toHaveLength(0)
    expect(m.drawer.all('session-bot')).toHaveLength(1)
  })

  it('⚑ THE CONTROL — with nothing above the drawer to open one, a chip is not a control', async () => {
    const m = await show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    const chips = agentRows(m.q('cast-children-strip'))
    expect(chips).toHaveLength(2)
    for (const chip of chips) expect(chip.querySelector('button')).toBeNull()
  })

  it('🔴 a tile draws the big avatar’s facts as it does: the plate, and beside it the name, profile and word', async () => {
    const m = await show({
      identities: [identity('project-manager', 'Project manager')],
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_pm', identity: 'project-manager' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    const box = (el: Element | null | undefined): DOMRect => {
      expect(el, 'a fact the order is read over was not drawn').toBeTruthy()
      return el!.getBoundingClientRect()
    }
    const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    /**
     * The plate sits on the left. Beside it, the name and profile share a line, with the
     * state word underneath.
     */
    const laidOut = (block: Element): void => {
      const plate = box(block.querySelector('[data-cy="agent-plate"]'))
      const name = box(block.querySelector('[data-cy="session-bot-name"]'))
      const profile = box(block.querySelector('[data-cy="session-bot-profile"]'))
      const word = box(block.querySelector('[data-cy="session-bot-word"]'))
      expect(plate.right, 'the name is not beside the plate').toBeLessThanOrEqual(name.left)
      expect(name.right, 'the profile is not after the name').toBeLessThanOrEqual(profile.left)
      expect(name.bottom, 'the word is not under the name').toBeLessThanOrEqual(word.top + 1)
    }

    const bot = m.q('session-bot')
    laidOut(bot)

    // The descendant’s forest card in the graph draws its plate on the left, its name and
    // profile beside it, and its standing in words below.
    const node = kidIn(m, 'sess_pm')
    const plate = box(node.querySelector('[data-cy="agent-plate"]'))
    const name = box(node.querySelector('[data-cy="forest-name"]'))
    const profile = box(node.querySelector('[data-cy="forest-slug"]'))
    const word = box(node.querySelector('[data-cy="forest-says"]'))
    expect(plate.right, 'the name is not beside the plate').toBeLessThanOrEqual(name.left)
    expect(name.bottom, 'the profile is not under the name').toBeLessThanOrEqual(profile.top + 1)
    expect(profile.bottom, 'the word is not under the profile').toBeLessThanOrEqual(word.top + 1)
    // ⚑ D-016 · the profile alone: the project that followed it went with projects.
    expect(words(node.querySelector('[data-cy="forest-slug"]')!)).toBe('project-manager')
  })

  /**
   * 🔴 **632 · the PARENT wears a state too, and until now nothing said so.**
   *
   * ⛔ **Found by verifying `632 M8` RED and getting GREEN.** That row strips `atWork` from the
   * parent's card — *"a band where only half the rows can speak is the half-fix `547` already
   * shipped"* — and every test in this tree passed with it applied, because `631` moved the parent
   * out of the band and into `SessionPanel` and no assertion followed it there. ⚑ A row no
   * mutation can kill is a row carrying no rule ([[a-line-no-mutation-can-kill-is-not-carrying-its-rule]]).
   *
   * Show the reason and age at the top-level agent; a plate that always answers `unknown`
   * cannot convey the available state.
   */
  it('🔴 the parent’s own plate says what the parent is doing, not `unknown`', async () => {
    const doing: WhatIsBeingDone = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_parent',
          identity: 'default',
          told: { said: 'an-activity', phase: 'thinking', detail: null },
          status: 'working',
          streaming: false,
          since: NOW - 30_000,
          context: null,
        },
      ],
    }
    const seen = (over: Partial<Shown> = {}) =>
      show({
        identities: [identity('default', 'BroBot')],
        read: answer({
          parent: spawn({
            conversation: 'sess_parent',
            identity: 'default',
            running: 'in-a-window',
          }),
        }),
        ...over,
      })

    const told = await seen({ atWork: doing })
    const plate = told.q('panel-came-from').querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(plate, 'the parent row drew no plate at all').not.toBeNull()
    // ⛔ **The reading reaches the PARENT's card**, through `parentCardOf` — the one derivation
    // `SessionPanel` and the band share, so the row above the avatar and the strip below it can
    // never disagree about a conversation both are looking at.
    expect(plate!.dataset.doing, 'the parent is drawn as though nothing were known').toBe(
      'thinking',
    )
    expect(
      plate!.querySelector('[data-cy="agent-avatar"]'),
      'a known state drew no face',
    ).not.toBeNull()
    told.unmount()

    // 🔴 **The control, and it is the same mount one fact over** (standing rule 3): with NO reading
    // the same parent wears the faceless ring, so the green above is a fact about `atWork` and not
    // about a component that draws `thinking` for everybody.
    const untold = await seen({ atWork: null })
    const cold = untold.q('panel-came-from').querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(cold!.dataset.doing).toBe('unknown')
    // Missing state reads `unknown`, never `idle`; absence cannot establish inactivity.
    expect(cold!.dataset.doing).not.toBe('idle')
    expect(cold!.querySelector('[data-cy="agent-unknown"]')).not.toBeNull()
  })

  /**
   * ⚑ **Work RECEIVED does not make a child**, which is v2.8's `handoff-worker` state and `540`
   * §5's measurement: a leaf with a task is still a leaf.
   */
  it('⚑ work this conversation was GIVEN draws no child branch', async () => {
    const m = await show({
      read: answer({
        workTakenIn: walk(
          [edge({ from: 'sess_parent', fromIdentity: 'default', to: META.sessionId })],
          'every-piece-of-work-this-one-was-given',
        ),
      }),
    })
    // 🔴 **631 · a leaf with a task is still a leaf** — no tile in the strip, and no piece on a
    // holder's card in the graph. ⛔ The strip is ABSENT rather than empty when there is no child.
    expect(m.all('cast-children-strip'), 'work received drew a child tile').toHaveLength(0)
    expect(given(m), 'work received drew a given-out row').toHaveLength(0)
    // ⛔ **The work itself is still on the band, in the other list** — `cast-taken-in`'s section
    // became `cast-taken`, one line per piece, and each line carries the GIVER's conversation.
    expect(m.q('cast-taken').textContent).toContain('W1.4')
    const taken = m.all('cast-taken-work')
    expect(taken).toHaveLength(1)
    expect(taken[0]!.dataset.conversation).toBe('sess_parent')
    // The heading conveys work direction because both lists share row markup. On the agent
    // card, it is “Current task”.
    expect(m.q('cast-taken-heading').textContent?.trim()).toBe('Current task')
    // ⛔ …and the empty child list still says what it is, rather than being hidden by the work.
    expect(m.q('cast-children-empty').textContent).toContain('No conversations started')
    expect(m.q('cast-children-empty').textContent).toContain(
      'Conversations this agent starts appear here.',
    )
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the three empties, and none of them is “0 spawned”', () => {
  /** ⚑ **A complete, empty child list** — the only state that may draw the sentence. */
  it('⚑ a complete empty list says No conversations started, and says it once', async () => {
    const m = await show({ read: answer() })
    expect(m.q('cast-children-empty').textContent).toContain('No conversations started')
    expect(m.q('cast-children-empty').textContent).toContain(
      'Conversations this agent starts appear here.',
    )
    expect(m.all('cast-children-doubt')).toHaveLength(0)
    expect(m.all('cast-children-short')).toHaveLength(0)
    expect(m.q('working-together').textContent).not.toContain('0 spawned')
  })

  /**
   * ⛔ **An ABSENT relationship read** — `no-such-conversation`, which `543` made the lineage half's
   * own word. ⚠️ Different copy, and the empty sentence is withheld.
   */
  it('⛔ a read that could not look says so, and never draws the empty sentence', async () => {
    const m = await show({
      read: answer({
        children: walk<SpawnEdge>([], 'no-such-conversation'),
      }),
    })
    expect(m.all('cast-children-empty')).toHaveLength(0)
    expect(m.q('cast-children-doubt').textContent).toContain('Nothing was read for this')
    // ⚑ …and it is the LIST's doubt, not the read's: the round trip answered perfectly well.
    expect(m.all('cast-refusal')).toHaveLength(0)
    // ⚑ **And the parent's absence is withheld with it** — one read, one doubt.
    expect(m.all('cast-parent-empty')).toHaveLength(0)
  })

  /** ⛔ **An INCOMPLETE list** — a half-written spawn the walk refused and counted. */
  it('⛔ an incomplete list is short by a number, and still not empty', async () => {
    const m = await show({
      read: answer({
        children: walk([spawn()], 'every-conversation-this-one-spawned', { rowsUnread: 2 }),
      }),
    })
    expect(m.all('cast-children-empty')).toHaveLength(0)
    expect(m.q('cast-children-short').textContent).toContain('2 rows could not be read')
    // 🔴 **631 · "still not empty" is measured on the STRIP now** — the child cards went and the
    // row of medium plates replaced them, so the one child the walk DID read is a tile rather than
    // a card. ⚑ Read by NAME as well as counted: a strip holding one empty `<li>` satisfies a
    // count and says nothing about the conversation behind it.
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(1)
    expect(m.q('cast-tile-name-sess_child').textContent?.trim()).toBe('worker')
  })

  /**
   * ⚠️ **A read that did not answer keeps the cards it had, keeps its own moment, and says so ONCE
   * at that moment's anchor** — v2.8 §06, and `547` §3.3.
   *
   * ⛔ **Once is the assertion.** `answered` is one boolean over one round trip, so all three lists
   * are in doubt together; a band that said it per list would draw three blocks for one fact.
   */
  it('⚠️ a refused read keeps its cards and its timestamp, and says so ONCE at the read’s anchor', async () => {
    const m = await show({
      answered: false,
      read: answer({
        readAt: NOW - 600_000,
        children: walk([spawn()], 'every-conversation-this-one-spawned'),
        workGivenOut: walk([edge()], 'every-conversation-this-one-gave-work-to'),
        workTakenIn: walk([edge({ to: META.sessionId })], 'every-piece-of-work-this-one-was-given'),
      }),
    })
    // 🔴 **631 · what a refused read KEEPS is the strip and the two task lists** — the cards went,
    // the reading did not, so every surface the band still has is drawn from the last answer.
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(1)
    expect(m.q('cast-tile-name-sess_child').textContent?.trim()).toBe('worker')
    expect(given(m)).toHaveLength(1)
    expect(m.all('cast-taken-work')).toHaveLength(1)
    expect(m.all('cast-refusal')).toHaveLength(1)
    expect(m.q('cast-refusal').textContent).toContain('did not answer just now')
    // ⛔ **And not once per list** — three lists, one sentence. ⚠️ **Only the CHILD list's doubt is
    // asserted now**: `cast-given-doubt` and `cast-taken-doubt` are hooks `631` deleted with the two
    // work sections, and an absence asserted over markup nothing renders is a rail nothing reaches.
    // ⚑ `cast-children-doubt` is still drawn by this band, so this one can still fail.
    expect(m.all('cast-children-doubt')).toHaveLength(0)
    // ⚑ **The kept moment is the read's OWN**, not the moment of the refusal.
    expect(m.q('cast-age').textContent).toContain('10m ago')
    expect(m.all('cast-children-empty')).toHaveLength(0)
  })

  /**
   * 🔴 **A list that read NO rows because it could not read any of them.** ⛔ This is the state a
   * mutation walked through: `rows.length === 0` is true, and without the fourth condition on
   * {@link ListCoverage.count} the band draws *No conversations started* over a walk that refused
   * every row it had. ⚠️ `452` §5.1's forbidden sentence, reached from the other side.
   */
  it('🔴 a list that could not read ANY of its rows is not an empty list', async () => {
    const m = await show({
      read: answer({
        children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned', { rowsUnread: 3 }),
      }),
    })
    expect(m.all('cast-children-empty')).toHaveLength(0)
    expect(m.q('cast-children-short').textContent).toContain('3 rows could not be read')
    expect(m.q('working-together').textContent).not.toContain('No conversations started')
  })

  /**
   * ⛔ **And a refused read with no rows is not an empty list either** — the same sentence, reached
   * through the refusal rather than through an unread row.
   */
  it('⛔ a refused read holding no cards still never says No conversations started', async () => {
    const m = await show({ answered: false, read: answer() })
    expect(m.all('cast-children-empty')).toHaveLength(0)
    // 🔴 **The positive control, and `631` had emptied it.** ⛔ With `cast-refusal` unrendered this
    // band draws NOTHING in this state — no strip, no task list, no empty sentence, no age — so the
    // line above was passing over a blank `<section>` rather than over a withheld claim.
    // ⚑ Reading the refusal's own words is what makes the absence above a measurement.
    expect(m.q('cast-refusal').textContent).toContain('did not answer just now')
  })

  /** ⛔ **Nothing read at all** is not an empty band and not a spinner. */
  it('⛔ nothing read yet draws one line and no list treatment at all', async () => {
    const m = await show({ read: null })
    expect(m.q('cast-not-read').textContent).toContain('Nothing has been read')
    expect(m.all('cast-children-empty')).toHaveLength(0)
    expect(m.all('cast-children-doubt')).toHaveLength(0)
    expect(m.all('cast-root')).toHaveLength(0)
  })

  /**
   * With no parent, draw no parent row above the big avatar and no explanatory sentence. Pair
   * this with the same read carrying a parent, then assert the row appears. That positive
   * proves the row is withheld rather than never built. `WorkingTogetherView.parentEmpty`
   * retains the internal claim but no template reads it.
   */
  it('⚑ a conversation nothing spawned draws no parent row, and never the removed sentence', async () => {
    const m = await show({ read: answer() })
    expect(m.all('cast-parent-empty'), 'the band stopped drawing the sentence').toHaveLength(0)
    expect(m.q('working-together').textContent).not.toContain(NOBODY_IN_THIS_APP_SPAWNED_IT)
    expect(m.all('panel-came-from'), 'nothing spawned it, so no row is drawn').toHaveLength(0)
    m.unmount()

    // 🔴 **The control, trapped the way the subject is** — one field on the same read, mounted the
    // same way, and the row is there.
    const withParent = await show({
      identities: [identity('default', 'BroBot')],
      read: answer({ parent: spawn({ conversation: 'sess_parent', identity: 'default' }) }),
    })
    expect(withParent.q('came-from-name').textContent?.trim()).toBe('BroBot')
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · four children, no fact about where any of them is, and the press is a task row', () => {
  const four = (): WhoCalledWhom =>
    answer({
      children: walk(
        [
          spawn({ conversation: 'sess_recording', running: 'not-running' }),
          spawn({ conversation: 'sess_unwatched', running: 'unwatched' }),
          spawn({ conversation: 'sess_here', running: 'in-a-window' }),
          spawn({ conversation: 'sess_elsewhere', running: 'in-a-window' }),
        ],
        'every-conversation-this-one-spawned',
      ),
    })

  /**
   * ## ⛔ 631 · the state SENTENCE went with the child cards, and that half is GONE
   *
   * ⚠️ **No navigation state is drawn on this band.** A child is a plate and a name in
   * `cast-children-strip`.
   *
   * ⚑ **D-017b · and the fold carries none of the four either** since the Spawn path strip went
   * (`fe00a6a5`): *this app is not running it*, *not open in any window* and *open in this window* were process
   * facts (`05` rule 5), and *open in another window* had no reader left. ⛔ What is pinned is that
   * none of them is drawn — the third and the fourth share `running: 'in-a-window'`, and the band
   * says nothing that would tell them apart.
   */
  it('🔴 four children of one identity are four tiles; the band draws no state of any of them', async () => {
    const m = await show({ read: four(), press: [] })

    // ⚑ **Four conversations of ONE identity are four tiles** — §0's property at this fixture.
    expect(
      ['sess_recording', 'sess_unwatched', 'sess_here', 'sess_elsewhere'].map((conversation) =>
        m.q(`cast-tile-name-${conversation}`).textContent?.trim(),
      ),
      'the strip merged conversations that share an identity',
    ).toEqual(['worker', 'worker', 'worker', 'worker'])

    // ⛔ **The loss, asserted rather than assumed** — by hook AND by the words themselves, so a
    // state sentence re-added under another `data-cy` fails here too.
    expect(m.all('cast-card-state'), 'the band drew a state word again').toHaveLength(0)
    for (const word of [
      OPEN_IN_ANOTHER_WINDOW,
      'this app is not running it',
      'not open in any window',
      'open in this window',
    ])
      expect(m.q('working-together').textContent, `the band drew "${word}"`).not.toContain(word)
  })

  /**
   * ⛔ **`118`'s rule, twice.** *open in another window* has no press because this app has no verb
   * for it (`106`); *this app is not running it* has none because `543`'s read carries neither
   * `reopenRefusal` nor `hasTranscript` — **547 F2**.
   *
   * ## 🔴 631 · the per-card press went with the cards, and the RULE did not die with it
   *
   * Every offered press is a task row naming a conversation, independent of that
   * conversation’s navigation state. Assert the band’s actual population rather than the
   * removed `pressableAs` path.
   */
  it('⛔ every press opens the conversation it names — a task line and a chip alike', async () => {
    const opened: string[] = []
    const m = await show({
      press: opened,
      read: answer({
        children: four().children,
        workGivenOut: walk(
          [
            edge({ piece: 'work_watch', label: 'W1.1', to: 'sess_unwatched' }),
            edge({ piece: 'work_here', label: 'W1.2', to: 'sess_here' }),
          ],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })

    // ⛔ **Two tasks, each on its own recipient's card** — the card's press opens that recipient
    // (the forest's one press, on every card), and the piece names it (`540` §0's property, by
    // `data-conversation`).
    const lines: HTMLElement[] = []
    for (const conversation of ['sess_unwatched', 'sess_here'])
      lines.push(...piecesOn(kidIn(m, conversation)))
    expect(lines.map((el) => el.dataset.conversation)).toEqual(['sess_unwatched', 'sess_here'])
    expect(lines.map((el) => rowOf(el)?.querySelector('[data-cy="forest-open"]')?.tagName)).toEqual(
      ['BUTTON', 'BUTTON'],
    )

    // Each of the four chips opens its own conversation, whatever that conversation’s state.
    const strip = m.q('cast-children-strip')
    expect(agentRows(strip)).toHaveLength(4)
    for (const chip of strip.querySelectorAll<HTMLElement>('button')) chip.click()
    expect(opened).toEqual(['sess_recording', 'sess_unwatched', 'sess_here', 'sess_elsewhere'])

    // ⛔ **And the words of the old press are not on this band at all** — the one press's words are
    // the Graph's, which is where they are measured. ⚑ **D-017b** — *Take it over and open it* went
    // with the fork; *Open the conversation* is the one press's.
    const band = m.q('working-together').textContent ?? ''
    expect(band).not.toContain('Take it over and open it')
    expect(band).not.toContain(OPEN_THE_CONVERSATION)
  })

  /**
   * ⚑ **631 · the press is the task row now**, and the property is untouched: it NAMES a
   * conversation to the screen and performs nothing itself — rule 18, *an act is reported when it
   * is recorded*, and this surface records nothing.
   *
   * ⛔ **Both directions, because the two lists point opposite ways.** The strip's chip names the
   * conversation the work was given TO; a taken line names the one it came FROM, the only id that
   * row knows (`piece.from`).
   */
  it('⚑ the press names the conversation and does nothing itself', async () => {
    const pressed: string[] = []
    const m = await show({
      press: pressed,
      read: answer({
        children: four().children,
        workGivenOut: walk(
          [edge({ piece: 'work_out', label: 'W1.1', to: 'sess_unwatched' })],
          'every-conversation-this-one-gave-work-to',
        ),
        workTakenIn: walk(
          [edge({ piece: 'work_in', label: 'W2.7', from: 'sess_parent', to: META.sessionId })],
          'every-piece-of-work-this-one-was-given',
        ),
      }),
    })

    // The recipient’s chip opens its conversation; in the graph, its card provides the
    // corresponding press.
    m.q('cast-children-strip')
      .querySelector<HTMLButtonElement>('button[data-conversation="sess_unwatched"]')!
      .click()
    await nextTick()
    expect(pressed).toEqual(['sess_unwatched'])

    // ⛔ **Nothing moved** — the piece is where it was, on its recipient's card.
    expect(given(m).map((row) => row.dataset.conversation)).toEqual(['sess_unwatched'])
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(4)

    // ⚑ **The other direction names the GIVER**, which is the only id that row knows.
    m.q('cast-taken-work').click()
    await nextTick()
    expect(pressed).toEqual(['sess_unwatched', 'sess_parent'])
  })

  /**
   * 🔴 **Order a person reads, measured in PIXELS rather than in source order** — v2.8 §03's own
   * method, kept, over the order `631` actually ruled.
   *
   * ## ⛔ What died with the child cards, said plainly
   *
   * ⚠️ **There is no longer a press that changes ownership and a press that does not.** The card's
   * *Take it over* and *Open the conversation* went with the cards; ONE press is left — the task
   * row — and `506`'s door claims the conversation before it selects it, so that row IS the
   * ownership-changing press and has no *below* twin to be ordered against.
   *
   * Read the required ordering from engine boxes, catching a template that puts the strip
   * after tasks. `show()` mounts the whole `SessionDrawer`, so the `SessionPanel` parent row
   * above the avatar is measured too.
   */
  it('🔴 the order a person reads is the order 631 ruled, measured in pixels', async () => {
    const m = await show({
      press: [],
      read: answer({
        parent: spawn({ conversation: 'sess_parent', identity: 'default' }),
        children: four().children,
        workGivenOut: walk(
          [edge({ piece: 'work_out', label: 'W1.1', to: 'sess_unwatched' })],
          'every-conversation-this-one-gave-work-to',
        ),
        workTakenIn: walk(
          [edge({ piece: 'work_in', label: 'W2.7', from: 'sess_parent', to: META.sessionId })],
          'every-piece-of-work-this-one-was-given',
        ),
      }),
    })

    const top = (cy: string): number => m.q(cy).getBoundingClientRect().top

    // ⛔ **Where it CAME FROM is the way up, at the top of the panel** — UI-006 (F045), where 631
    // had put the row above the big avatar: never below the agent it is about.
    expect(top('panel-came-from'), 'the way up fell below the big avatar').toBeLessThan(
      m.q('session-bot').getBoundingClientRect().bottom,
    )
    // Draw the agent first, with its Current task beneath it.
    expect(top('session-bot'), 'what it was given rose above the big avatar').toBeLessThan(
      top('cast-taken-heading'),
    )
    expect(top('cast-taken-heading')).toBeLessThan(top('cast-taken'))
    // ⚑ **…and the children are immediately below it** — *"the children should be immediately
    // below the parent."*
    expect(top('session-bot'), 'the strip rose above the big avatar').toBeLessThan(
      top('cast-children-strip'),
    )
    // Each descendant’s graph card draws its plate before the work given to it. The forest
    // piece is one line beneath its holder’s plate.
    const line = given(m)[0]!
    const plate = rowOf(line)?.querySelector<HTMLElement>('[data-cy="agent-plate"]')
    expect(plate, 'the task line sits under no kid').toBeTruthy()
    expect(plate!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      line.getBoundingClientRect().top,
    )
  })

  /**
   * ⛔ **No caller, no control** — a drawer with no screen above it offers nothing (`118`).
   *
   * ## 🔴 631 · the one assertion in §3 that is a REGRESSION rather than a re-point
   *
   * ⚠️ **`WorkingTogether` still declares `canOpen` and no longer reads it.** The old per-card
   * press was drawn through `pressableAs(card, canOpen)`; the task row that replaced it is a
   * `<button>` under `v-if="view.tasks.length"` alone — so a band whose screen supplied no `goTo`
   * draws a control whose click reaches `cast.goTo.value?.(…)` and does nothing. ⛔ **That is the
   * shape `SessionPanel`'s own comment calls *the thing this codebase keeps deleting*.**
   *
   * 🔴 **Written to the RULE and not to the build**, and two prose claims say the rule is in force:
   * `TheCast.goTo`'s docblock — *"a band draws NO press while it is null"* — and `RuntimeScreen`'s
   * *"while this is null the band draws no press at all"*. ⚑ `TaskList` is the shape that honours
   * it: `<component :is="pressable(one) ? 'button' : 'span'">` under one class.
   */
  it('⛔ with nothing able to act, no press is drawn at all', async () => {
    const m = await show({
      read: answer({
        children: four().children,
        workGivenOut: walk(
          [edge({ piece: 'work_out', label: 'W1.1', to: 'sess_unwatched' })],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })

    // ⛔ **Nothing that opens a conversation anywhere in the band** — not a task row, not a chip (a
    // chip opens its conversation since 2026-09-30, so it is held to the rule).
    expect(
      [...m.q('working-together').querySelectorAll('button')],
      'the band drew a press with no screen above it to act on it',
    ).toEqual([])
    // …and the task and the children are still THERE, which makes this a narrowing and not a blank.
    expect(given(m)).toHaveLength(1)
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(4)
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · a spawn and a handoff are two edges', () => {
  /**
   * ⛔ **A recipient the spawn list does not name is still drawn**, and the band says nothing about
   * why it is there — never *was never spawned*, which this read cannot know.
   *
   * ## 🔴 631 · the GROUP is gone and the separation is not
   *
   * ⛔ **`cast-others` was a group of cards and there are no cards on this band.** ⚑ What keeps the
   * two edges apart now is the STRIP: it holds exactly what the spawn walk named, and a work row
   * may never put a conversation into it. ⚠️ The work itself is not lost — it is a line of its own
   * carrying the recipient's conversation on `data-conversation` and its own label, which is
   * `540` §0's property expressed directly instead of by nesting.
   *
   * ⛑ **What died with the markup is the WORDS, and it is named rather than dropped quietly.**
   * *sent work to · not listed as a child* was drawn by nothing here, and the fold no longer carries
   * it, so the band explains the relation no longer. 🔴 **The forbidden claim is still pinned**,
   * because that is the one sentence this read may never produce.
   */
  it('⛔ work to a conversation this one did not spawn is drawn without joining the children', async () => {
    const m = await show({
      identities: [identity('peer', 'Peer')],
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_child' })],
          'every-conversation-this-one-spawned',
        ),
        workGivenOut: walk(
          [
            edge({ piece: 'work_child', to: 'sess_child' }),
            edge({ piece: 'work_peer', label: 'W1.9', to: 'sess_peer', toIdentity: 'peer' }),
          ],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })

    // An agent outside the spawn walk gets its own strip chip after the children and is never
    // merged with one of them.
    const agents = agentRows(m.q('cast-children-strip'))
    expect(
      agents.map(
        (row) => row.querySelector<HTMLElement>('[data-cy^="cast-tile-name-"]')?.dataset.cy,
      ),
    ).toEqual(['cast-tile-name-sess_child', 'cast-tile-name-sess_peer'])
    expect(m.q('cast-tile-name-sess_peer').textContent?.trim()).toBe('Peer')

    // Both pieces are drawn under their respective recipients in the graph.
    for (const conversation of ['sess_child', 'sess_peer']) {
      const lines = [...piecesOn(kidIn(m, conversation))]
      expect(lines.map((el) => el.dataset.conversation)).toEqual([conversation])
      expect(rowOf(lines[0]!)?.dataset.conversation, `${conversation}’s work left its block`).toBe(
        conversation,
      )
    }
    // ⚑ **Told apart by the LABEL as well as by the attribute** — `540` §0, visible to a reader.
    expect(piecesOn(kidIn(m, 'sess_peer'))[0]?.textContent).toContain('W1.9')

    // ⛔ **The claim this read cannot make, still refused.**
    expect(m.q('working-together').textContent).not.toContain('was never spawned')
  })

  /**
   * ⚑ **A child with no work is still drawn**, because a spawn is an edge of its own.
   *
   * Spawned children are horizontal tiles. The spawn row determines membership, and the
   * conversation’s id names the element, `cast-tile-name-<conversation>`, rather than a
   * profile slug or task id.
   */
  it('⚑ a spawned conversation nothing was given is drawn anyway', async () => {
    const m = await show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_idle' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    expect(agentRows(m.q('cast-children-strip'))).toHaveLength(1)
    expect(m.q('cast-tile-name-sess_idle')).toBeTruthy()
    // ⛔ **…and no piece of work at all**, which is what makes this a SPAWN edge rather than a work
    // one: the strip drew it with nothing in `workGivenOut` to draw it from.
    expect(given(m)).toHaveLength(0)
  })

  /**
   * ⚠️ **A recipient built from a work row alone carries NO state**, because no session row was
   * read for it — v2.8's *"missing conversation detail can leave only its supplied reference"*.
   *
   * ## 🔴 631 · the card is gone and the refusal is not
   *
   * ⛔ **The recipient is named on the task LINE now**, and the only thing on that line that could
   * say what a conversation is doing is its plate. ⚑ So the doing read is PLANTED for `sess_peer`
   * and the line still draws `081`'s faceless mark: `recipientCard` holds no session row and
   * refuses to ask {@link WhatIsBeingDone} about one — *"this band answering a question the read
   * did not ask"*.
   *
   * ⚠️ **The control is the SAME conversation in the other role.** One spawn row is the whole
   * difference, and the identical reading then reaches the plate — so `unknown` above is a fact
   * about the card rather than about a fixture that planted nothing
   * ([[a-fixture-must-plant-what-the-subject-eats]]).
   *
   * ⛑ **`unknown` is never `idle`**, which is `632`'s three absences pinned at the row a work edge
   * builds — and the plate is `dot` sized, so the word is on `data-doing` rather than on a face.
   */
  it('⚠️ a non-child recipient is named and says nothing about what it is doing', async () => {
    const doing: WhatIsBeingDone = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_peer',
          identity: 'peer',
          told: { said: 'an-activity', phase: 'thinking', detail: null },
          status: 'working',
          streaming: false,
          since: NOW - 30_000,
          context: null,
        },
      ],
    }

    const only = await show({
      identities: [identity('peer', 'Peer')],
      atWork: doing,
      read: answer({
        workGivenOut: walk(
          [edge({ to: 'sess_peer', toIdentity: 'peer' })],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })
    const row = given(only)[0]!
    // ⚑ **Named, and named by `agentName` from the roster** — the supplied reference, drawn on its
    // chip on the strip, and its piece sits on its own card in the graph.
    expect(row.dataset.conversation).toBe('sess_peer')
    expect(only.q('cast-tile-name-sess_peer').textContent?.trim()).toBe('Peer')
    expect(rowOf(row)?.dataset.conversation).toBe('sess_peer')
    // ⛔ **And saying nothing about what it is doing, with the answer sitting in the reading** — on
    // its chip, the band's own face for it since the card under the strip went (2026-09-30).
    const chip = (m: Mounted, id: string) =>
      m
        .q('cast-children-strip')
        .querySelector<HTMLElement>(`[data-conversation="${id}"] [data-cy="agent-state"]`)
    expect(
      chip(only, 'sess_peer')?.dataset.doing,
      'a conversation no session row was read for wears a face',
    ).toBe('unknown')
    only.unmount()

    // 🔴 **The control** — one spawn row, the same reading, the same conversation.
    const spawned = await show({
      identities: [identity('peer', 'Peer')],
      atWork: doing,
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_peer', identity: 'peer' })],
          'every-conversation-this-one-spawned',
        ),
        workGivenOut: walk(
          [edge({ to: 'sess_peer', toIdentity: 'peer' })],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })
    expect(
      chip(spawned, 'sess_peer')?.dataset.doing,
      'the planted reading reaches no plate at all',
    ).toBe('thinking')
  })
})

/* ------------------------------------------------------------------ §5 */

describe('§5 · the status fold is lossy, and it is not silently so', () => {
  const withState = (state: WorkEdge['state'], over: Partial<WorkEdge> = {}) =>
    show({
      read: answer({
        children: walk([spawn()], 'every-conversation-this-one-spawned'),
        workGivenOut: walk([edge({ state, ...over })], 'every-conversation-this-one-gave-work-to'),
      }),
    })

  /**
   * 🔴 **v2.8 folds work to `open | answered` and this app has FIVE states, two of them closed.**
   * ⛔ Taken back is not answered, and a two-valued fold would print the second over the first.
   */
  it('🔴 work a parent took back never reads as answered', async () => {
    const m = await withState('withdrawn', { endedAt: NOW - 60_000 })
    const row = given(m)[0]!
    // ⚑ **2026-09-30 · the piece is read on its holder's card in the Graph tab's forest** — the
    // band's rows carried the raw `data-state` and went with the card under the strip; the fold's
    // lossy half is read off the mark's word and its glyph, which the forest's line carries.
    // 🔴 **631 · the state WORD moved out of the row's ink and onto the status mark**, which
    // carries it as its `aria-label` and its `title` — the template's own rule: *"a status told by
    // shape alone is a status for people who can separate shapes"*. ⚠️ **The word did not move,
    // the carrier did**, so this reads the mark rather than the row's text.
    const mark = row.querySelector<HTMLElement>('[data-cy="forest-task-mark"]')
    expect(mark, 'the row drew no status mark').not.toBeNull()
    expect(mark!.getAttribute('aria-label')).toBe('taken back')
    expect(mark!.title).toBe('taken back')
    // ⛔ **The CLOSED glyph**, so the half of the fold a person reads without hovering is pinned too.
    expect(mark!.textContent?.trim()).toBe('●')
    // ⛔ **And nothing on the row says *answered*** — neither the visible line nor the mark's word,
    // which are the only two places a two-valued fold could have printed it.
    expect(row.textContent).not.toContain('answered')
    expect(mark!.title).not.toContain('answered')
  })

  /** ⚑ **`stalled` is OPEN** — HO-018 §2.1's ruling, read off the table rather than re-derived. */
  it('⚑ work nothing is driving is still open, and says what it is', async () => {
    const m = await withState('stalled')
    const row = given(m)[0]!
    // 🔴 **631 · the word is on the status mark now** — see the row above's note.
    // ⛔ **`toBe` and not `toContain`**: *not being worked on* CONTAINS *being worked on*, so a
    // containment here would pass on the very state this one exists to tell apart.
    const mark = row.querySelector<HTMLElement>('[data-cy="forest-task-mark"]')
    expect(mark, 'the row drew no status mark').not.toBeNull()
    expect(mark!.getAttribute('aria-label')).toBe('not being worked on')
    // ⛔ **The OPEN glyph** — the only part of this a person reads without hovering.
    expect(mark!.textContent?.trim()).toBe('○')
  })

  /**
   * ⛔ **A reply is the only thing that closes work as answered.**
   *
   * The band’s task row shows id, agent, status icon, and truncated description, so `done`,
   * `blocked`, and `failed` currently look identical there. `work-report-outcome` remains
   * visible in the transcript and Work tab, asserted by `work-report.dom.test.ts`. This
   * records the current band without forbidding a future outcome display.
   *
   * ⛔ **What the band still owes a reader is the LIFECYCLE**: a reply closed it, and the word is
   * `answered` rather than any of the four open ones.
   */
  it('⛔ an answered piece of work reads as closed, and says the word', async () => {
    const m = await withState('answered', { outcome: 'done', endedAt: NOW - 30_000 })
    const row = given(m)[0]!
    const mark = row.querySelector<HTMLElement>('[data-cy="forest-task-mark"]')
    expect(mark, 'the row drew no status mark').not.toBeNull()
    expect(mark!.getAttribute('aria-label')).toBe('answered')
    expect(mark!.textContent?.trim()).toBe('●')
  })

  /**
   * ⛔ **Never inferred from a CONVERSATION's state.** A child this app is no longer running, with
   * work still open, leaves that work open — HO-018 §2's principle, on the surface.
   *
   * 🔴 **631 · the child's navigation WORD went with the cards, and the premise is RE-POINTED
   * rather than dropped.** ⛔ The hazard has to be on the path this code walks: a test that read
   * only the work row would pass over a child that was running perfectly well, which is the one
   * input this test exists for. ⚑ **The strip still says it** — the tile's plate is
   * `sessionFacets` over `running === 'not-running'`, so its BEING is `ended`, and that is the
   * band's whole remaining statement about a conversation this app is not running.
   */
  it('⛔ a child this app is not running leaves its unfinished work open', async () => {
    const m = await show({
      read: answer({
        children: walk([spawn({ running: 'not-running' })], 'every-conversation-this-one-spawned'),
        workGivenOut: walk(
          [edge({ state: 'working' })],
          'every-conversation-this-one-gave-work-to',
        ),
      }),
    })
    const plate = m
      .q('cast-tile-name-sess_child')
      .closest('li')!
      .querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(plate, 'the child drew no plate in the strip').not.toBeNull()
    // ⚑ **D-017b · doing nothing here, and no ring that says it stopped** (`05` rule 5): the plate
    // was drawn `ended`; it is `idle` with no being now, and the work is what says it is open.
    expect(plate!.dataset.doing).toBe('idle')
    expect(plate!.dataset.being).toBeUndefined()
    const row = given(m)[0]!
    // ⛔ **`toBe` and not `toContain`** — *not being worked on* contains this string, and those two
    // states are exactly what this test has to tell apart.
    const mark = row.querySelector<HTMLElement>('[data-cy="forest-task-mark"]')
    expect(mark, 'the row drew no status mark').not.toBeNull()
    expect(mark!.getAttribute('aria-label')).toBe('being worked on')
    expect(mark!.textContent?.trim()).toBe('○')
  })
})

/* ------------------------------------------------------------------ §6 */

/**
 * 🔴 **§6 is the standing `every-assertion-that-reads-clipped-text.test.ts` records for
 * `WorkingTogether.vue`.** ⛔ It is mounted through `SessionDrawer`, because a band measured
 * outside the column it ships in is a measurement of a box the app never draws — and the column is
 * `--drawer-w-narrow`, which `drawerFit` reaches before it floats the drawer.
 */
describe('§6 · measured ink at the narrowest column the drawer ever takes', () => {
  /**
   * ⚑ **The longest realistic card**, built from the longest thing each field can actually hold:
   * an identity display name at its own cap and a piece's title. (D-016 took the project slug off
   * the card, and the spawn reason off the spawn edge.)
   */
  const longest = (): WhoCalledWhom =>
    answer({
      parent: spawn({
        conversation: 'sess_parent',
        identity: 'default',
        running: 'in-a-window',
      }),
      children: walk(
        [
          spawn({
            conversation: 'sess_pm',
            identity: 'project-manager',
          }),
        ],
        'every-conversation-this-one-spawned',
      ),
      workGivenOut: walk(
        [
          edge({
            to: 'sess_pm',
            toIdentity: 'project-manager',
            label: 'W1.12',
            title:
              'read 540 and 543, draw the first picture of who called whom, and measure the ink',
          }),
        ],
        'every-conversation-this-one-gave-work-to',
      ),
    })

  const roster = [
    identity('default', 'BroBot'),
    identity('project-manager', 'Project manager for slice five'),
  ]

  /**
   * ⚑ **UI-004 · a rail row for every child `longest()` draws**, each with a long state word — whose
   * answer it waits on, named at length — so a chip's word is measured where it can be cut.
   */
  const LONG_WORDS = (): ReadonlyMap<string, RailSays> => {
    const waiting: AgentState = {
      is: 'waiting-on-an-answer',
      from: 'Bartholomew Maximilian Featherstonehaugh',
    }
    const row: RailSays = { facets: facetsOfState(waiting), word: agentStateWords(waiting) }
    return new Map(longest().children.rows.map((child) => [child.conversation, row] as const))
  }

  /**
   * 🔴 **320 px is where this is decided.** `drawerFit` yields 380 → 320 before it floats the
   * drawer, so 320 is the smallest box this band is ever laid out in — a fit at 380 would prove
   * nothing about the state a person reaches by narrowing the window.
   */
  it('🔴 at 320 px, every string is either drawn in full or recoverable from a title', async () => {
    // ⚑ Tall enough for the drawer's host AND the graph's below it — out of view is a cut.
    await page.viewport(1100, 1900)
    const m = await show({
      read: longest(),
      identities: roster,
      press: [],
      width: DRAWER_W_MIN,
      graphWidth: TRANSCRIPT_MIN,
      rail: LONG_WORDS(),
    })
    // ⛔ **Inter is a bundled `@font-face` and loads asynchronously** — a measurement taken before
    // it arrives is the fallback's metrics, which is `drawn.ts`' limit 7.
    await drawnReady()
    const band = m.q('working-together')
    // Assert the four specific hooks stretched by `longest()`: capped tile name, profile
    // slug, direction heading, and piece title. A count cannot identify which is missing
    // ([[a-number-can-survive-the-death-of-its-derivation]]). Sweep graph `TaskList` lines
    // and `GraphNode` names where they draw, at `TRANSCRIPT_MIN`; sweep the band at the end
    // of `AgentCard`, at the drawer floor.
    const carriers = [...sweep(band), ...sweep(m.graph.q('team-forest'))].filter(
      (c) => c.text.length > 0,
    )
    const hooks = carriers.map((c) => c.cy)
    for (const cy of [
      'cast-tile-name-sess_pm',
      // ⚑ **UI-004** — the chip's profile slug and its state word, under its name, stretched too.
      'cast-tile-profile-sess_pm',
      'cast-tile-word-sess_pm',
      'forest-name',
      'forest-task-number',
      'forest-task-said',
    ]) {
      expect(hooks, `the sweep did not read ${cy}`).toContain(cy)
    }

    expect(m.q('cast-sub-agents').querySelector('.title [title]')?.getAttribute('title')).toBe(
      'Started here',
    )
    const lost = carriers.filter((c) => c.cut !== null && !c.recovered)
    expect(lost.map(describeCarrier), 'ink a person cannot read and cannot recover').toEqual([])
  })

  /**
   * ⛔ **The positive control** — *nothing is lost* is only a measurement if this sensor can see a
   * loss on the same page. ⚑ The piece's title is deliberately longer than the column and
   * carries the whole of itself on its `title`, which is the shipped recoverable pattern (`526`).
   */
  it('⛔ …and the sensor does cut the longest line — the control, with its title beside it', async () => {
    await page.viewport(1100, 1900)
    const m = await show({
      read: longest(),
      identities: roster,
      width: DRAWER_W_MIN,
      graphWidth: TRANSCRIPT_MIN,
    })
    await drawnReady()
    // Use a control that is actually truncated: `cast-work-said` is a two-line clamp
    // (`-webkit-line-clamp: 2`, `--text-4xs`) where this fixture fits, so it cannot prove
    // recovery ([[a-positive-assertion-must-differ-from-the-default]]). The name in a 96px
    // `--tile` at `--text-sm` cannot fit and has its complete text in `title`. A piece’s
    // one-line title on its graph holder’s card similarly retains the full title in the
    // line’s own `title`.
    const title = given(m)[0]!.querySelector<HTMLElement>('[data-cy="forest-task-said"]')
    expect(title, 'the piece drew no title').not.toBeNull()
    assertClippedButTold(title!, 'the piece’s title on its holder’s card')
    // ⚑ And the things a person must be able to read at a glance are NOT cut.
    // ⛔ **`cast-relation`'s property, re-pointed once more** — the *Assigned by it* heading that said
    // which way the work went is gone, because a line beside its recipient's plate says it; ⚑ what
    // must stay legible is the label that names the piece.
    // 🔴 **`540` §0's carrier, and it must be legible to a PERSON.** ⛔ Nesting used to tell two
    // pieces to two conversations of one identity apart; the label beside `data-conversation` does
    // it now, and a label a reader cannot read cannot do half of that job.
    const label = given(m)[0]!.querySelector<HTMLElement>('.tnum')
    expect(label, 'the piece row drew no label').not.toBeNull()
    assertDrawn(label!, 'the piece label that tells two conversations of one identity apart')
    // ⛔ **`cast-root`'s property, re-pointed to `SessionPanel`** — the root line went at `631`
    // (*"there is also 'Ada this conversation' above the children"*) because the big avatar above
    // this band already says which conversation a person is in, by name. ⚑ `show()` mounts the
    // whole drawer, so that name is in this tree and this is the same assertion one element up.
    assertDrawn(m.q('session-bot-name'), 'the name of the conversation this panel is about')
  })

  /** ⚑ **The band does not push the column sideways**, at either width the drawer takes. */
  it('🔴 a short name keeps its whole self beside a long state, at 320 and at 380 — the state gives way under it', async () => {
    const ada = [identity('default', 'BroBot'), identity('project-manager', 'Ada')]
    for (const width of [DRAWER_W_MIN, DRAWER_W_MAX]) {
      await page.viewport(1100, 1900)
      const m = await show({
        read: longest(),
        identities: ada,
        press: [],
        width,
        rail: LONG_WORDS(),
      })
      await drawnReady()
      const name = m.q('cast-tile-name-sess_pm')
      expect(name.textContent?.trim()).toBe('Ada')
      assertDrawn(name, `the name at ${width}px`)
      // The state is on its own line under the name, cut at two lines, and whole on its title.
      const word = m.q('cast-tile-word-sess_pm')
      expect(word.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().bottom - 0.5,
      )
      expect(word.title).toBe(word.textContent?.trim())
      expect(word.title).toContain('Bartholomew Maximilian Featherstonehaugh')
      m.unmount()
    }
  })

  it('⚑ the band never overflows its column on x, at 320 or at 380 — and each chip’s words keep their lines', async () => {
    for (const width of [DRAWER_W_MIN, DRAWER_W_MAX]) {
      const m = await show({
        read: longest(),
        identities: roster,
        press: [],
        width,
        rail: LONG_WORDS(),
      })
      await drawnReady()
      const band = m.q('working-together')
      expect(
        band.scrollWidth,
        `the band overflows a ${width}px column by ${band.scrollWidth - band.clientWidth}px`,
      ).toBeLessThanOrEqual(band.clientWidth)
      // ⚑ **UI-004** — the profile one line, the word at most two, all of it inside its chip.
      const chips = [...band.querySelectorAll<HTMLElement>('.agent-chip')]
      expect(chips.length, 'no chip drawn').toBeGreaterThan(0)
      for (const chip of chips) {
        const id = chip.dataset.conversation
        const copy = chip.querySelector<HTMLElement>('.chip-copy')!
        expect(
          copy.getBoundingClientRect().right,
          `${id}'s words leave the chip`,
        ).toBeLessThanOrEqual(chip.getBoundingClientRect().right + 0.5)
        const line = parseFloat(getComputedStyle(copy.querySelector('.chip-name')!).lineHeight)
        const profile = chip.querySelector<HTMLElement>('.chip-profile')
        if (profile)
          expect(profile.getBoundingClientRect().height, `${id}'s profile`).toBeLessThan(line * 1.5)
        const word = chip.querySelector<HTMLElement>('.chip-word')
        expect(word, `${id} says no word`).not.toBeNull()
        expect(word!.getBoundingClientRect().height, `${id}'s word`).toBeLessThan(line * 2.6)
      }
      // ⚑ A row of chips is one height — a chip with more words does not stand taller than its row.
      const tops = new Map<number, number[]>()
      for (const chip of chips) {
        const box = chip.getBoundingClientRect()
        tops.set(Math.round(box.top), [...(tops.get(Math.round(box.top)) ?? []), box.height])
      }
      for (const heights of tops.values()) expect(new Set(heights).size).toBe(1)
      m.unmount()
    }
  })
})

/* ------------------------------------------------------------------ §7 */

describe('§7 · what the band deliberately does not say', () => {
  /**
   * 🔴 **547 F1 · the read carries `running` and not `status`**, and those answer different
   * questions — so a child this app IS running has no face at all. ⛔ Drawn as `081`'s faceless
   * plate rather than guessed at, and pinned here so the day `SpawnEdge` gains a status this test
   * is what says the surface may now say more.
   */
  it('🔴 a running child draws a faceless plate, because nothing on this read says what it is doing', async () => {
    const m = await show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_live', running: 'unwatched' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    // The child tile keeps `<AgentState v-bind="card.facets">` bound to the same fold. Anchor
    // its hook on the conversation id, so two conversations with one identity still have
    // distinct tile hooks.
    const tile = m.q('cast-tile-name-sess_live').closest<HTMLElement>('li')
    expect(tile, 'the strip drew no tile for sess_live').not.toBeNull()
    expect(tile!.querySelector('[data-cy="agent-unknown"]'), 'the plate has a face').not.toBeNull()
    expect(tile!.querySelector('[data-cy="agent-avatar"]')).toBeNull()
    // 🔴 **…and on the SAME sensor the test below reads**, because a pair that measures one state
    // through the element and the other through `data-doing` is a pair that never compares them.
    // ⛔ `632` shipped three distinct absences so `unknown` could not be read as `idle` a third
    // time (`HO-095` §5.1, `EXT-014` §5); this is the assertion that says they stayed distinct.
    const plate = tile!.querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(plate?.dataset.doing).toBe('unknown')
    expect(plate?.dataset.doing).not.toBe('idle')
  })

  /**
   * ⚑ **A conversation this app is not running IS given a face**, and it is the roster's own
   * derivation rather than a second one — `not-running` is the host's answer, never `status`.
   * ⚑ **D-017b** — the face is *idle* and wears no ring: it was drawn `ended`, a process fact.
   */
  // ⚑ D-016 · the title's *as the project room draws it* went with the project room.
  it('⚑ …and a conversation this app is not running is drawn idle', async () => {
    const m = await show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_done', running: 'not-running' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    // ⛔ **631 · the same re-point as the test above** — the card became a tile and the plate came
    // with it, bound to the same `card.facets`. ⚑ **Scoped to the TILE and never to the drawer**:
    // `SessionBot` and the `came-from` row draw `agent-state` too, and a bare `m.q` would hand back
    // whichever of the three is first in the document.
    const tile = m.q('cast-tile-name-sess_done').closest<HTMLElement>('li')
    expect(tile, 'the strip drew no tile for sess_done').not.toBeNull()
    const plate = tile!.querySelector<HTMLElement>('[data-cy="agent-state"]')
    // 🔴 **`idle` here is the HOST's `not-running`, and it is the ONE absence that may say idle.**
    // ⛔ The other two — a conversation in no `WhatIsBeingDone` at all, and one whose recorded
    // status `whatAPlateCanDraw` withholds — both draw `unknown`, which is the test above
    // ([[an-unenumerated-state-counts-as-success]]).
    expect(plate?.dataset.doing).toBe('idle')
    expect(plate?.dataset.being).toBeUndefined()
  })

  /**
   * ⛔ **`509`'s ruled field is nowhere on this band**, because its cadence is longer than the
   * silence window. ⚑ A card that says what a conversation IS without claiming whether it is still
   * alive is a complete card.
   */
  it('⛔ no liveness word of any shape reaches a card', async () => {
    const m = await show({
      read: answer({
        children: walk(
          [
            spawn({ running: 'unwatched' }),
            spawn({ conversation: 'sess_two', running: 'in-a-window' }),
          ],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    const text = m.q('working-together').textContent ?? ''
    for (const word of ['gone quiet', 'silent', 'live for']) {
      expect(text, `the band said “${word}” about a conversation it polls`).not.toContain(word)
    }
  })

  /**
   * 🔴 **One `readAt`, over one aggregate** — `540` MI-19's condition, which `543` met. ⛔ Absent
   * while the newest read answered, however old (W4.74, D-033: the band is read again on every move
   * of its work), so a band cannot look staler than it is; said for a reading kept after a refusal.
   */
  it('🔴 the age is one moment for all three lists, and absent while the read answered', async () => {
    const fresh = await show({ read: answer({ readAt: NOW - 600_000 }) })
    expect(fresh.all('cast-age')).toHaveLength(0)
    fresh.unmount()

    const old = await show({ answered: false, read: answer({ readAt: NOW - 600_000 }) })
    const line = old.q('cast-age').textContent ?? ''
    expect(line).toContain('10m ago')
    // ⚑ ONE age line, not one per list.
    expect(old.all('cast-age')).toHaveLength(1)
  })

  /** ⛔ **A read for another conversation is the same absence as no read at all.** */
  it('⛔ an answer about a different conversation draws nothing', async () => {
    const cast = useWhoCalledWhom()
    cast.reading.value = {
      conversation: 'sess_somebody_else',
      read: answer({ children: walk([spawn()], 'every-conversation-this-one-spawned') }),
      answered: true,
      atWork: null,
    }
    const m = mount(SessionDrawer as never, drawerProps(), { width: DRAWER_W_MIN, height: 900 })
    expect(m.q('cast-not-read')).toBeTruthy()
    expect(m.all('cast-card')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ §8 */

/**
 * 🔴 **577 · the band draws BELOW the pane's own answer, and hides nothing** (`EXT-010` §3.2).
 *
 * ⛔ **The PO, on this band: *"it is mostly explanation — two paragraphs about spawned
 * conversations, on a conversation with no children"*, with the remedy *"behind a disclosure, or
 * below"*.** ⚠️ **Measured in this engine at `--drawer-w-narrow` before the change: the band was
 * 330px tall and `session-panel-empty` — the one sentence the pane exists to say — began 551px
 * down.**
 *
 * ⚑ **`577` took *below* rather than the disclosure, and the reason is a completeness signal.**
 * `cast-covers` is `WALK_COVERS`' sentence, and `WorkingTogether.vue`'s own comment says it exists
 * *because the child list is the only one on this band that makes a positive empty claim*. 🔴 In
 * the one state that draws that claim — `answered`, `doubt === null`, `rowsUnread === 0` — every
 * other mark that could qualify it is absent **by construction**, so folding it would have left an
 * unqualified all-clear with its qualifier behind a press.
 *
 * ⛔ **So this block asserts BOTH halves: the order, and that nothing went behind anything.**
 *
 * ## The ordering remains measured after the layout changes
 *
 * ⚠️ **His words:** *"'No permissions, questions or proposals are on a card here' should be after
 * the list of agents avatars."* ⛔ **What changed is not the arithmetic — it is what the band IS.**
 * `577` measured a band that opened with two paragraphs about spawned conversations; since `631`
 * its first element is the row of child avatars a person came to the panel to read, and burying
 * those under a sentence about their absence inverts the ask.
 *
 * ⚑ **The 330px/551px measurement stands for the state it was taken in** and is kept above rather
 * than deleted, because it is the cost of this ordering and somebody should be able to find it.
 * ⛔ **What it does NOT cost is an unanswered card being pushed down**: `session-panel-empty` draws
 * only when `bare`, and `bare` is false whenever any section above it has a row — so a permission,
 * a question or a proposal still comes first, which is the half of `577` that was never about
 * ordering the empty state.
 */
describe('§8 · the pane draws no empty answer, and every word of the band is on screen', () => {
  it('⛔ the empty paragraph is gone, and the band follows the top agent', async () => {
    const m = await show({ read: answer({ readAt: NOW - 600_000 }) })
    // The empty “No permissions, questions or proposals are on a card here” section is
    // absent.
    expect(m.all('session-panel-empty')).toEqual([])
    expect(m.host.textContent).not.toContain('are on a card here')
    const band = m.q('working-together')
    expect(band.checkVisibility()).toBe(true)
    expect(m.q('session-bot').getBoundingClientRect().top).toBeLessThan(
      band.getBoundingClientRect().top,
    )
  })

  it('\u26a1 \u2026and nothing the band says is behind a press', async () => {
    const m = await show({ read: answer({ readAt: NOW - 600_000 }) })
    // ⛔ **No disclosure was introduced**, which is the decision this dispatch made rather than an
    // omission — see the describe above. ⚠️ Asserted as an absence AND paired with the reading of
    // every sentence that would have gone behind one.
    expect(m.all('cast-why')).toHaveLength(0)
    expect(m.q('cast-children-empty').checkVisibility()).toBe(true)
    expect(m.q('cast-children-empty').textContent).toContain('No conversations started')
    expect(m.q('cast-children-empty').textContent).toContain(
      'Conversations this agent starts appear here.',
    )
    // ⚑ W4.74 · an answered band says no age, however old: it is read again on every move of its
    // work (D-033). The age line, kept after a refusal, is drawn in the open — see the age test.
    expect(m.all('cast-age')).toHaveLength(0)
    // `cast-covers` and `cast-parent-empty` are absent from the whole mounted drawer. Keep
    // inverted assertions so neither explanation can reappear inside a disclosure elsewhere;
    // a sentence absent from the tree cannot be hidden behind a press.
    expect(m.all('cast-covers'), 'the coverage paragraph came back').toHaveLength(0)
    expect(m.all('cast-parent-empty'), 'the parent sentence came back').toHaveLength(0)
    expect(m.host.textContent).not.toContain(NOBODY_IN_THIS_APP_SPAWNED_IT)
    expect(m.host.textContent).not.toContain('recorded as having been spawned by this one')
  })
})

/* ------------------------------------------------------------------ §9 */

/*
 * The right panel shows only the current agent’s card. Its graph shows the immediate parent
 * and children; a child’s own children are one press away on that child’s graph.
 */
