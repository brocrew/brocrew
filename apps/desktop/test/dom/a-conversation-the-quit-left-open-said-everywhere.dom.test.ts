import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { STANDING_LABEL } from '../../src/renderer/src/lib/agent-state'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import {
  OPEN_IN_ANOTHER_WINDOW,
  OPEN_THE_CONVERSATION,
} from '../../src/renderer/src/lib/taking-over'
import { forestView, type ForestRow } from '../../src/renderer/src/lib/the-forest'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { IdentityUse } from '../../src/shared/agent-roster'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { AgentIdentities, AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import type { ForestConversation, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { assertDrawn, drawnReady } from './drawn'
import { META, drawerProps, mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * # 🔴 725 · draw 6 — a conversation the quit left open, as a person SEES it on every list — ⚑ D-017b: ANY
 *
 * ⚑ **`711` GAP-1 and `701` F-4, drawn** — the half `a-conversation-the-quit-left-open-said-
 * everywhere.test.ts` cannot reach: which chip says what, what the plate's accessible name says,
 * what a press's words are at a real width, and that a press raises the act it names.
 *
 * ⚑ **D-017b · re-aimed.** There is no kept-open population and no closed one: every conversation
 * opens in its one full view, so every list draws a conversation nothing runs the same way —
 * *Open the conversation*, no *Ended*, no *this app is not running it*, no *Reopen*, no *Take it
 * over* (`05` rule 5) — and says where it is only when another window has it open.
 *
 *  - **§2 · the Team shelf's row** · **§3 · the forest's card** — ⚑ §1, the project room's row,
 *    went with the room at D-016.
 *  - **§4 · the cast** — the child's tile and the parent's row.
 *  - **§5 · a report's link and an outgoing card's press**, through the pane → transcript → entry
 *    hops.
 *
 * ⚑ **Each 🔴 in §2, §3 and §5 has its ⚑ control one fact over** — the same row open in ANOTHER
 * window, or the same report with its holder held here. ⛔ §4 has none: no surface draws the
 * cast's *open in another window* for a parent or a child since the spawn path went (UI-006), so
 * its 🔴 is negatives under a non-empty accessible name. ⛔ No photographs here (rule 17.2 is the
 * lead's).
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  // ⛔ **The cast is a window-level singleton** (`547`), so a reading left behind would be the next
  // test's premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ The plate inside one element, as the DOM holds it — never as the fold reports it. */
function plateIn(root: Element, what: string): HTMLElement {
  const plate = root.querySelector<HTMLElement>('[data-cy="agent-state"]')
  expect(plate, `${what} draws no plate`).not.toBeNull()
  return plate!
}

/**
 * 🔴 **A plate that says nothing about a process** — `data-being` is the underline the plate paints,
 * and the accessible name is the sentence a listener hears. ⛔ Neither may say *ended* (D-017b), and
 * neither says *not started* — the kept-open plate went with its population.
 */
function noProcessWord(plate: HTMLElement, what: string): void {
  expect(plate.dataset['being'], `${what}'s plate`).not.toBe('ended')
  expect(plate.dataset['being'], `${what}'s plate`).not.toBe('unstarted')
  const name = plate.getAttribute('aria-label') ?? ''
  // ⚑ The positive: there IS a name to read, so the negatives are about its words.
  expect(name, `${what}'s accessible name`).not.toBe('')
  expect(name, `${what}'s accessible name`).not.toMatch(/\bended\b|not started/)
}

/** ⛔ The words D-017b took off every list — a process fact, or a press that is gone. */
const GONE = /ended|not running|nobody is watching|not open in any window|reopen|take it over/i

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/* ================================================================ §2 · the Team shelf */

/** ⚑ **Anchored to the wall clock** — the page measures every age from the live minute. */
const WALL = Date.now()

/** ⛔ **The pane floor** — `--app-min-w` 1180 less `--rail-w` 208. */
const FLOOR = 972

const CHOSEN: AgentIdentity['chosen'] = {
  maxDepth: 'default',
  canMessage: 'default',
  canAssignWork: 'default',
  canCreateAgents: 'default',
  canWriteRules: 'default',
}

const ADA: AgentIdentity = {
  id: 'aid:ada',
  slug: 'ada',
  displayName: 'Ada',
  createdAt: WALL - 86_400_000,
  createdBy: null,
  provider: 'claude',
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
}

const ADA_USE: IdentityUse = {
  slug: 'ada',
  conversations: 1,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: 'claude', from: 'saved' },
}

const AGENTS: AgentIdentities = {
  identities: [ADA],
  foldersWithoutARow: [],
  use: [ADA_USE],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const STORE = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

/**
 * ⚑ **One conversation as the rail lists it** — D-016: the one list the shelf narrows. ⚠️ `idle`,
 * which is what a stop leaves a conversation reading, so the subject and its control differ in the
 * one fact under test.
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
  updatedAt: WALL - 60_000,
  ...over,
})

/** The Team page, with ada's one conversation behind the shelf's door — and the presses it raised. */
async function shelf(row: ListedConversation) {
  await page.viewport(FLOOR, 900)
  const raised: string[] = []
  const m = mount(
    TeamWorkspace as Component,
    {
      agents: AGENTS,
      store: STORE,
      beingDone: null,
      held: [],
      conversations: [row],
      onOpenConversation: (id: string) => raised.push(`open:${id}`),
    },
    { width: FLOOR, height: 900 },
  )
  await nextTick()
  // ⚠️ **A `<details>` toggle is an asynchronous task** — `the-avatar-is-the-status.dom.test.ts`'
  // own `press`, so what is measured is the settled frame.
  const card = m.q('team-card-ada')
  const door = card
    .querySelector<HTMLElement>('[data-cy="team-conversations-ada"]')!
    .closest('details') as HTMLDetailsElement
  const toggled = new Promise<void>((resolve) => {
    door.addEventListener('toggle', () => resolve(), { once: true })
  })
  door.open = true
  await toggled
  for (let round = 0; round < 3; round++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  await drawnReady()
  return { m, card, raised }
}

describe('§2 · the Team shelf’s row', () => {
  it('🔴 a row nothing runs: its standing and no *Ended*, no second phrase, *Open the conversation*', async () => {
    const { m, card, raised } = await shelf(listed({ sessionId: 'sess_stopped' }))
    const row = card.querySelector<HTMLElement>('[data-cy="team-conversation-sess_stopped"]')
    expect(row, 'the shelf drew no row').not.toBeNull()
    const now = row!.querySelector<HTMLElement>('.team-now')
    expect(now, 'the shelf drew no standing').not.toBeNull()
    expect(text(now)).not.toMatch(GONE)
    // ⚑ `593`'s rule, D-017b's reach: one phrase per fact — and nothing here is elsewhere.
    expect(row!.querySelector('.shelf-where')).toBeNull()
    expect(text(row)).not.toMatch(GONE)
    const press = m.q('team-conversation-go-sess_stopped')
    expect(text(press)).toBe(OPEN_THE_CONVERSATION)
    press.click()
    await nextTick()
    expect(raised).toEqual(['open:sess_stopped'])
  })

  it('⚑ THE CONTROL — the same row open in ANOTHER window says where it is, drawn whole', async () => {
    const { m, card, raised } = await shelf(
      listed({ sessionId: 'sess_there', inAnotherWindow: true }),
    )
    const row = card.querySelector<HTMLElement>('[data-cy="team-conversation-sess_there"]')
    expect(row, 'the shelf drew no row').not.toBeNull()
    const where = row!.querySelector<HTMLElement>('.shelf-where')
    expect(where, 'where it is is not drawn').not.toBeNull()
    expect(text(where)).toBe(OPEN_IN_ANOTHER_WINDOW)
    assertDrawn(where!, 'where the shelf’s row is', m.host)
    m.q('team-conversation-go-sess_there').click()
    await nextTick()
    expect(raised).toEqual(['open:sess_there'])
  })
})

/* ================================================================ §3 · the forest */

const FOREST_AT = 1_800_000_000_000

const node = (over: Partial<ForestConversation>): ForestConversation => ({
  node: 'a-conversation',
  conversation: 'sess_stopped',
  under: { is: 'the-person' },
  identity: 'ada',
  provider: 'claude',
  status: 'ended',
  running: 'not-running',
  standsInFor: [],
  inItsPlace: null,
  startedAt: FOREST_AT - 60_000,
  updatedAt: FOREST_AT - 1_000,
  ...over,
})

const forestOf = (nodes: readonly ForestConversation[]): TheWholeForest => ({
  readAt: FOREST_AT,
  nodes: {
    rows: nodes,
    walk: 'every-conversation-this-app-placed',
    ledgers: nodes.length,
    rowsUnread: 0,
  },
  conversations: nodes.length,
  heldByNoAgent: 0,
})

/** ⚑ The forest's own fold, drawn — never a hand-set row. */
async function forest(one: ForestConversation) {
  await page.viewport(1200, 900)
  const pressed: string[] = []
  const view = forestView({
    forest: forestOf([one]),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set<string>(),
  })
  const m = mount(
    TeamForest as Component,
    { view, onPress: (row: ForestRow) => pressed.push(row.conversation) },
    { width: 1200, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return { m, card: m.q(`forest-row-${one.conversation}`), pressed }
}

describe('§3 · the forest’s card', () => {
  it('🔴 a node nothing runs: its standing and no *Ended*, no second phrase, a plate with no process word', async () => {
    const { m, card, pressed } = await forest(node({}))
    const says = card.querySelector<HTMLElement>('[data-cy="forest-says"]')
    expect(says, 'the forest drew no standing').not.toBeNull()
    expect(text(says)).not.toMatch(GONE)
    expect(Object.values(STANDING_LABEL)).toContain(text(says))
    expect(card.querySelector('[data-cy="forest-here"]')).toBeNull()
    noProcessWord(plateIn(card, 'the forest’s card'), 'the forest’s card')
    // ⚑ **The press says what it does** — the one press, when the node carries no reason of its own.
    const head = card.querySelector<HTMLElement>('[data-cy="forest-open"]')!
    expect(head.tagName).toBe('BUTTON')
    expect(head.getAttribute('title')).toBe(OPEN_THE_CONVERSATION)
    head.click()
    expect(pressed).toEqual(['sess_stopped'])
    assertDrawn(says!, 'the forest card’s standing', m.host)
  })

  it('⚑ THE CONTROL — a node open in ANOTHER window says where it is, drawn whole', async () => {
    const { m, card } = await forest(node({ conversation: 'sess_there', running: 'in-a-window' }))
    const here = card.querySelector<HTMLElement>('[data-cy="forest-here"]')
    expect(here, 'where it is is not drawn').not.toBeNull()
    expect(text(here)).toBe(OPEN_IN_ANOTHER_WINDOW)
    assertDrawn(here!, 'where the forest’s card is', m.host)
  })
})

/* ================================================================ §4 · the cast */

const CAST_AT = 1_800_000_000_000
const PARENT = 'sess_pm'
const CHILD = 'sess_kid'

const edge = (over: Partial<SpawnEdge>): SpawnEdge => ({
  conversation: CHILD,
  identity: 'worker',
  provider: 'claude',
  running: 'not-running',
  ...over,
})

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

/** ⚑ This conversation's read: one parent above it, one child below — neither running. */
const castRead = (): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: edge({ conversation: PARENT, identity: 'project-manager', running: 'not-running' }),
  children: walk(
    [edge({ conversation: CHILD, running: 'not-running' })],
    'every-conversation-this-one-spawned',
  ),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: CAST_AT,
})

/** The drawer's Open tab — the parent's row above the agent, the child's tile in the band. */
function drawer() {
  const cast = useWhoCalledWhom()
  cast.reading.value = {
    conversation: META.sessionId,
    read: castRead(),
    answered: true,
    atWork: null,
  }
  cast.goTo.value = null
  return mount(SessionDrawer as never, drawerProps({ identities: null }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
}

const tileOf = (m: ReturnType<typeof mount>, conversation: string): HTMLElement => {
  const tile = m.q(`cast-tile-name-${conversation}`).closest<HTMLElement>('li')
  expect(tile, `no tile for ${conversation}`).not.toBeNull()
  return tile!
}

describe('§4 · the cast: the child’s tile and the parent’s row', () => {
  it('🔴 a child and a parent nothing runs wear a plate with no process word', () => {
    const m = drawer()
    noProcessWord(plateIn(tileOf(m, CHILD), 'the child’s tile'), 'the child’s tile')
    noProcessWord(plateIn(m.q('came-from-open'), 'the parent’s row'), 'the parent’s row')
    expect(text(m.q('came-from-open'))).not.toMatch(GONE)
  })
})

/* ================================================================ §5 · the link and the card */

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.3',
  owner: 'sess_worker',
  state: 'answered',
  outcome: 'done',
  ...over,
})

const reported = (body: string, work: WorkReport): TranscriptEvent => ({
  type: 'user_turn',
  text: body,
  attribution: 'app_authored',
  work,
})

const ANSWERED: TranscriptEvent[] = [
  { type: 'user_turn', text: 'give the worker something to do' },
  reported('W1.3 (work_1) was answered by sess_worker: done.\n\nI wrote it.', report()),
]

/** The pane, handed the window's `held` — the one fact the screen still hands an entry. */
async function pane(events: TranscriptEvent[], held: readonly string[] = ['sess_other']) {
  await page.viewport(1200, 808)
  const opened: string[] = []
  const m = mount(
    ConversationPane as Component,
    paneProps({
      record: record(events),
      held,
      onOpenConversation: (id: string) => opened.push(id),
    }),
    { width: 1200, height: 808 },
  )
  await nextTick()
  await expandAgentCards(m)
  return { m, opened }
}

describe('§5 · `701` F-4 — a report’s link to its holder', () => {
  it('🔴 one press whatever the holder is doing: *Open the conversation*, not held, and the press opens it', async () => {
    const { m, opened } = await pane(ANSWERED)
    const link = m.q('work-report-where')
    expect(visible(link)).toBe(true)
    expect(text(link)).toBe(OPEN_THE_CONVERSATION)
    // ⛔ `held` stays the WINDOW's fact — this window is not running it.
    expect(link.dataset['held']).toBe('false')
    link.click()
    await nextTick()
    expect(opened).toEqual(['sess_worker'])
  })

  it('⚑ THE CONTROL — the holder held HERE: `data-held` says so, and the words do not move', async () => {
    const { m } = await pane(ANSWERED, ['sess_worker'])
    expect(m.q('work-report-where').dataset['held']).toBe('true')
    expect(text(m.q('work-report-where'))).toBe(OPEN_THE_CONVERSATION)
  })

  /*
   * ⚑ **D-016c · the snapshot arm went with its field** — it drew a report whose `holderKeptOpen`
   * snapshot said *kept open*. A report carries no such field now: a stop changes nothing about a
   * piece, so nothing is written about one.
   */
})

const MESSAGE = 'mcp__brobot__message_agent'

/** ⚑ `message_agent` to `sess_pm`, folded the way the fold folds it — a card, not a tool row. */
const SENT: TranscriptEvent[] = [
  {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'message_agent', description: '', parameters: [] }],
    },
    published: null,
  } as unknown as TranscriptEvent,
  { type: 'tool_call', id: 'c1', name: MESSAGE, summary: '{"text":"do it"}' } as TranscriptEvent,
  {
    type: 'message_sent',
    to: 'sess_pm',
    toProfile: 'pm',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
  } as TranscriptEvent,
  { type: 'tool_result', id: 'c1', summary: 'ok', ok: true } as TranscriptEvent,
]

describe('§5b · `701` F-4 — an outgoing card to its recipient', () => {
  it('🔴 *Open the conversation*, not held, and the press opens it', async () => {
    const { m, opened } = await pane(SENT)
    const press = m.q('outgoing-where')
    expect(visible(press)).toBe(true)
    expect(text(press)).toBe(OPEN_THE_CONVERSATION)
    expect(press.dataset['held']).toBe('false')
    press.click()
    await nextTick()
    expect(opened).toEqual(['sess_pm'])
  })

  it('⚑ THE CONTROL — the recipient held HERE: `data-held` says so, and the words do not move', async () => {
    const { m } = await pane(SENT, ['sess_pm'])
    expect(m.q('outgoing-where').dataset['held']).toBe('true')
    expect(text(m.q('outgoing-where'))).toBe(OPEN_THE_CONVERSATION)
  })
})
