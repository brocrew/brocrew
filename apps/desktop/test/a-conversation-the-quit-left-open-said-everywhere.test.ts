import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STANDING_LABEL, standingOf, type AgentFacets } from '../src/renderer/src/lib/agent-state'
import type { ListedConversation } from '../src/renderer/src/lib/conversation-list'
import { outgoingCard } from '../src/renderer/src/lib/outgoing-card'
import { OPEN_IN_ANOTHER_WINDOW, OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import { theirConversations } from '../src/renderer/src/lib/team-roster'
import {
  forestView,
  type ForestRow,
  type ForestViewInput,
} from '../src/renderer/src/lib/the-forest'
import type { OutgoingWords } from '../src/renderer/src/lib/transcript'
import { workIsWith } from '../src/renderer/src/lib/where-the-work-is'
import {
  parentCardOf,
  workingTogetherView,
  type WorkingTogetherInput,
} from '../src/renderer/src/lib/working-together'
import type { LedgerWalk, LedgerWalkKind } from '../src/shared/questions'
import type { WorkReport } from '../src/shared/tasks'
import type { ForestConversation, TheWholeForest } from '../src/shared/the-whole-forest'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../src/shared/who-called-whom'

/**
 * # 🔴 725 · draw 6 — a conversation the quit left open, said everywhere it is listed — ⚑ D-017b: ANY
 *
 * ⚑ **`711` GAP-1 / `701` F-4, as they were** — a conversation the quit left open read *Ended* /
 * *this app is not running it* / *Reopen the conversation* on the room, the Team shelf, the cast and
 * the forest while the rail drew it OPEN, and a work report's link and an outgoing card's press said
 * *Take it over and open it* on a holder with nothing running in it. `725` taught every surface the
 * kept-open population's words.
 *
 * Every surface listing a conversation says the same thing and offers one action, “Open the
 * conversation”, regardless of whether its process runs. The location detail remains
 * actionable: another window may have it open.
 *
 *  - **§1 · the Team shelf** (`theirConversations`) — ⚑ D-016 took the room (`projectRoster`) out.
 *  - **§2 · the forest** (`forestView`) — and `668`'s rule: a node the window holds is drawn from
 *    the window's own record, never the poll.
 *  - **§3 · the cast** (`workingTogetherView`, `parentCardOf`) — the child's tile and the
 *    parent's row, with no fact about where either is: no surface draws one since the spawn path
 *    went, so §3 has no control one fact over.
 *  - **§4 · the link** (`workIsWith`) and **§5 · the outgoing card** (`outgoingCard`).
 *  - **§6 · the hops** — `RuntimeScreen` is mounted by no test, so what reaches the entries is read
 *    where it is written: `held`, and no second list beside it.
 *
 * ⚑ **Each subject has its control one fact over** (rule 3): the same row in ANOTHER window says so,
 * and that is the only difference a surface draws.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(here, '../src/renderer/src')
const read = (path: string): string => readFileSync(join(RENDERER, path), 'utf8')

/** ⚠️ Prose is stripped first — a docblock that NAMES a field is not code that reads it. */
const codeOf = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const AT = 1_700_000_000_000

/** ⛔ The words D-017b took off every surface — a process fact, or a press that is gone. */
const GONE = /ended|not running|nobody is watching|not open in any window|reopen|take it over/i

const walkOf = <Row>(rows: readonly Row[], walk: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk,
  ledgers: rows.length,
  rowsUnread: 0,
})

it('⚑ rule 5 — the one press and the one place, verbatim once and by name everywhere else', () => {
  expect(OPEN_THE_CONVERSATION).toBe('Open the conversation')
  expect(OPEN_IN_ANOTHER_WINDOW).toBe('open in another window')
})

/* ================================================================ §1 · the Team shelf */

/**
 * ⚑ **One conversation as the rail lists it** — the one list the Team shelf narrows (D-016). ⚠️
 * `idle` on every row here, which is what a stop leaves a conversation reading, so the rows differ
 * in exactly the fact under test.
 */
