import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { ForestView } from '../../src/renderer/src/lib/the-forest'
import type { AgentIdentity, KeptFile, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { SpawnEdge, WorkEdge } from '../../src/shared/who-called-whom'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * The conversation and graph share one selected conversation. The graph keeps the whole tree
 * containing that conversation, including its root, siblings and deeper descendants. Generations
 * run left to right and exclude unrelated roots; the Team graph still shows all trees.
 * Switching tabs hides the transcript rather than unmounting it, and selecting a descendant keeps
 * the graph tab while updating the right panel and its way up.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.goTo.value = null
  cast.reading.value = null
  cast.railSays.value = null
  cast.processMemory.value = new Map()
  cast.treeFiles.value = null
})

const ID = META.sessionId

/** ⚑ The names the forest and the band give each identity. */
const IDS = [
  ['brobot', 'BroBot'],
  ['project-manager', 'Ada'],
  ['inspector', 'Ana'],
  ['dev', 'Arjun'],
  ['tester', 'Amara'],
  ['writer', 'Ayo'],
].map(([slug, displayName]) => ({
  id: `aid:${slug}`,
  slug,
  displayName,
})) as unknown as AgentIdentity[]

/** ⚑ BroBot at the top, this conversation under it, two kids under this one, and one more root. */
const FOREST = (): ForestView =>
  viewOf(
    [
      conv('sess_boss', null, { identity: 'brobot' }),
      conv(ID, 'sess_boss', { identity: 'project-manager' }),
      conv('sess_ana', ID, { identity: 'inspector' }),
      conv('sess_arjun', ID, { identity: 'dev' }),
      task('sess_ana', 'work_1', 'W1.1', 'Inspect the window states', ID),
      task('sess_arjun', 'work_2', 'W1.2', 'Fix the rail row', ID),
      conv('sess_amara', 'sess_arjun', { identity: 'tester' }),
      conv('sess_other', null, { identity: 'writer' }),
    ],
    IDS,
  )

const said = (text: string): TranscriptEvent =>
  ({ type: 'assistant_message', text }) as unknown as TranscriptEvent

async function show(forest: ForestView | null): Promise<Mounted> {
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({
      record: record([said('Checking the rail now.')]),
      drawerOpen: true,
      forest,
      identities: IDS,
    }),
    { width: 1200, height: 808 },
  )
  await nextTick()
  return m
}

async function toGraph(m: Mounted): Promise<void> {
  m.q('main-tab-graph').click()
  await forestDrawn()
}

const card = (m: Mounted, id: string): HTMLElement => m.q(`forest-row-${id}`)

/** ⚑ Press a node of the graph, as a person would. */
async function press(m: Mounted, id: string): Promise<void> {
  card(m, id).querySelector<HTMLButtonElement>('[data-cy="forest-open"]')!.click()
  await nextTick()
}

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

/** ⚑ Arjun's own who-called-whom — what the screen's poll reads once Arjun is selected. */
const arjunRead = () => {
  const now = Date.now()
  const piece = (over: Partial<WorkEdge>): WorkEdge => ({
    piece: 'work_2',
    label: 'W1.2',
    title: 'Fix the rail row',
    from: ID,
    fromIdentity: 'project-manager',
    to: 'sess_arjun',
    toIdentity: 'dev',
    state: 'working',
    givenAt: now - 60_000,
    endedAt: null,
    ...over,
  })
  const spawn = (conversation: string, identity: string): SpawnEdge => ({
    conversation,
    identity,
    provider: 'claude',
    running: 'unwatched',
  })
  return {
    conversation: 'sess_arjun',
    answered: true,
    atWork: null,
    read: {
      conversation: 'sess_arjun',
      parent: spawn(ID, 'project-manager'),
      children: walk(
        [spawn('sess_amara', 'tester'), spawn('sess_ghost', 'tester')],
        'every-conversation-this-one-spawned',
      ),
      workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
      workTakenIn: walk([piece({})], 'every-piece-of-work-this-one-was-given'),
      readAt: now,
    },
  }
}

