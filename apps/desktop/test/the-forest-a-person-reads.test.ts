import { describe, expect, it } from 'vitest'
import { forestView, type ForestViewInput } from '../src/renderer/src/lib/the-forest'
import { MAX_FOREST_CONVERSATIONS } from '../src/shared/the-whole-forest'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'
import type { WhatIsBeingDone } from '../src/shared/what-is-being-done'
import type { WhatEachConversationIsWaitingOn } from '../src/shared/tasks'
import type { AgentIdentity } from '../src/shared/runtime-ipc'

/**
 * # 🔴 641 · the forest a person reads
 *
 * ⛔ **`637` built the READ and nothing drew it.** ⚑ This is the fold between them, and every §
 * below is one of `637` §5's must-nots or one of `641` §5's done-rows.
 *
 * ## ⚠️ Why the JOIN gets its own section and its own planted spelling
 *
 * 🔴 **`637` F1: *"A person who first launches an identity as `Dev` gets `slug = 'dev'` and a slot
 * holding `'Dev'`."*** ⛔ **A fold that joined on `identity` would be right on every agent whose two
 * spellings match** — which is nearly all of them — **and silently wrong on the one that does not.**
 * ⚑ §1 plants exactly that disagreement, so the wrong join cannot pass.
 */

const NOW = 1_800_000_000_000

const identity = (slug: string, displayName: string | null = null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as never

const conversation = (
  over: Partial<Extract<ForestNode, { node: 'a-conversation' }>> = {},
): ForestNode =>
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
      title: 'write the page and the tests under it',
      from: 'sess_a',
      fromIdentity: 'worker',
      to: 'sess_a',
      toIdentity: 'worker',
      state: 'working',
      givenAt: NOW - 30_000,
      endedAt: null,
      ...(over.work as Record<string, unknown> | undefined),
    },
    // ⛔ **`work` is stripped from the outer spread**, because it was merged into the object above
    // and a second spread of the same key REPLACES it — the fixture would then hand the fold a
    // `WorkEdge` with three fields and no `label`
    // ([[dont-build-a-fixture-with-the-helper-under-test]] one aisle over: a fixture must not undo
    // its own merge).
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'work')),
  }) as ForestNode

const forest = (rows: readonly ForestNode[], over: Partial<TheWholeForest> = {}): TheWholeForest =>
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

const show = (over: Partial<ForestViewInput> = {}) =>
  forestView({
    forest: forest([conversation()]),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set<string>(),
    ...over,
  })

/* ------------------------------------------------------------------ §0 */

describe('§0 · `null` is a read that did not answer, and it is not an empty tree', () => {
  /**
   * ⛔ **`641` §5.5** and `session-store.ts`'s own docblock: `theWholeForest()` answers `null` for
   * *the read did not answer* and NEVER for a forest with no nodes.
   */
  it('🔴 no reading at all folds to null — never to a view with no rows', () => {
    expect(show({ forest: null })).toBeNull()
  })

  /**
   * ⚑ **The paired positive, and it is the distinction the whole § exists for.** A read that
   * ANSWERED and found nothing is a VIEW — with no rows and a coverage that says why.
   */
  it('⛔ …and a read that answered with nothing is a view, with a coverage that says so', () => {
    const empty = show({ forest: forest([]) })
    expect(empty, 'an answered read folded to null').not.toBeNull()
    expect(empty!.rows).toHaveLength(0)
    expect(empty!.coverage.walked).toBe(true)
    expect(empty!.coverage.there).toBe(0)
  })

  /**
   * 🔴 **A walk this build cannot spell fails CLOSED**, and `walked` is false for it — so nothing
   * downstream may draw a count over it ([[an-unenumerated-state-counts-as-success]]).
   */
  it('⚠️ a walk that is not the one that looks is never counted as a complete read', () => {
    const v = show({
      forest: forest([conversation()], {
        nodes: { rows: [conversation()], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 },
      } as never),
    })
    expect(v!.coverage.walked, '`no-ledger` was taken for a real walk').toBe(false)
  })
})

/* ------------------------------------------------------------------ §1 */