const listed = (over: Partial<ListedConversation> & { sessionId: string }): ListedConversation => ({
  provider: 'claude',
  label: 'Ada',
  identity: 'ada',
  place: null,
  state: { is: 'idle' },
  // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so the shelf draws no work beside it.
  named: null,
  inAnotherWindow: false,
  updatedAt: AT - 60_000,
  ...over,
})

describe('§1 · the Team shelf says what the rail says', () => {
  it('🔴 the Team shelf narrows the rail’s own rows — and says the same of each', () => {
    const shelf = theirConversations(
      [
        listed({ sessionId: 'sess_stopped' }),
        listed({ sessionId: 'sess_ali', identity: 'ali' }),
        listed({ sessionId: 'sess_there', inAnotherWindow: true }),
      ],
      'ada',
      new Set<string>(),
    )
    expect(shelf?.map((row) => row.conversation).sort()).toEqual(['sess_stopped', 'sess_there'])
    // ⚑ What a row nothing runs draws now — the one press, and no sentence of its own.
    const stopped = shelf!.find((row) => row.conversation === 'sess_stopped')!
    expect(stopped.action).toBe(OPEN_THE_CONVERSATION)
    expect(stopped.says).toBeNull()
    expect(stopped.word).not.toMatch(GONE)
    expect(STANDING_LABEL[stopped.standing]).not.toMatch(GONE)
    // ⚑ The control, same shelf: the one another window holds says so there too.
    const there = shelf!.find((row) => row.conversation === 'sess_there')!
    expect(there.says).toBe(OPEN_IN_ANOTHER_WINDOW)
    expect(there.action).toBe(OPEN_THE_CONVERSATION)
  })
})

/* ================================================================ §2 · the forest */

/** ⚑ One forest node, as `theWholeForest` lists it — a stop's `ended` on it, as above. */
const node = (over: Partial<ForestConversation> = {}): ForestConversation => ({
  node: 'a-conversation',
  conversation: 'sess_stopped',
  under: { is: 'the-person' },
  identity: 'ada',
  provider: 'claude',
  status: 'ended',
  running: 'not-running',
  standsInFor: [],
  inItsPlace: null,
  startedAt: AT - 300_000,
  updatedAt: AT - 60_000,
  ...over,
})

const forestOf = (nodes: readonly ForestConversation[]): TheWholeForest => ({
  readAt: AT,
  nodes: walkOf(nodes, 'every-conversation-this-app-placed'),
  conversations: nodes.length,
  heldByNoAgent: 0,
})

const theNode = (one: ForestConversation, over: Partial<ForestViewInput> = {}): ForestRow => {
  const view = forestView({
    forest: forestOf([one]),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set<string>(),
    ...over,
  })
  const row = view?.rows.find((r) => r.kind === 'a-conversation')
  expect(row, 'the forest drew no node').toBeDefined()
  return row!
}

describe('§2 · the forest', () => {
  it('🔴 a node nothing runs wears its standing and no word about a process', () => {
    const row = theNode(node())
    expect(row.says).not.toMatch(GONE)
    expect(row.says).toBe(STANDING_LABEL[standingOf(row.facets)])
    expect(row.facets.being).not.toBe('ended')
    expect(row.conversationRow?.elsewhere).toBe(false)
    expect(row.conversationRow?.whereSays).toBeNull()
  })

  it('⚑ THE CONTROL — a node open in ANOTHER window says where it is', () => {
    const row = theNode(node({ running: 'in-a-window' }))
    expect(row.conversationRow?.elsewhere).toBe(true)
    expect(row.conversationRow?.whereSays).toBe(OPEN_IN_ANOTHER_WINDOW)
  })

  /**
   * ⚑ **UI-004 · the rail's row outranks the poll** (it was `668`'s rule for a conversation this
   * window HOLDS, and the rail derives those from the window's own record). ⚠️ Reachable in one poll:
   * a person opens a conversation and sends it a message, and the forest's last reading still says
   * *not-running* for up to 30 s.
   */
  it('⚑ a node the rail names is drawn from the rail’s row, not from the stale poll', () => {
    const known: AgentFacets = { doing: 'working', being: 'live' }
    const row = theNode(node(), {
      held: new Set(['sess_stopped']),
      said: new Map([['sess_stopped', { facets: known, word: 'active' }]]),
    })
    expect(row.facets).toBe(known)
    expect(row.says).toBe('active')
    // ⚑ …and a conversation this window holds is never *in another window*.
    expect(row.conversationRow?.elsewhere).toBe(false)
  })
})