/** ⚑ Each conversation's agent, as its record's `meta` names it. */
const PROFILE_OF: Readonly<Record<string, string>> = {
  [ID]: 'project-manager',
  sess_boss: 'brobot',
  sess_ana: 'inspector',
  sess_arjun: 'dev',
  sess_amara: 'tester',
  sess_other: 'writer',
}

/** ⚑ The record the screen hands the pane for a conversation it opened — its newest line last. */
function recordOf(conversation: string, lines = 1): ReturnType<typeof record> {
  const earlier = Array.from({ length: lines - 1 }, (_, n) => said(`${conversation} line ${n}.`))
  const opened = record([...earlier, said(`${conversation} speaking.`)], conversation)
  opened.meta = { ...META, sessionId: conversation, profileId: PROFILE_OF[conversation]! }
  return opened
}

/** ⚑ A conversation's own who-called-whom, spawned by `parent` — or by nobody, a person's own. */
const readOf = (conversation: string, parent: string | null, children: string[] = []) => ({
  conversation,
  answered: true,
  atWork: null,
  read: {
    conversation,
    parent:
      parent === null
        ? null
        : {
            conversation: parent,
            identity: PROFILE_OF[parent]!,
            provider: 'claude' as const,
            running: 'unwatched' as const,
          },
    children: walk<SpawnEdge>(
      children.map((child) => ({
        conversation: child,
        identity: PROFILE_OF[child]!,
        provider: 'claude',
        running: 'unwatched',
      })),
      'every-conversation-this-one-spawned',
    ),
    workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
    workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
    readAt: Date.now(),
  },
})

/**
 * ⚑ **The pane as the screen drives it** — a selection goes through `cast.goTo`, and the screen hands
 * the pane that conversation's record: ONE pane, reused (the screen mounts it with no key).
 */
async function selecting(over: Record<string, unknown> = {}, lines = 1) {
  const opened: string[] = []
  const state = shallowReactive(
    paneProps({
      record: recordOf(ID, lines),
      drawerOpen: true,
      forest: FOREST(),
      identities: IDS,
      ...over,
    }),
  )
  const Wrapper = defineComponent({ setup: () => () => h(ConversationPane, state as never) })
  await page.viewport(1200, 808)
  useWhoCalledWhom().goTo.value = (conversation) => {
    opened.push(conversation)
    state.record = recordOf(conversation, lines)
  }
  const m = mount(Wrapper, {}, { width: 1200, height: 808 })
  await nextTick()
  return { m, opened }
}

const kept = (piece: string): KeptFile => ({
  resourceId: `res_${piece}`,
  title: piece,
  name: `${piece}.md`,
  form: 'markdown',
  bytes: 10,
  role: 'made',
  keptAt: 1,
  sha256: piece.padEnd(64, '0'),
  addedBy: null,
  piece,
  label: 'W1.2',
  pieceTitle: null,
})