describe('§1 · 637 F1 — the join is `conversation`, and `identity` is a trap', () => {
  /**
   * 🔴 **THE test this file exists for.** ⛔ The forest's identity is the FOLDED slug (`dev`); the
   * live reading's is the launcher's RAW spelling (`Dev`). ⚑ **A fold that joined on `identity`
   * would find nothing and draw `unknown`** — which looks exactly like a conversation nothing has
   * arrived from, and is why `637` calls it silent.
   */
  it('🔴 a conversation whose two spellings DISAGREE still gets its live state', () => {
    const atWork: WhatIsBeingDone = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_a',
          // ⛔ **`Dev`, where the forest row says `dev`** — `637` F1's measured case, planted.
          identity: 'Dev',
          told: { said: 'an-activity', phase: 'thinking', detail: null },
          status: 'working',
          streaming: false,
          since: NOW - 5_000,
        },
      ],
    } as never
    const v = show({
      forest: forest([conversation({ identity: 'dev' })]),
      atWork,
    })
    const row = v!.rows[0]!
    expect(row.facets.doing, 'the join missed — this is what `identity` would give').toBe(
      'thinking',
    )
    expect(row.facets.doing).not.toBe('unknown')
  })

  /**
   * ⚑ **The control, on the same fixture one fact over** — a conversation the live reading does
   * NOT name draws `unknown`, so the green above is the join working and not the plate defaulting.
   */
  it('⛔ …and a conversation no live reading names draws `unknown`, never `idle`', () => {
    const atWork: WhatIsBeingDone = { readAt: NOW, conversations: [] } as never
    const v = show({ forest: forest([conversation({ identity: 'dev' })]), atWork })
    expect(v!.rows[0]!.facets.doing).toBe('unknown')
    // 🔴 **`632` shipped three distinct absences so this could not happen a third time.**
    expect(v!.rows[0]!.facets.doing).not.toBe('idle')
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · 637 §5 — the three moments, and the two `is` tests', () => {
  /**
   * ⛔ **`637` §5's third must-not:** *"Never draw an age from `TheWholeForest.readAt` beside a
   * doing word. Draw `WhatIsBeingDone.readAt` there — it is the one that moves in seconds."*
   * ⚑ Two fields, because they are two claims.
   */
  it('⚠️ the forest moment and the live moment are separate fields', () => {
    const atWork: WhatIsBeingDone = { readAt: NOW + 9_000, conversations: [] } as never
    const v = show({ forest: forest([conversation()], { readAt: NOW }), atWork })
    expect(v!.asOf).toBe(NOW)
    expect(v!.doingAsOf).toBe(NOW + 9_000)
    expect(v!.doingAsOf, 'the two moments were merged').not.toBe(v!.asOf)
  })

  /** ⚑ …and with no live reading there is no live moment to draw. */
  it('⛔ no live reading ⇒ no live moment, rather than the forest’s borrowed', () => {
    expect(show()!.doingAsOf).toBeNull()
  })

  /**
   * 🔴 **`637` §5's fourth must-not:** *"Never use `spawnedAt !== null` as *my parent is in this
   * reading*."* ⚑ D-016 took `spawnedAt` off the node, so the must-not now holds by construction;
   * what is left to plant is a parent the bound cut, and the node must still say so.
   */
  it('🔴 a node whose parent the bound CUT is a root that says so — `under` alone decides', () => {
    const orphan = conversation({
      conversation: 'sess_child',
      under: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_gone' },
    })
    const v = show({ forest: forest([orphan]) })
    expect(v!.rows).toHaveLength(1)
    expect(v!.rows[0]!.depth, 'it was not drawn as a root').toBe(0)
    expect(v!.rows[0]!.conversationRow!.parentNotDrawn).toBe('sess_gone')
  })

  /**
   * ⛔ **The same must-not, the handoff half:** *"check `givenBy.is`, never `work.from` alone."*
   * ⚑ A giver outside the reading is a NAMED ABSENCE, which is `641` §1.1's whole reason a task is
   * its own node kind.
   */
  it('⛔ a task whose GIVER this reading did not draw names it rather than losing it', () => {
    const v = show({
      forest: forest([
        conversation(),
        task({
          givenBy: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_pm' },
          work: { from: 'sess_pm', fromIdentity: 'pm' },
        }),
      ]),
    })
    const row = v!.rows.find((r) => r.kind === 'a-task')!
    expect(row.taskRow!.giverNotDrawn).toBe('sess_pm')
  })

  /** ⚑ **The control**: a giver this reading DID draw is not reported as absent. */
  it('⚑ …and a giver that IS drawn reports no absence at all', () => {
    const v = show({ forest: forest([conversation(), task()]) })
    const row = v!.rows.find((r) => r.kind === 'a-task')!
    expect(row.taskRow!.giverNotDrawn).toBeNull()
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · the shape the person asked for — person, then conversations, then children, then tasks', () => {
  /**
   * ⚑ **His words:** *"we see the user at the top, followed by all brobot conversations right
   * after, and each brobot converation with its own children etc."*
   * ⛔ **Depth is the generation (the indent until `668`) and the ORDER is pre-order**, so a row's
   * parent is always the nearest row above it with a smaller depth.
   */
  it('🔴 a child hangs under its parent, at one more depth, immediately after it', () => {
    const v = show({
      forest: forest([
        conversation({ conversation: 'sess_root' }),
        conversation({
          conversation: 'sess_kid',
          under: { is: 'a-conversation', conversation: 'sess_root' },
        }),
      ]),
    })
    expect(v!.rows.map((r) => [r.conversation, r.depth])).toEqual([
      ['sess_root', 0],
      ['sess_kid', 1],
    ])
  })

  /**
   * 🔴 **The walk is HETEROGENEOUS and `updated_at DESC` — a child can arrive BEFORE its parent.**
   * ⛔ A one-pass fold would have made the child a root. ⚑ Two passes, and this is the trap.
   */
  it('⛔ …even when the child arrives FIRST in the walk', () => {
    const v = show({
      forest: forest([
        conversation({
          conversation: 'sess_kid',
          under: { is: 'a-conversation', conversation: 'sess_root' },
        }),
        conversation({ conversation: 'sess_root' }),
      ]),
    })
    expect(v!.rows.map((r) => [r.conversation, r.depth])).toEqual([
      ['sess_root', 0],
      ['sess_kid', 1],
    ])
  })

  /** ⚑ **A task hangs under its HOLDER**, one deeper, and is a leaf. */
  it('⚑ a task is a row under the conversation that HOLDS it', () => {
    const v = show({ forest: forest([conversation(), task()]) })
    expect(v!.rows.map((r) => [r.kind, r.depth])).toEqual([
      ['a-conversation', 0],
      ['a-task', 1],
    ])
    expect(v!.rows[1]!.taskRow!.reading.heading).toBe('W1.1')
  })

  /**
   * ⚠️ **A chain deeper than a recursive component would survive.** ⛔ `MAX_FOREST_CONVERSATIONS`
   * is the bound and a chain may reach it, so the fold is iterative over a queue rather than a
   * recursion a person's own data could overflow.
   */
  it('⛔ a chain as deep as the bound allows is drawn to its end', () => {
    const deep = Array.from({ length: 60 }, (_, i) =>
      conversation({
        conversation: `sess_${i}`,
        under:
          i === 0 ? { is: 'the-person' } : { is: 'a-conversation', conversation: `sess_${i - 1}` },
      }),
    )
    const v = show({ forest: forest(deep) })
    expect(v!.rows).toHaveLength(60)
    expect(v!.rows.at(-1)!.depth, 'the chain was cut short').toBe(59)
    // ⚑ The bound is the READ's and this fold never spells it — it is asserted here only to say
    // the chain under test is well inside it.
    expect(60).toBeLessThan(MAX_FOREST_CONVERSATIONS)
  })

  /** ⚑ **The name is `agentName`'s**, never composed on a row. */
  it('⚑ a row is named by the roster, and by its slug when the roster is cold', () => {
    const warm = show({ identities: [identity('worker', 'Worker')] })
    expect(warm!.rows[0]!.name).toBe('Worker')
    expect(show()!.rows[0]!.name).toBe('worker')
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · 641 §3 — the truncation is disclosed, and the equality is not enough', () => {
  /**
   * 🔴 **`641` §3: *"2,027 conversations exist on this machine and almost none are ours. The bound
   * is a TRUNCATION and you must disclose it."***
   */
  it('⛔ the cut is the difference, and the excluded population is carried', () => {
    const v = show({
      forest: forest([conversation()], {
        conversations: 900,
        heldByNoAgent: 2_027,
        nodes: {
          rows: [conversation()],
          walk: 'every-conversation-this-app-placed',
          ledgers: 500,
          rowsUnread: 3,
        },
      } as never),
    })
    expect(v!.coverage.there).toBe(900)
    expect(v!.coverage.drawn).toBe(500)
    expect(v!.coverage.cut).toBe(400)
    expect(v!.coverage.rowsUnread).toBe(3)
    expect(v!.coverage.heldByNoAgent).toBe(2_027)
  })

  /**
   * ⛔ **`there === drawn` is satisfied VACUOUSLY by a store that never looked** — `NULL_SESSION_STORE`
   * answers `ledgers: 0` and `placedConversations()` answers `0`, so `0 === 0`.
   * ⚑ **`walked` is the guard**, and this is the assertion that keeps them two facts
   * ([[a-comparison-tested-where-both-sides-agree]]).
   */
  it('🔴 nothing cut over a walk that never looked is NOT a complete reading', () => {
    const v = show({
      forest: forest([], {
        conversations: 0,
        nodes: { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 },
      } as never),
    })
    expect(v!.coverage.cut, 'the arithmetic says nothing was cut').toBe(0)
    expect(v!.coverage.walked, '…and that is exactly why `cut` may not be read alone').toBe(false)
  })

  /** ⚠️ **`cut` never goes negative**, however the two counts disagree. */
  it('⚠️ a drawn count above the placed count is still not a negative cut', () => {
    const v = show({
      forest: forest([conversation()], {
        conversations: 1,
        nodes: {
          rows: [conversation()],
          walk: 'every-conversation-this-app-placed',
          ledgers: 4,
          rowsUnread: 0,
        },
      } as never),
    })
    expect(v!.coverage.cut).toBe(0)
  })
})

/* ------------------------------------------------------------------ §5 */

describe('§5 · 636’s wait reaches the WORDS, and after 645 the plate as well', () => {
  /**
   * 🔴 **This § was written while `AgentState.vue` could not receive `636`'s facet at all.**
   * ⚑ `645` declared the prop, so the plate now says the wait in its accessible name — and the
   * WORD is kept, because a plate never draws a wait (`645`) and this word, on the conversation's OWN
   * card, is where its standing — the wait included — is said to the eye; since `668` the task lines
   * on that card carry no dot. ⛔ These tests pin the word; `a-dot-says-one-thing.render.test.ts` pins
   * that a task row's facets are this row's and not a copy.
   */
  it('⛔ a conversation waiting on another agent SAYS so, and it is not `waiting on you`', () => {
    const waits: WhatEachConversationIsWaitingOn = {
      readAt: NOW,
      conversations: [{ conversation: 'sess_a', identity: 'Dev', waiting: 'waiting-on-a-worker' }],
    } as never
    // ⛔ **A live reading that says IDLE, because that is `636`'s actual case** — `HO-095` §5.1:
    // *"BroBot's header, avatar and rail row read `Idle` while Task #1 was being worked on by
    // Ada."* ⚠️ `standingOf` raises `elsewhere` only over a KNOWN idle, and the control below is
    // why that is right rather than a gap.
    const idle: WhatIsBeingDone = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_a',
          identity: 'Dev',
          told: { said: 'nothing', because: 'no-activity-right-now' },
          status: 'idle',
          streaming: false,
          since: NOW - 5_000,
        },
      ],
    } as never
    const v = show({ forest: forest([conversation({ identity: 'dev' })]), atWork: idle, waits })
    // ⚑ `636`'s word — and `621` §5.2's ruling that `waiting-on-a-worker` asks nobody for anything.
    expect(v!.rows[0]!.says).toBe('Waiting on another agent')
    expect(v!.rows[0]!.facets.needing, 'a wait was raised onto a NEEDING').toBeUndefined()
  })

  /**
   * 🔴 **The control, and it is a RULING rather than a gap.** ⛔ The same wait with NO live reading
   * stays `Unknown`: a conversation this app has heard nothing about is one it cannot describe, and
   * *waiting on another agent* over it would be a pairing nobody read
   * ([[an-unenumerated-state-counts-as-success]]).
   * ⚠️ **Found by this test failing** — the first version planted the wait alone and expected the
   * word, which would have required the fold to claim more than the readings say.
   */
  it('🔴 …but a wait with NO live reading stays unknown — it may not out-claim the read', () => {
    const waits: WhatEachConversationIsWaitingOn = {
      readAt: NOW,
      conversations: [{ conversation: 'sess_a', identity: 'Dev', waiting: 'waiting-on-a-worker' }],
    } as never
    const v = show({ forest: forest([conversation({ identity: 'dev' })]), waits })
    expect(v!.rows[0]!.says).toBe('Unknown')
  })

  /**
   * ⛔ **645 · what replaced `ForestView.plateCannotSayWaiting`.**
   *
   * ⚠️ **That flag said *the plate cannot carry the wait*, and the day the prop landed it became a
   * false statement about the app** — so it was removed rather than left saying something the
   * code no longer does ([[a-number-can-survive-the-death-of-its-derivation]], one register over).
   * ⚑ **This is the fact it was standing in for, asserted from the positive side**: the row hands
   * the plate a facets object that really carries the wait, so both channels say it — the mark in
   * its accessible name, the row in its word.
   */
  it('⛔ the row hands the plate the wait ITSELF, not just a word about it', () => {
    const waits: WhatEachConversationIsWaitingOn = {
      readAt: NOW,
      conversations: [{ conversation: 'sess_a', identity: 'Dev', waiting: 'waiting-on-a-worker' }],
    } as never
    const idle: WhatIsBeingDone = {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_a',
          identity: 'Dev',
          told: { said: 'nothing', because: 'no-activity-right-now' },
          status: 'idle',
          streaming: false,
          since: NOW - 5_000,
        },
      ],
    } as never
    const v = show({ forest: forest([conversation({ identity: 'dev' })]), atWork: idle, waits })
    expect(v!.rows[0]!.facets.waiting).toBe('waiting-on-a-worker')
    // ⚑ …and the word is still there beside it, which is what the wait ruling rests on.
    expect(v!.rows[0]!.says).toBe('Waiting on another agent')
    // ⛔ **The control**: with no wait read, the facet is ABSENT rather than present-and-null — the
    // distinction `sessionFacets` is written around, and the one a stray `undefined` would blur.
    const none = show({ forest: forest([conversation({ identity: 'dev' })]), atWork: idle })
    expect(none!.rows[0]!.facets).not.toHaveProperty('waiting')
  })
})

