import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { forestView, type ForestView } from '../../src/renderer/src/lib/the-forest'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible } from './harness'

/**
 * # 🔴 641 · the forest, from the person down — drawn
 *
 * ⛔ **In the DOM project because every claim here is about PIXELS or INK.** ⚑ `606`'s rule, which
 * `631`'s own suite states: *"the ORDER a person reads — measured in pixels rather than in the
 * source, because a `v-if` could reorder them without moving a line."* ⚠️ And a `textContent`
 * assertion cannot tell a drawn string from a clipped one.
 *
 * ## ⚑ What the fold already pins, and is not repeated here
 *
 * ⛔ **`the-forest-a-person-reads.test.ts` owns the JOIN, the four must-nots and the coverage
 * arithmetic** — 21 tests. 🔴 **This file owns what a person SEES**: the order, where a child
 * sits (under its parent since `668`, which replaced `641`'s indent), the person at the top, and the
 * four sentences about what was left out.
 */

const NOW = 1_800_000_000_000

const conversation = (over: Record<string, unknown> = {}): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: 'sess_a',
    under: { is: 'the-person' },
    identity: 'worker',
    provider: 'claude',
    status: 'idle',
    running: 'unwatched',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  }) as ForestNode

const task = (over: Record<string, unknown> = {}): ForestNode =>
  ({
    node: 'a-task',
    under: { is: 'a-conversation', conversation: 'sess_a' },
    givenBy: { is: 'a-conversation', conversation: 'sess_a' },
    work: {
      piece: 'work_1',
      label: 'W1.1',
      title: 'write the world clock page',
      from: 'sess_a',
      fromIdentity: 'worker',
      to: 'sess_a',
      toIdentity: 'worker',
      state: 'working',
      givenAt: NOW - 30_000,
      endedAt: null,
      ...(over.work as Record<string, unknown> | undefined),
    },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'work')),
  }) as ForestNode

const forestOf = (
  rows: readonly ForestNode[],
  over: Record<string, unknown> = {},
): TheWholeForest =>
  ({
    readAt: NOW,
    nodes: {
      rows,
      walk: 'every-conversation-this-app-placed',
      ledgers: rows.filter((r) => r.node === 'a-conversation').length,
      rowsUnread: 0,
    },
    conversations: rows.filter((r) => r.node === 'a-conversation').length,
    heldByNoAgent: 0,
    ...over,
  }) as TheWholeForest

const viewOf = (
  rows: readonly ForestNode[],
  over: Record<string, unknown> = {},
  atWork: WhatIsBeingDone | null = null,
): ForestView =>
  forestView({
    forest: forestOf(rows, over),
    atWork,
    waits: null,
    identities: null,
    held: new Set<string>(),
  })!

/**
 * ⚑ **The forest, drawn and settled** — Vue Flow draws its cards a frame after the mount (2026-09-30:
 * the forest is on Vue Flow now), so a query waits for that frame rather than finding nothing.
 */
async function draw(view: ForestView | null, width = 1200, current?: string) {
  const m = mount(TeamForest, { view, ...(current ? { current } : {}) }, { width, height: 900 })
  await nextTick()
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  await nextTick()
  return m
}

afterEach(unmountAll)

describe('§0 · the person is at the top, and he is not an agent', () => {
  /**
   * ⛔ **`641` §4.1: *"The root is the PERSON and he is not a conversation … do not invent a fake
   * root node."*** ⚠️ **So he must NOT wear a plate**: this app has no name for him, no `doing` and
   * no conversation, and a plate drawn for him would be the one thing on the page that looks like
   * an agent and is not — which is the defect `631` §3 found on the dotted circle.
   */
  it('🔴 the person is drawn above every row, and wears no plate', async () => {
    const m = await draw(viewOf([conversation()]))
    const person = m.q('forest-person')
    expect(visible(person)).toBe(true)
    // ⛔ **No plate anywhere inside him** — the assertion that keeps him a person.
    expect(person.querySelector('[data-cy="agent-state"]'), 'the person wears a plate').toBeNull()
    // ⚑ **Above the rows, in PIXELS** — source order could not make this claim.
    expect(person.getBoundingClientRect().top).toBeLessThan(
      m.q('forest-rows').getBoundingClientRect().top,
    )
  })
})

