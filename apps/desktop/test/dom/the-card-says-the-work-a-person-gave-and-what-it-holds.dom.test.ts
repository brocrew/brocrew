import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { AgentFacets } from '../../src/renderer/src/lib/agent-state'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { WorkThatNamesIt } from '../../src/shared/piece-called'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { assertDrawn, cutsOf, drawnReady, titleRecovers } from './drawn'
import {
  META,
  allTasks,
  drawerProps,
  mount,
  paneProps,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * # ⚑ The agent card says the work a person gave it, what it is waiting on, and what it holds
 *
 * ⚑ **UI-008 (F051), D-018 and `f1fa1e2e`, on the agent card the right panel draws** — the pieces of
 * it no other suite reads:
 *
 * - 🔴 **The work a person gave** — a conversation named by a ROOT (`W2`) draws that root first in
 *   *Current task*: its label, *for you* and its title, never a press, the current piece only where
 *   no other is open, taking one of the box's five lines, and drawn only once the work given to the
 *   conversation has been read (the box says one thing at a time). ⛔ A conversation named by a piece
 *   its parent gave it (`W1.2`) is not a person's work and draws no root.
 * - 🔴 **The word under the plate** says *needs you* where a person owes the conversation an answer
 *   or an approval — with a card or without one — and keeps its own words where nobody does.
 * - ⚑ **The memory line** (D-018) is drawn for a conversation whose process runs, and for no other.
 * - 🔴 **The way up** (`f1fa1e2e`) keeps to the panel at 320 px: a long parent name gives way inside
 *   its own pill and tells itself whole.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — a root and none, a label
 * of one number and of two, a read that landed and one that has not, a figure for this conversation
 * and for another — because a card that drew nothing at all would pass every absence.
 *
 * ⚠️ **The words are written out in the tests and never read back from the functions that produce
 * them**: *needs you*, *idle*, *for you*. A literal read back from its own producer cannot go red
 * when the producer is wrong.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.railSays.value = null
  cast.processMemory.value = new Map()
  cast.cardFiles.value = null
  cast.treeFiles.value = null
})

const NOW = Date.now()

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

const edge = (over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece: 'work_63',
  label: 'W63',
  title: 'Inspect the window states',
  from: 'sess_parent',
  fromIdentity: 'brobot',
  to: META.sessionId,
  toIdentity: 'inspector',
  state: 'working',
  givenAt: NOW - 120_000,
  endedAt: null,
  ...over,
})

/** ⚑ The k-th piece a parent gave this conversation under W2 — given a minute later than the last. */
const piece = (k: number, over: Partial<WorkEdge> = {}): WorkEdge =>
  edge({
    piece: `work_2${String(k)}`,
    label: `W2.${String(k)}`,
    title: `Piece ${String(k)}`,
    from: 'sess_parent',
    to: META.sessionId,
    state: 'working',
    givenAt: NOW - (6 - k) * 60_000,
    ...over,
  })

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

/** ⚑ A read whose work-taken-in walk holds exactly these pieces. */
const taking = (...pieces: WorkEdge[]): WhoCalledWhom =>
  answer({ workTakenIn: walk(pieces, 'every-piece-of-work-this-one-was-given') })