/**
 * ⚑ **D-017b · a conversation nothing runs reads by the one state** — re-aimed from D-007 · F017.
 *
 * ⛔ **This section said *"a conversation this app stopped under says so, not *Ended*"*** and pinned
 * three words: the rail's *Closed · quit didn't finish* for a crash, *Ended* for a conversation
 * somebody stopped, and the kept-open words (`null` here) for one a quit left open. ⚑ D-017b took all
 * three off every surface — each said whether a process runs (`05` rule 5) — and with them the two
 * fields the forest read them from (`closedBecauseTheAppDidNotFinishQuitting`,
 * `keptOpenAcrossAQuit`). ⚑ **What survives is the claim under them**: a stopped conversation is
 * drawn from what the ledger says it was doing, however it stopped.
 */
describe('D-017b · a conversation nothing runs reads by the one state — no *Ended*, no quit words', () => {
  const says = (view: ReturnType<typeof show>, id: string): string | null | undefined =>
    view?.rows.find((row) => row.kind === 'a-conversation' && row.conversation === id)?.says

  it('🔴 a stopped conversation says `Idle`, whether a crash or a person stopped it', () => {
    const view = show({
      forest: forest([
        conversation({ conversation: 'sess_crashed', running: 'not-running', status: 'idle' }),
        conversation({ conversation: 'sess_closed', running: 'not-running', status: 'ended' }),
        conversation({ conversation: 'sess_unread', running: 'unwatched', status: 'idle' }),
      ]),
    })
    expect(says(view, 'sess_crashed')).toBe('Idle')
    // ⛔ It said *Ended*: a stop ends nothing, and the plate reads the recorded stop as nothing
    // doing anything here.
    expect(says(view, 'sess_closed')).toBe('Idle')
    // ⛔ **THE PAIR** — a conversation this app RUNS and no live reading names draws `unknown`
    // (§1), so the `Idle` above is read off the ledger's status for a stopped one, never a default
    // the fold falls back to.
    expect(says(view, 'sess_unread')).toBe('Unknown')
  })
})