/* ================================================================ §3 · the cast */

const HERE = 'sess_here'

const edge = (over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation: 'sess_kid',
  identity: 'ada',
  provider: 'claude',
  running: 'not-running',
  ...over,
})

const answer = (over: Partial<WhoCalledWhom>): WhoCalledWhom => ({
  conversation: HERE,
  parent: null,
  children: walkOf<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walkOf<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walkOf<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: AT,
  ...over,
})

const castOf = (read: WhoCalledWhom): WorkingTogetherInput => ({
  reading: { conversation: HERE, read, answered: true, atWork: null },
  forConversation: HERE,
  identities: null,
  now: AT,
})

/** The child's tile and the parent's row — both, from one read. */
function theCast(child: SpawnEdge, parent: SpawnEdge) {
  const input = castOf(
    answer({
      parent,
      children: walkOf([child], 'every-conversation-this-one-spawned'),
    }),
  )
  const view = workingTogetherView(input)
  expect(view, 'the band read nothing').not.toBeNull()
  const tile = view!.children.find((card) => card.conversation === child.conversation)
  const up = parentCardOf(input)
  expect(tile, 'no tile for the child').toBeDefined()
  expect(up, 'no parent row').not.toBeNull()
  return { tile: tile!, up: up! }
}

describe('§3 · the cast: the tile and the parent’s row', () => {
  it('🔴 a child and a parent nothing runs say nothing about a process — on both', () => {
    const { tile, up } = theCast(
      edge({ conversation: 'sess_kid' }),
      edge({ conversation: 'sess_pm' }),
    )
    for (const card of [tile, up]) expect(card.facets.being).not.toBe('ended')
  })
})

/* ================================================================ §4 · the link */

const REPORT: WorkReport = {
  piece: 'work_1',
  label: 'W1.5',
  owner: 'sess_child',
  state: 'answered',
  outcome: 'done',
}

const ids = (...list: string[]): ReadonlySet<string> => new Set(list)

describe('§4 · `701` F-4 — a report’s link to its holder', () => {
  it('🔴 one press whatever the holder is doing: *Open the conversation* — `held` is the window’s fact', () => {
    expect(workIsWith(REPORT, ids('sess_other'))).toEqual({
      conversation: 'sess_child',
      held: false,
      action: OPEN_THE_CONVERSATION,
    })
    // ⚑ The control, one fact over: the window runs it — `data-held` says so, the words do not move.
    expect(workIsWith(REPORT, ids('sess_child'))).toEqual({
      conversation: 'sess_child',
      held: true,
      action: OPEN_THE_CONVERSATION,
    })
  })

  it('⚑ a surface with no runtime still offers nothing', () => {
    expect(workIsWith(REPORT, null)).toBeNull()
  })

  /*
   * ⚑ **D-016c · the snapshot arm went with its field** — it pinned that a report whose
   * `holderKeptOpen` snapshot said *kept open* opened the same way. A report carries no such field
   * now: a stop changes nothing about a piece, so nothing is written about one.
   */
})

/* ================================================================ §5 · the outgoing card */

const BARE = { summary: '{}', result: null, unfinished: undefined }

const MESSAGE: OutgoingWords = {
  tool: 'message_agent',
  sent: {
    toProfile: 'ada',
    toConversation: 'sess_ada',
    kind: 'note',
    delivery: 'sent',
    text: null,
    clipped: false,
  },
}