const spawn = (over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation: 'sess_child',
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

const identity = (slug: string, displayName: string | null = null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: NOW - 86_400_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

interface Shown {
  /** ⚑ The work that names the conversation — absent is *nothing names it*. */
  named?: WorkThatNamesIt | null
  /** ⚑ Absent is no screen above the drawer, so the card draws no press at all. */
  goTo?: (conversation: string) => void
  width?: number
  facets?: AgentFacets
  identities?: readonly AgentIdentity[] | null
}

/**
 * ⚑ **The drawer, with the band read for this conversation** — `null` is *nothing has been read*,
 * which is not an empty walk. ⚠️ The drawer is handed `named` the way the pane hands it.
 */
function show(read: WhoCalledWhom | null, over: Shown = {}): Mounted {
  const cast = useWhoCalledWhom()
  cast.reading.value =
    read === null ? null : { conversation: META.sessionId, read, answered: true, atWork: null }
  cast.goTo.value = over.goTo ?? null
  return mount(
    SessionDrawer as never,
    drawerProps({
      named: over.named ?? null,
      ...(over.facets === undefined ? {} : { facets: over.facets }),
      identities: over.identities ?? null,
    }),
    { width: over.width ?? DRAWER_W_MIN, height: 900 },
  )
}

const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The line a person's work is drawn on — `data-root` is written on no other. */
const rootRow = (m: Mounted): HTMLElement | null =>
  m.host.querySelector<HTMLElement>('[data-cy="cast-taken-work"][data-root="true"]')

/** ⚑ Every other line of *Current task*, in the list's order. */
const pieceRows = (m: Mounted): HTMLElement[] =>
  m.all('cast-taken-work').filter((row) => row.dataset.root !== 'true')

const labelOf = (row: HTMLElement): string => said(row.querySelector('.tnum')!)

/** ⚑ Every line of the list the card draws as the current piece — the well and the file icon. */
const currentLines = (m: Mounted): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>('li.task.current'),
]

describe('the agent card says the work a person gave it', () => {
  it('shows the recorded done condition for current work and the root, with an honest legacy absence', async () => {
    const condition = 'The result is recorded and its checks pass.'
    const current = show(taking(piece(1, { definitionOfDone: condition })), {
      named: {
        label: 'W2',
        title: 'Plan the week',
        definitionOfDone: 'The week has an agreed plan.',
      },
    })
    await drawnReady()
    const done = current.q('cast-work-done')
    expect(said(done)).toBe(`Done when: ${condition}`)
    assertDrawn(done, 'the current work done condition', current.host)
    unmountAll()

    const root = show(answer(), {
      named: {
        label: 'W2',
        title: 'Plan the week',
        definitionOfDone: 'The week has an agreed plan.',
      },
    })
    await drawnReady()
    expect(root.host.textContent).toContain('Done when: The week has an agreed plan.')
    const rootCondition = rootRow(root)!.parentElement!.querySelector<HTMLElement>('.tbrief')!
    assertDrawn(rootCondition, 'the root done condition', root.host)
    unmountAll()

    for (const definitionOfDone of [null, '']) {
      const noCondition = show(answer(), {
        named: { label: 'W2', title: 'Plan the week', definitionOfDone },
      })
      await drawnReady()
      expect(noCondition.host.textContent).not.toContain('Done when:')
      unmountAll()
    }

    const legacy = show(taking(piece(1, { definitionOfDone: null })))
    await drawnReady()
    expect(legacy.all('cast-work-done')).toHaveLength(0)
    unmountAll()

    const unread = show(taking(piece(1)), { named: { label: 'W2', title: 'Plan the week' } })
    await drawnReady()
    expect(unread.all('cast-work-done')).toHaveLength(0)
    expect(unread.host.textContent).not.toContain('Done when: Not recorded')
  })

  it('🔴 UI-008 · a person’s work is the first line of Current task — its label, “for you” and its title — and “No current task” is not drawn over it', async () => {
    const opened: string[] = []
    const m = show(answer(), {
      named: { label: 'W2', title: 'Check the **booking** flow' },
      goTo: (conversation) => opened.push(conversation),
    })
    await drawnReady()

    // ⚑ The read answered with NO taken work, so the one line is the root and nothing else.
    expect(m.all('cast-taken-work')).toHaveLength(1)
    const row = rootRow(m)!
    expect(row, 'the work a person gave drew no line').not.toBeNull()
    expect(visible(row)).toBe(true)
    expect(row.dataset.open).toBe('true')
    expect(row.dataset.pressable).toBe('false')
    // ⛔ Never a control, though a screen above the drawer could open a conversation.
    expect(row.tagName).toBe('SPAN')
    row.click()
    expect(opened, 'a person’s work was pressed and opened a conversation').toEqual([])

    expect(said(row.querySelector('.tnum')!)).toBe('W2')
    expect(said(row.querySelector('[data-cy="cast-work-to"]')!)).toBe('for you')
    // ⚑ The title as a person reads it, its marks off — and the row's own title as it was written.
    const words = row.querySelector<HTMLElement>('[data-cy="cast-work-said"]')!
    expect(said(words)).toBe('Check the booking flow')
    assertDrawn(words, 'the person’s work’s title', m.host)
    expect(row.getAttribute('title')).toBe('Check the **booking** flow')
    // ⚑ Nothing else is open, so it is the current piece: the well and the file icon.
    const li = row.closest('li')!
    expect(li.classList.contains('current')).toBe(true)
    expect(li.querySelector('.ticon')).not.toBeNull()

    expect(m.all('card-task-empty')).toHaveLength(0)
    expect(m.all('card-task-unread')).toHaveLength(0)
    expect(said(m.q('cast-taken-heading'))).toBe('Current task')
    unmountAll()

    // ⚑ A root nobody has titled says its label alone, and its row's title is the label.
    const untitled = show(answer(), { named: { label: 'W3', title: null } })
    await drawnReady()
    const bare = rootRow(untitled)!
    expect(bare, 'an untitled root drew no line').not.toBeNull()
    expect(said(bare.querySelector('.tnum')!)).toBe('W3')
    expect(said(bare.querySelector('[data-cy="cast-work-to"]')!)).toBe('for you')
    expect(bare.querySelectorAll('[data-cy="cast-work-said"]')).toHaveLength(0)
    expect(bare.getAttribute('title')).toBe('W3')
    unmountAll()

    // ⛔ The control, the same card one fact over: nothing names the conversation. The quiet box is
    // the right answer here, so the root line above is not the default.
    const none = show(answer(), { named: null })
    await drawnReady()
    const empty = none.q('card-task-empty')
    expect(visible(empty)).toBe(true)
    expect(said(empty.querySelector('.says')!)).toBe('No current task')
    expect(none.all('cast-taken-work')).toHaveLength(0)
    expect(rootRow(none)).toBeNull()
  })

  it('⚑ UI-008 · the root is the current piece only where no other is open — and it is never a press, beside a piece a parent gave that is', async () => {
    const opened: string[] = []
    const goTo = (conversation: string): void => {
      opened.push(conversation)
    }
    const named = { label: 'W2', title: 'Plan the week' }
    const card = show(taking(piece(1)), { named, goTo })
    await drawnReady()
    const m = await allTasks(card)

    // ⚑ Both lines drawn, the root first — by the document's order and by the engine's boxes.
    const rows = m.all('cast-taken-work')
    expect(rows.map((row) => row.dataset.root === 'true')).toEqual([true, false])
    const root = rootRow(m)!
    const open = pieceRows(m)[0]!
    expect(labelOf(open)).toBe('W2.1')
    expect(root.getBoundingClientRect().top).toBeLessThan(open.getBoundingClientRect().top)

    // ⛔ One piece is open, so IT is the current one: the well and the icon are its, not the root's.
    expect(root.closest('li')!.classList.contains('current')).toBe(false)
    expect(root.closest('li')!.querySelector('.ticon')).toBeNull()
    expect(currentLines(m)).toHaveLength(1)
    expect(currentLines(m)[0]).toBe(open.closest('li'))
    expect(open.closest('li')!.querySelector('.ticon')).not.toBeNull()

    // ⚑ The press: the piece a parent gave opens that parent; the root opens nothing.
    expect(open.tagName).toBe('BUTTON')
    expect(open.dataset.pressable).toBe('true')
    open.click()
    expect(opened).toEqual(['sess_parent'])
    root.click()
    expect(opened, 'the root was pressed and opened a conversation').toEqual(['sess_parent'])
    unmountAll()

    // ⛔ The control: the same piece, answered. Nothing else is open now, so the ROOT is the current
    // piece, and the answered piece is not — "never current" and "always current" both fail here.
    const closedCard = show(
      taking(piece(1, { state: 'answered', outcome: 'done', endedAt: NOW - 30_000 })),
      { named, goTo },
    )
    await drawnReady()
    const closed = await allTasks(closedCard)
    const rootNow = rootRow(closed)!
    expect(rootNow.closest('li')!.classList.contains('current')).toBe(true)
    expect(rootNow.closest('li')!.querySelector('.ticon')).not.toBeNull()
    expect(currentLines(closed)).toHaveLength(1)
    expect(currentLines(closed)[0]).toBe(rootNow.closest('li'))
    const done = pieceRows(closed)[0]!
    expect(labelOf(done)).toBe('W2.1')
    expect(done.closest('li')!.classList.contains('current')).toBe(false)
  })

  it('⛔ UI-008 · "All tasks" lists every piece, the root a person gave first — without a root, every piece alone', async () => {
    // The popup covers the whole history, with no five-line bound or earlier-piece count.
    const five = [1, 2, 3, 4, 5].map((k) => piece(k))
    const mCard = show(taking(...five), { named: { label: 'W2', title: 'Plan the week' } })
    await drawnReady()
    const m = await allTasks(mCard)
    const rows = m.all('cast-taken-work')
    expect(rows).toHaveLength(6)
    expect(rows[0]).toBe(rootRow(m))
    expect(pieceRows(m).map(labelOf)).toEqual(['W2.1', 'W2.2', 'W2.3', 'W2.4', 'W2.5'])
    expect(said(m.q('all-tasks-count'))).toBe('6 tasks')
    unmountAll()

    // ⛔ The control, the same five pieces and nobody's root: every piece, and no root line.
    const bareCard = show(taking(...five), { named: null })
    await drawnReady()
    const bare = await allTasks(bareCard)
    expect(rootRow(bare)).toBeNull()
    expect(pieceRows(bare).map(labelOf)).toEqual(['W2.1', 'W2.2', 'W2.3', 'W2.4', 'W2.5'])
    expect(said(bare.q('all-tasks-count'))).toBe('5 tasks')
  })

  it('⛔ UI-008 · only a root is the person’s — a piece a parent gave this conversation (W1.2) is not drawn as one, beside the root W1 which is', async () => {
    const opened: string[] = []
    const goTo = (conversation: string): void => {
      opened.push(conversation)
    }
    const sub = edge({ piece: 'work_12', label: 'W1.2', title: 'Sub task', state: 'working' })

    const m = show(taking(sub), { named: { label: 'W1.2', title: 'Sub task' }, goTo })
    await drawnReady()
    expect(
      m.host.querySelectorAll('[data-root="true"]'),
      'W1.2 was drawn as a person’s',
    ).toHaveLength(0)
    expect(m.all('cast-taken-work')).toHaveLength(1)
    const only = m.q('cast-taken-work')
    expect(only.tagName).toBe('BUTTON')
    expect(said(only)).toContain('W1.2')
    expect(said(only)).not.toContain('for you')
    only.click()
    expect(opened).toEqual(['sess_parent'])
    // ⚑ The piece is open, so the quiet box has nothing to say either.
    expect(m.all('card-task-empty')).toHaveLength(0)
    unmountAll()

    // ⛔ The control: the same taken piece, the conversation named by a root. The label's shape — one
    // number — decides it, not the presence of `named`.
    const rootCard = show(taking(sub), { named: { label: 'W1', title: 'Plan' }, goTo })
    await drawnReady()
    const root = await allTasks(rootCard)
    const person = rootRow(root)!
    expect(person, 'W1 drew no root line').not.toBeNull()
    expect(said(person.querySelector('.tnum')!)).toBe('W1')
    expect(said(person.querySelector('[data-cy="cast-work-to"]')!)).toBe('for you')
    const beside = pieceRows(root)
    expect(beside).toHaveLength(1)
    expect(beside[0]!.tagName).toBe('BUTTON')
    expect(labelOf(beside[0]!)).toBe('W1.2')
  })

  it('⛔ UI-008 · the box says one thing at a time — before the work given to it is read, a root is not drawn over “Nothing has been read about its work yet.”', async () => {
    const named = { label: 'W2', title: 'Plan the week' }
    const unread = show(null, { named })
    await drawnReady()
    const note = unread.q('card-task-unread')
    expect(visible(note)).toBe(true)
    expect(said(note)).toBe('Nothing has been read about its work yet.')
    expect(unread.all('cast-taken-work')).toHaveLength(0)
    expect(rootRow(unread)).toBeNull()
    expect(unread.all('card-task-empty')).toHaveLength(0)
    unmountAll()

    // ⛔ The control, the same conversation with its band read: the root is drawn and the note is not.
    const read = show(answer(), { named })
    await drawnReady()
    expect(rootRow(read), 'the root was not drawn once the work was read').not.toBeNull()
    expect(read.all('card-task-unread')).toHaveLength(0)
  })

  it('🔴 UI-008 · in the pane, the root a person gave reaches the open drawer’s card — ⛔ and a pane told of none draws the quiet box', async () => {
    const cast = useWhoCalledWhom()
    cast.reading.value = {
      conversation: META.sessionId,
      read: answer(),
      answered: true,
      atWork: null,
    }
    await page.viewport(1200, 808)
    const m = mount(
      ConversationPane,
      paneProps({
        drawerOpen: true,
        drawerTab: 'open',
        named: { label: 'W2', title: 'Plan the week' },
      }),
      { width: 1200, height: 808 },
    )
    await drawnReady()
    const row = rootRow(m)
    expect(row, 'the pane did not hand the work that names it to its drawer').not.toBeNull()
    expect(said(row!.querySelector('.tnum')!)).toBe('W2')
    expect(said(row!.querySelector('[data-cy="cast-work-to"]')!)).toBe('for you')
    expect(m.all('card-task-empty')).toHaveLength(0)
    unmountAll()

    // ⛔ The control, the same pane one fact over: nothing names the conversation.
    const none = mount(
      ConversationPane,
      paneProps({ drawerOpen: true, drawerTab: 'open', named: null }),
      { width: 1200, height: 808 },
    )
    await drawnReady()
    const empty = none.q('card-task-empty')
    expect(visible(empty)).toBe(true)
    expect(said(empty.querySelector('.says')!)).toBe('No current task')
    expect(none.host.querySelectorAll('[data-root]')).toHaveLength(0)
  })
})

describe('the word under the plate says what is owed it', () => {
  /** ⚑ The word the card draws under the plate for these facets, one fresh mount each. */
  function wordUnder(facets: AgentFacets): { m: Mounted; word: string } {
    unmountAll()
    const m = show(null, { facets })
    const el = m.q('session-bot-word')
    expect(visible(el), 'the word under the plate was not drawn').toBe(true)
    return { m, word: said(el) }
  }

  it('🔴 F051 · the word under the plate says “needs you” where a person is asked — with a card or without one — and keeps its own words where nobody is', async () => {
    // ⚑ A question passed up to a person: no card is drawn in this conversation, its turn has ended
    // and its DOING is idle — and the card used to say *idle* while the rail said a person owes it.
    const asked = wordUnder({ doing: 'idle', being: 'live', waiting: 'waiting-on-a-person' })
    expect(asked.word).toBe('needs you')
    expect(
      asked.m.all('panel-questions'),
      'a card was drawn for a question passed up',
    ).toHaveLength(0)
    expect(asked.m.all('panel-permissions')).toHaveLength(0)

    // ⚑ A permission or a question held here is named after what it is — over a busy DOING too.
    expect(wordUnder({ doing: 'tool', being: 'live', needing: 'permission' }).word).toBe(
      'needs you: permission',
    )
    expect(wordUnder({ doing: 'idle', being: 'live', needing: 'question' }).word).toBe(
      'needs you: question',
    )
    // ⛔ A go-ahead blocks nothing, so beside a person's wait it is not named.
    expect(
      wordUnder({
        doing: 'idle',
        being: 'live',
        needing: 'plan',
        waiting: 'waiting-on-a-person',
      }).word,
    ).toBe('needs you')

    // ⛔ The controls, the same card one fact over — nobody owes a person's answer, so it keeps the
    // words it had. A word that said *needs you* for all of them would pass every line above.
    expect(wordUnder({ doing: 'idle', being: 'live' }).word).toBe('idle')
    expect(wordUnder({ doing: 'idle', being: 'live', needing: 'plan' }).word).toBe('idle')
    // ⚑ Another agent's wait keeps its own words: nobody at this machine can move it along.
    expect(wordUnder({ doing: 'idle', being: 'live', waiting: 'waiting-on-a-worker' }).word).toBe(
      'waiting on a worker',
    )
  })
})

describe('the agent card says what its process holds', () => {
  const MIB = 1024 ** 2

  it('⚑ D-018 · the run strip draws the memory of a conversation whose process runs, and of no other', async () => {
    const cast = useWhoCalledWhom()
    const memoryOf = (host: HTMLElement): HTMLElement | null =>
      host.querySelector<HTMLElement>('[data-cy="card-run-memory"]')

    // ⛔ Another conversation's figure is not this one's.
    cast.processMemory.value = new Map([['sess_other', 900 * MIB]])
    const other = show(null)
    await drawnReady()
    expect(visible(other.q('session-bot')), 'the card did not draw').toBe(true)
    expect(memoryOf(other.host)).toBeNull()
    unmountAll()

    // ⛔ …and nor is the absence of any figure.
    cast.processMemory.value = new Map()
    const empty = show(null)
    await drawnReady()
    expect(visible(empty.q('session-bot')), 'the card did not draw').toBe(true)
    expect(memoryOf(empty.host)).toBeNull()
    unmountAll()

    // ⚑ The control, the same card one fact over: the map holds THIS conversation.
    cast.processMemory.value = new Map([[META.sessionId, 300 * MIB]])
    const mine = show(null)
    await drawnReady()
    const item = memoryOf(mine.host)!
    expect(item, 'a running process drew no memory figure').not.toBeNull()
    expect(visible(item)).toBe(true)
    expect(said(item)).toBe('300 MB')
    expect(item.getAttribute('title')).toBe(
      'Memory held by its agent process. The commands it runs are not counted.',
    )
    unmountAll()

    // ⚑ A measured zero is a figure; an absent one is not.
    cast.processMemory.value = new Map([[META.sessionId, 0]])
    const zero = show(null)
    await drawnReady()
    expect(said(memoryOf(zero.host)!)).toBe('0 MB')
  })
})

describe('the way up keeps to the panel', () => {
  const LONG =
    'Project manager for slice five of the booking engine migration, the data cutover and the whole of the release week'

  /** ⚑ The way up, drawn: a conversation whose parent is `sess_parent`, running as `parentIdentity`. */
  function climbing(
    roster: readonly AgentIdentity[],
    parentIdentity: string,
    opened: string[],
  ): Mounted {
    return show(
      answer({
        parent: spawn({
          conversation: 'sess_parent',
          identity: parentIdentity,
          running: 'in-a-window',
        }),
      }),
      {
        width: DRAWER_W_MIN,
        identities: roster,
        goTo: (conversation) => {
          opened.push(conversation)
        },
      },
    )
  }

  it('🔴 f1fa1e2e · at 320 px the way up keeps to the panel — a long parent name gives way with an ellipsis of its own and tells itself whole; a short one is drawn in full', async () => {
    expect(LONG.length).toBeGreaterThanOrEqual(100)
    const opened: string[] = []
    const m = climbing([identity('project-manager', LONG)], 'project-manager', opened)
    await drawnReady()

    const name = m.q('came-from-name')
    const pill = m.q('came-from-open')
    const panel = m.q('session-panel')
    expect(visible(pill), 'the way up was not drawn').toBe(true)
    expect(said(name)).toBe(LONG)

    // ⛔ **The name's OWN box is what cuts it.** A bare "cut and told" would pass on the panel's clip
    // (`.session-panel { overflow: hidden }` cuts anything that runs past the pill, and the title
    // recovers it), so the clipper is named: the name's ellipsis, on x, and nothing outside it.
    const cuts = cutsOf(name, m.host)
    expect(cuts, 'the long name was drawn in full, so nothing here was measured').toHaveLength(1)
    expect(cuts[0]!.axis).toBe('x')
    expect(cuts[0]!.by, 'the name ran past its own box and a box outside it cut it').toBe(name)
    expect(titleRecovers(name, m.host)).toBe(true)
    expect(name.title).toBe(LONG)

    // ⚑ The pill stays inside the panel, and the panel does not scroll sideways.
    expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(
      panel.getBoundingClientRect().right + 0.5,
    )
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    expect(pill.title).toBe(`Up to ${LONG}`)
    expect(pill.querySelector('.came-up use')!.getAttribute('href')).toBe('#i-up')
    pill.click()
    expect(opened).toEqual(['sess_parent'])

    // ⚑ **The sensor can tell the two apart, on this very row.** Let the name stop being a clipper and
    // its ink runs on past the pill, so the box that cuts it is the panel's — which is what the
    // clipper-identity assertion above refuses. ⛔ Without this, "the name cut itself" and "the panel
    // cut the name" could be one reading.
    name.style.overflow = 'visible'
    const outside = cutsOf(name, m.host)
    expect(outside.length, 'the name no longer ran past anything').toBeGreaterThan(0)
    expect(outside.map((cut) => cut.by)).not.toContain(name)
    expect(outside.map((cut) => cut.by)).toContain(panel)
    unmountAll()

    // ⛔ The control, the same row one fact over: a short name. It is drawn in full, so the cut above
    // is the long name's and not the row's.
    const shortOpened: string[] = []
    const calm = climbing([identity('default', 'BroBot')], 'default', shortOpened)
    await drawnReady()
    const brobot = calm.q('came-from-name')
    expect(said(brobot)).toBe('BroBot')
    assertDrawn(brobot, 'the short parent name', calm.host)
    expect(cutsOf(brobot, calm.host)).toEqual([])
    const back = calm.q('came-from-open')
    expect(back.title).toBe('Up to BroBot')
    expect(visible(back)).toBe(true)
    const calmPanel = calm.q('session-panel')
    expect(back.getBoundingClientRect().right).toBeLessThanOrEqual(
      calmPanel.getBoundingClientRect().right + 0.5,
    )
    back.click()
    expect(shortOpened).toEqual(['sess_parent'])
  })
})