describe('§1 · the order a person reads, and where a child sits', () => {
  /**
   * Place the person at the top, then all BroBot conversations, followed by their successive
   * generations of children.
   */
  it('🔴 a child is drawn BELOW its parent and UNDER it, both measured', async () => {
    const m = await draw(
      viewOf([
        conversation({ conversation: 'sess_root' }),
        conversation({
          conversation: 'sess_kid',
          under: { is: 'a-conversation', conversation: 'sess_root' },
        }),
      ]),
    )
    const root = m.q('forest-row-sess_root').getBoundingClientRect()
    const kid = m.q('forest-row-sess_kid').getBoundingClientRect()
    // ⛔ **Below**, and in pixels rather than in the source — the whole of its parent's card above it.
    expect(kid.top).toBeGreaterThanOrEqual(root.bottom)
    // An only child is centered beneath its parent in the generations layout.
    // `who-called-whom-as-generations.dom.test.ts` covers the remaining layout rules.
    const centre = (r: DOMRect): number => r.left + r.width / 2
    expect(Math.abs(centre(kid) - centre(root))).toBeLessThan(1)
  })

  /**
   * ⚠️ **A piece hangs under the conversation that HOLDS it**, which is what makes the tree total —
   * `641` §1.1: *"`under` (the HOLDER, always drawn)"*.
   */
  it('⚑ a piece is drawn under its holder, deeper than it, with its label and its mark', async () => {
    const m = await draw(viewOf([conversation(), task()]))
    const row = m.q('forest-row-work_1')
    expect(row.dataset.kind).toBe('a-task')
    expect(row.dataset.depth).toBe('1')
    expect(m.q('forest-task-number').textContent?.trim()).toBe('W1.1')
    // ⚑ **The mark says its word**, because a status told by shape alone is a status for people
    // who can separate shapes — `631`'s own rule, reused.
    expect(m.q('forest-task-mark').getAttribute('aria-label')).toBeTruthy()
  })

  /**
   * ⛔ **A deep chain is still readable, and each node still says how deep it really is.** ⚠️ `641`
   * wrote this about a CAPPED indent; `668`'s generations have no indent to cap — each level is a row
   * of its own — and the claim that survives is the one a person needs: the deepest name is drawn.
   */
  it('⛔ a very deep row is still readable, and still says how deep it really is', async () => {
    const deep = Array.from({ length: 14 }, (_, i) =>
      conversation({
        conversation: `sess_${i}`,
        under:
          i === 0 ? { is: 'the-person' } : { is: 'a-conversation', conversation: `sess_${i - 1}` },
      }),
    )
    // ⚑ **Since the forest is a canvas (2026-09-30), a chain fourteen deep does not fit the box at a
    // readable zoom** — the view centres on the conversation a person is in, which is how the Graph
    // tab draws it; the deepest row is the one asked for here.
    const m = await draw(viewOf(deep), 1200, 'sess_13')
    // ⛔ **The sensor refuses until Inter is really loaded**, because every width would otherwise
    // be the fallback font's — `drawn.ts`'s own guard, and it is why this test is async.
    await drawnReady()
    const last = m.q('forest-row-sess_13')
    expect(last.dataset.depth, 'the row forgot its real depth').toBe('13')
    const name = last.querySelector<HTMLElement>('[data-cy="forest-name"]')!
    // ⚑ The name is `ForestCard`'s, the card Vue Flow draws as each node.
    // 🔴 **Drawn in FULL, measured with the ink sensor** — `530` F1: *"`textContent` is identical
    // whether a browser drew a string or clipped it"*, and every level spends `--space-6` of the
    // column this name is drawn in — ⚑ `641`'s reason; since `668` a card is one slot wide at every
    // depth, and the name is still the string worth proving drawn.
    assertDrawn(name, 'the deepest row’s name', m.q('team-forest'))
  })

  /**
   * ⛔ **…and the sensor really does CUT, which is the control the assertion above needs.**
   * ⚠️ A sensor that never reports a cut would pass over a column of nothing
   * ([[a-control-must-be-trapped-the-way-the-subject-is]]).
   * ⚑ **The piece's title line is the one paired with a `title`** — `530`'s shipped pattern, and the
   * row carries the WHOLE title there (D-016: the title replaced the request text).
   */
  it('⛔ a long title is cut and recoverable from the row’s own title', async () => {
    const m = await draw(
      viewOf([
        conversation(),
        task({
          work: {
            title:
              'write the world clock page and then the tests beneath it, then read back what the ' +
              'provider said about each one and report which of them a person still has to answer',
          },
        }),
      ]),
      420,
    )
    await drawnReady()
    assertClippedButTold(m.q('forest-task-said'), 'the title', m.q('team-forest'))
  })
})