describe('the main panel shows the conversation, or its whole tree', () => {
  it('🔴 two tabs over the conversation — and the graph hides it, never unmounts it', async () => {
    const m = await show(FOREST())
    const tabs = m.q('main-tabs')
    expect(
      [...tabs.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    ).toEqual(['Conversation', 'Graph', 'Files'])
    expect(m.q('main-tab-conversation').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('main-conversation'))).toBe(true)
    expect(m.all('conversation-graph')).toHaveLength(0)
    const transcript = m.q('transcript')
    await toGraph(m)
    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('conversation-graph'))).toBe(true)
    expect(visible(m.q('main-conversation'))).toBe(false)
    // ⛔ The same transcript element, hidden — not a new one when the tab comes back.
    expect(m.q('transcript')).toBe(transcript)
    m.q('main-tab-conversation').click()
    await nextTick()
    expect(visible(m.q('main-conversation'))).toBe(true)
    expect(m.all('conversation-graph')).toHaveLength(0)
    // ⚑ The right panel stays beside it on both tabs.
    expect(visible(m.q('session-drawer'))).toBe(true)
  })

  it('🔴 the graph shows this conversation’s whole tree, with this conversation outlined', async () => {
    const m = await show(FOREST())
    await toGraph(m)
    expect(m.q('conversation-graph').contains(m.q('team-forest'))).toBe(true)
    // Its root and all descendants, including a grandchild; the other root stays out.
    for (const id of ['sess_boss', ID, 'sess_ana', 'sess_arjun', 'sess_amara'])
      expect(card(m, id), id).toBeTruthy()
    expect(m.all('forest-row-sess_other')).toHaveLength(0)
    // ⚑ This conversation, outlined; no other.
    expect(card(m, ID).dataset.current).toBe('true')
    expect(card(m, 'sess_ana').dataset.current).toBe('false')
    // Generations run left to right; each piece stays under the card that owns it.
    expect(card(m, 'sess_boss').getBoundingClientRect().right).toBeLessThan(
      card(m, ID).getBoundingClientRect().left,
    )
    expect(card(m, ID).getBoundingClientRect().right).toBeLessThan(
      card(m, 'sess_ana').getBoundingClientRect().left,
    )
    expect(card(m, 'sess_ana').querySelector('[data-cy="forest-row-work_1"]')).not.toBeNull()
    expect(card(m, 'sess_arjun').querySelector('[data-cy="forest-row-work_1"]')).toBeNull()
  })

  /**
   * Selecting a graph card changes the right panel to that agent and selects its conversation
   * for the Conversation tab.
   */
  it('🔴 UI-006 · the person presses Arjun on the Graph: the Graph stays with Arjun outlined, the right panel is Arjun’s card with ↑ Ada, and Conversation shows Arjun’s conversation', async () => {
    const cast = useWhoCalledWhom()
    cast.treeFiles.value = { conversation: ID, files: [kept('work_9')], answered: true }
    const { m, opened } = await selecting()
    // ⚑ Ada's own read is on screen, and says her way up — and it is still there, the last read
    // the screen took, when Arjun is pressed (a read lands a round trip after a selection).
    cast.reading.value = readOf(ID, 'sess_boss')
    await nextTick()
    expect(m.q('came-from-name').textContent?.trim()).toBe('BroBot')
    await toGraph(m)
    await press(m, 'sess_arjun')
    await forestDrawn()
    expect(opened).toEqual(['sess_arjun'])
    // The Graph stays on screen with the same whole tree and only Arjun outlined.
    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
    expect(card(m, 'sess_arjun').dataset.current).toBe('true')
    expect(card(m, ID).dataset.current).toBe('false')
    for (const id of ['sess_boss', ID, 'sess_ana', 'sess_arjun', 'sess_amara'])
      expect(m.all(`forest-row-${id}`), id).toHaveLength(1)
    expect(m.all('forest-row-sess_other')).toHaveLength(0)
    // ⚑ The right panel is Arjun's card. ⛔ Before his read lands his work is NOT READ, and no way
    // up is drawn yet — never *No current task*.
    expect(m.q('session-bot-name').textContent?.trim()).toBe('Arjun')
    expect(visible(m.q('card-task-unread'))).toBe(true)
    expect(m.all('card-task-empty')).toHaveLength(0)
    expect(m.all('panel-came-from')).toHaveLength(0)
    // ⚑ …and once it lands: ↑ Ada, and his current task.
    cast.reading.value = arjunRead()
    await nextTick()
    expect(m.q('came-from-name').textContent?.trim()).toBe('Ada')
    expect(m.q('cast-taken-work').textContent).toContain('W1.2')
    // ⚑ …at the TOP of the right panel: above his card and his current task.
    const up = m.q('panel-came-from').getBoundingClientRect()
    expect(up.bottom).toBeLessThanOrEqual(m.q('session-bot').getBoundingClientRect().top)
    expect(up.bottom).toBeLessThanOrEqual(m.q('card-task').getBoundingClientRect().top)
    // ⛔ No *Back to …* and no *Open conversation*: selecting is opening.
    const drawer = m.q('session-drawer').textContent ?? ''
    expect(drawer).not.toContain('Back to')
    expect(drawer).not.toContain('Open conversation')
    // ⚑ Files follows: Ada's tree is not Arjun's, so nothing is counted until his is read.
    expect(m.all('main-tab-files-count')).toHaveLength(0)
    cast.treeFiles.value = { conversation: 'sess_arjun', files: [kept('work_2')], answered: true }
    await nextTick()
    expect(m.q('main-tab-files-count').textContent?.trim()).toBe('(1)')
    // ⚑ Conversation shows Arjun's conversation, not Ada's.
    m.q('main-tab-conversation').click()
    await nextTick()
    expect(m.q('main-conversation').textContent).toContain('sess_arjun speaking.')
    expect(m.q('main-conversation').textContent).not.toContain(`${ID} speaking.`)
  })

  it('🔴 a conversation selected on the Graph opens at its NEWEST line when the Conversation tab is shown', async () => {
    const { m } = await selecting({}, 60)
    // ⚑ The transcript is its own scroller (`useStickToBottom`'s element).
    const scroller = () => m.q('transcript')
    const gap = () => {
      const node = scroller()
      return node.scrollHeight - node.scrollTop - node.clientHeight
    }
    // ⚑ The premise: this conversation, on its own tab, is long enough to scroll, and is at its end.
    expect(scroller().scrollHeight).toBeGreaterThan(scroller().clientHeight * 2)
    expect(gap()).toBeLessThanOrEqual(40)
    await toGraph(m)
    await press(m, 'sess_arjun')
    await forestDrawn()
    // ⚑ Arjun's conversation mounted while the Graph was on screen — shown now, at its newest line.
    m.q('main-tab-conversation').click()
    await forestDrawn()
    expect(m.q('main-conversation').textContent).toContain('sess_arjun speaking.')
    expect(gap()).toBeLessThanOrEqual(40)
  })

  it('🔴 a chip selects its agent and ↑ selects the parent — ⛔ a conversation a person started draws no ↑', async () => {
    const cast = useWhoCalledWhom()
    const { m, opened } = await selecting()
    await toGraph(m)
    await press(m, 'sess_arjun')
    cast.reading.value = readOf('sess_arjun', ID, ['sess_amara'])
    await nextTick()
    // ⚑ A sub agent's chip selects it.
    m.q('cast-children-strip')
      .querySelector<HTMLButtonElement>('button[data-conversation="sess_amara"]')!
      .click()
    await nextTick()
    expect(opened).toEqual(['sess_arjun', 'sess_amara'])
    expect(m.q('session-bot-name').textContent?.trim()).toBe('Amara')
    // ⚑ ↑ selects the parent, all the way up: Amara → Arjun → Ada → BroBot.
    const up = async (from: string, parent: string, name: string) => {
      cast.reading.value = readOf(from, parent)
      await nextTick()
      expect(m.q('came-from-name').textContent?.trim(), `${from}'s way up`).toBe(name)
      m.q('came-from-open').click()
      await nextTick()
      expect(opened.at(-1)).toBe(parent)
    }
    await up('sess_amara', 'sess_arjun', 'Arjun')
    await up('sess_arjun', ID, 'Ada')
    await up(ID, 'sess_boss', 'BroBot')
    expect(m.q('session-bot-name').textContent?.trim()).toBe('BroBot')
    // ⛔ BroBot's conversation was started by a person: no way up — one step after Ada's drew one.
    cast.reading.value = readOf('sess_boss', null)
    await nextTick()
    expect(m.all('panel-came-from')).toHaveLength(0)
    // ⚑ And the Graph stayed on screen through every selection, outlining the last.
    await forestDrawn()
    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
    expect(card(m, 'sess_boss').dataset.current).toBe('true')
  })

  it('🔴 a press opens the drawer on its Open tab — any node, this conversation’s own included', async () => {
    const tabs: string[] = []
    let flips = 0
    const opened: string[] = []
    useWhoCalledWhom().reading.value = readOf(ID, 'sess_boss')
    // ⚑ Props the test can move, so the drawer can be opened the way the screen opens it.
    const state = shallowReactive(
      paneProps({
        record: record([said('Checking the rail now.')]),
        drawerOpen: false,
        drawerTab: 'events',
        forest: FOREST(),
        identities: IDS,
        'onUpdate:drawerTab': (tab: string) => tabs.push(tab),
        onToggleDrawer: () => {
          flips += 1
        },
      }),
    )
    const Wrapper = defineComponent({ setup: () => () => h(ConversationPane, state as never) })
    await page.viewport(1200, 808)
    useWhoCalledWhom().goTo.value = (conversation) => opened.push(conversation)
    const m = mount(Wrapper, {}, { width: 1200, height: 808 })
    await nextTick()
    await toGraph(m)
    await press(m, 'sess_arjun')
    expect(tabs).toEqual(['open'])
    expect(flips).toBe(1)
    // ⚑ The conversation on screen's own node raises its card the same way — ⛔ and asks the door
    // for nothing, since it is selected already; the press beside it did.
    await press(m, ID)
    expect(tabs).toEqual(['open', 'open'])
    expect(opened).toEqual(['sess_arjun'])
    expect(flips).toBe(2)
    // ⚑ The screen answers both: the drawer is open, on its Open tab, where the way up is drawn.
    state.drawerOpen = true
    state.drawerTab = 'open'
    await nextTick()
    expect(visible(m.q('came-from-open'))).toBe(true)
    // ⛔ The pair on the same mount: the way up on the right panel selects too, and leaves the
    // drawer be.
    m.q('came-from-open').click()
    await nextTick()
    expect(opened).toEqual(['sess_arjun', 'sess_boss'])
    expect(tabs).toEqual(['open', 'open'])
    expect(flips).toBe(2)
    // ⛔ …and a node pressed with the drawer already open SETS the tab and never flips it shut
    // (`318` §2.3).
    await press(m, 'sess_arjun')
    expect(tabs).toEqual(['open', 'open', 'open'])
    expect(flips).toBe(2)
  })

  it('🔴 D-018 · the card says the memory of the SELECTED agent’s process', async () => {
    const MB = 1024 ** 2
    useWhoCalledWhom().processMemory.value = new Map([
      [ID, 300 * MB],
      ['sess_arjun', 1536 * MB],
    ])
    const { m } = await selecting()
    const memory = () =>
      m.q('session-panel').querySelector('[data-cy="card-run-memory"]')?.textContent?.trim()
    // ⛔ THE CONTROL — before a selection the card is this conversation's, and so is its figure.
    expect(memory()).toBe('300 MB')
    await toGraph(m)
    await press(m, 'sess_arjun')
    expect(memory()).toBe('1.5 GB')
  })

  it('🔴 a row shown from the right panel brings the conversation back first', async () => {
    const m = await show(FOREST())
    await toGraph(m)
    const row = m.host.querySelector<HTMLElement>('.entry[data-item]')!
    expect((m.vm.focus as (itemId: string) => boolean)(row.dataset.item!)).toBe(true)
    await nextTick()
    expect(m.q('main-tab-conversation').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('main-conversation'))).toBe(true)
  })

  it('⛔ THE CONTROL — a forest not read yet draws one quiet line, never an empty tree', async () => {
    const m = await show(null)
    await toGraph(m)
    expect(visible(m.q('forest-not-read'))).toBe(true)
    expect(m.all('forest-rows')).toHaveLength(0)
  })
})