const REPLY: OutgoingWords = {
  tool: 'reply_to_parent',
  reply: {
    piece: 't',
    outcome: 'done',
    summary: 's',
    resources: [],
    toProfile: 'pm',
    toConversation: 'sess_pm',
  },
}

describe('§5 · `701` F-4 — an outgoing card, both arms', () => {
  it('🔴 a message and a reply: *Open the conversation*, not held', () => {
    expect(outgoingCard(BARE, MESSAGE, null, ids()).where).toEqual({
      conversation: 'sess_ada',
      held: false,
      action: OPEN_THE_CONVERSATION,
    })
    expect(outgoingCard(BARE, REPLY, null, ids()).where).toEqual({
      conversation: 'sess_pm',
      held: false,
      action: OPEN_THE_CONVERSATION,
    })
  })

  it('⚑ THE CONTROL — held here, both arms say so in `held`, and the words do not move', () => {
    expect(outgoingCard(BARE, MESSAGE, null, ids('sess_ada')).where?.held).toBe(true)
    expect(outgoingCard(BARE, REPLY, null, ids('sess_pm')).where?.held).toBe(true)
    for (const words of [MESSAGE, REPLY]) {
      expect(outgoingCard(BARE, words, null, ids()).where?.action).toBe(OPEN_THE_CONVERSATION)
    }
  })
})

/* ================================================================ §6 · the hops */

/** The attributes of the one tag that opens at `open`, up to its self-close. */
function tagOf(source: string, open: string): string {
  const from = source.indexOf(open)
  expect(from, `no ${open.trim()} in the source`).toBeGreaterThan(-1)
  expect(source.indexOf(open, from + 1), `a second ${open.trim()}`).toBe(-1)
  const end = source.indexOf('/>', from)
  expect(end).toBeGreaterThan(from)
  return source.slice(from, end)
}

/**
 * ⚑ **D-017b · re-aimed** — `725` threaded the rail's LIVE kept-open list beside `held` through
 * every hop (screen → pane → transcript → both entries). ⛔ With the population gone, the list is
 * gone from every hop, and `held` — the one fact an entry still marks — travels alone.
 * ⚠️ `RuntimeScreen` is mounted by no test, so each hop is read where it is written.
 */
describe('§6 · `held` reaches both entries, alone — every hop, read where it is written', () => {
  it('🔴 the screen hands the pane the window’s held list, and no second list', () => {
    const tag = tagOf(read('components/RuntimeScreen.vue'), '<ConversationPane\n')
    expect(tag).toContain(':held="heldHere"')
    expect(tag).not.toContain(':kept-open=')
  })

  it('🔴 the pane forwards it to its transcript', () => {
    const pane = read('components/ConversationPane.vue')
    const tag = tagOf(pane, '<TranscriptView\n')
    expect(tag).toContain(':held="props.held"')
    expect(tag).not.toContain(':kept-open=')
    expect(codeOf(pane)).not.toContain('keptOpen')
  })

  it('🔴 the transcript hands it to both entries, and each entry to its lib', () => {
    const view = read('components/TranscriptView.vue')
    for (const open of ['<WorkReportEntry\n', '<OutgoingEntry\n']) {
      const tag = tagOf(view, open)
      expect(tag, open).toContain(':held="heldIds"')
      expect(tag, open).not.toContain(':kept-open=')
    }
    expect(read('components/WorkReportEntry.vue')).toContain(
      'workIsWith(props.item.report, props.held ?? null)',
    )
    // ⚑ The argument after `held` is the work this conversation gave out, where a give's card finds
    // its press — not a second list of what the window holds.
    expect(codeOf(read('components/OutgoingEntry.vue'))).toMatch(
      /outgoingCard\(\s*props\.item,\s*props\.words,\s*props\.identities \?\? null,\s*props\.held \?\? null,\s*props\.gaveOut \?\? null,?\s*\)/,
    )
    // ⚑ …and the list the screen read is gone from the rail.
    expect(codeOf(read('components/SideRail.vue'))).not.toContain('keptOpenIds')
  })
})