describe('§2 · what this reading left out, said rather than swallowed', () => {
  /**
   * A large tree must disclose omissions rather than silently appear complete. The
   * completeness explanation is useful here even though the conversation band omits it.
   */
  it('⛔ the bound, the unread rows and the excluded population are all on screen', async () => {
    const m = await draw(
      viewOf([conversation()], {
        conversations: 900,
        heldByNoAgent: 2_027,
        nodes: {
          rows: [conversation()],
          walk: 'every-conversation-this-app-placed',
          ledgers: 500,
          rowsUnread: 3,
        },
      }),
    )
    expect(visible(m.q('forest-cut'))).toBe(true)
    expect(m.q('forest-cut').textContent).toContain('400')
    expect(m.q('forest-rows-unread').textContent).toContain('3')
    expect(m.q('forest-outside').textContent).toContain('2027')
    expect(m.q('forest-drawn').textContent).toContain('500')
  })

  /**
   * ⛔ **A walk that did not look draws the DOUBT and never a count** — the four-condition gate,
   * and the reason `there === drawn` may not be read alone
   * ([[a-comparison-tested-where-both-sides-agree]]).
   */
  it('🔴 a read that could not look says so, and draws no count at all', async () => {
    const m = await draw(
      viewOf([], {
        conversations: 0,
        nodes: { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 },
      }),
    )
    expect(visible(m.q('forest-not-walked'))).toBe(true)
    expect(m.all('forest-drawn'), 'a count was drawn over a walk that never looked').toHaveLength(0)
  })

  /** ⚑ **Nothing read yet** is one line, and it is not an empty tree — `641` §5.5. */
  it('⚠️ no reading draws one line, and never the empty sentence', async () => {
    const m = await draw(null)
    expect(visible(m.q('forest-not-read'))).toBe(true)
    expect(m.all('forest-empty')).toHaveLength(0)
    expect(m.all('forest-rows')).toHaveLength(0)
  })

  /** ⛔ **…and a read that ANSWERED with nothing is the other sentence**, which is the pair. */
  it('⛔ an answered read with no conversations says THAT instead', async () => {
    const m = await draw(viewOf([]))
    expect(visible(m.q('forest-empty'))).toBe(true)
    expect(m.all('forest-not-read')).toHaveLength(0)
  })
})

describe('§3 · a named absence is never a missing parent', () => {
  /**
   * 🔴 **`641` §1.1: *"Draw a giver you did not draw as a named absence, not as a missing
   * parent."*** ⚑ Both halves, because `637` §5's fourth must-not covers both.
   */
  it('⛔ a parent the bound cut is SAID, on a row drawn at the root', async () => {
    const m = await draw(
      viewOf([
        conversation({
          conversation: 'sess_child',
          under: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_gone' },
        }),
      ]),
    )
    expect(visible(m.q('forest-parent-not-drawn'))).toBe(true)
    expect(m.q('forest-row-sess_child').dataset.depth).toBe('0')
  })

  it('⛔ …and a giver the bound cut is said on the piece itself', async () => {
    const m = await draw(
      viewOf([
        conversation(),
        task({
          givenBy: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_pm' },
        }),
      ]),
    )
    expect(visible(m.q('forest-giver-not-drawn'))).toBe(true)
  })

  /** ⚑ **The control**: nothing is said when nothing is absent. */
  it('⚑ a tree with every parent drawn says nothing about absences', async () => {
    const m = await draw(viewOf([conversation(), task()]))
    expect(m.all('forest-parent-not-drawn')).toHaveLength(0)
    expect(m.all('forest-giver-not-drawn')).toHaveLength(0)
  })
})

describe('§4 · the plate, and the one word it cannot carry', () => {
  /**
   * ⛔ **`641` §4.2: *"`unknown` must never render as `idle`."*** ⚑ `632` shipped three distinct
   * absences so it could not happen a third time.
   */
  it('🔴 a conversation no live reading names draws unknown, never idle', async () => {
    const m = await draw(viewOf([conversation()]))
    const plate = m.q('forest-row-sess_a').querySelector<HTMLElement>('[data-cy="agent-state"]')!
    expect(plate.dataset.doing).toBe('unknown')
    expect(plate.dataset.doing).not.toBe('idle')
  })

  /**
   * ⚑ **The control on the same fixture one fact over** — a conversation the live reading DOES name
   * wears its real state, so the green above is the absence and not the plate defaulting.
   */
  it('⚑ …and one the reading DOES name wears what it is doing', async () => {
    const atWork = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_a',
          identity: 'Worker',
          told: { said: 'an-activity', phase: 'thinking', detail: null },
          status: 'working',
          streaming: false,
          since: NOW - 5_000,
        },
      ],
    } as unknown as WhatIsBeingDone
    const m = await draw(viewOf([conversation()], {}, atWork))
    const plate = m.q('forest-row-sess_a').querySelector<HTMLElement>('[data-cy="agent-state"]')!
    expect(plate.dataset.doing).toBe('thinking')
  })

  /**
   * 🔴 **The ROW says the standing, and after `645` that is a RULE rather than a stopgap.**
   *
   * ⛔ This was written while `AgentState.vue` could not receive `636`'s facet. ⚑ It can now — the
   * prop is declared and the accessible name says the wait — and this assertion is kept and
   * re-aimed, because a plate never DRAWS a wait (`645`) and this word is the one place the forest
   * says it to the eye; since `668` the task lines on the card below carry no dot either.
   * ⚠️ `AgentState.vue`'s `waiting` docblock rests on the word being here, so this failing is that
   * ruling coming undone.
   */
  it('⛔ the standing is drawn as a word beside the plate', async () => {
    const m = await draw(viewOf([conversation()]))
    expect(visible(m.q('forest-says'))).toBe(true)
    expect(m.q('forest-says').textContent?.trim().length).toBeGreaterThan(0)
  })
})
