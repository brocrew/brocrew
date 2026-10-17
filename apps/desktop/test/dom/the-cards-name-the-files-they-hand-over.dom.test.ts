import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import FileRows from '../../src/renderer/src/components/FileRows.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { clockTime } from '../../src/shared/clock'
import type {
  AgentIdentity,
  KeptFile,
  ResourceReading,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ The cards where files change hands name each file, one row each
 *
 * The give card lists its inputs; the reply card lists returned files. Each row carries
 * title, name, size, who, when, and `input` or `made`, with a press opening the viewer.
 * Resolve `TheCast.treeFiles` by id for replies and by piece label for gives.
 *
 * ⚑ **What is pinned here**: the give's inputs on the giver's card, and on the receiver's brief; the
 * files a reply handed back on the giver's report card, and on the replier's own card; a file the
 * tree has not read yet keeps the press the card drew before (`510`), and a card with no files
 * read draws exactly what it drew before; a press opens the pane's one viewer, and with no reader
 * the rows are words; and a title or a name longer than its row is cut and told whole.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — the tree read and not,
 * a file read and one not yet, a reader and none — because a card that drew no rows at all would
 * pass every absence.
 */

afterEach(async () => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.treeFiles.value = null
  cast.reading.value = null
  await page.viewport(1200, 808)
})

const AT = new Date(2026, 8, 30, 19, 34).getTime()

const kept = (over: Partial<KeptFile> & Pick<KeptFile, 'resourceId' | 'label'>): KeptFile => ({
  title: 'Input for test 2 and 5',
  name: 'w1.3.1-input.md',
  form: 'markdown',
  bytes: 70,
  role: 'input',
  keptAt: AT,
  sha256: over.resourceId.padEnd(64, '0'),
  addedBy: { conversation: META.sessionId, name: 'BroBot', identity: 'brobot' },
  piece: `work_${over.label}`,
  pieceTitle: null,
  ...over,
})

const INVENTORY: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [
      { name: 'give_work', description: '', parameters: [] },
      { name: 'reply_to_parent', description: '', parameters: [] },
    ],
  },
  published: null,
} as unknown as TranscriptEvent

const IDS = [{ id: 'aid:dev', slug: 'dev', displayName: 'Ayo' }] as unknown as AgentIdentity[]

/** ⚑ This conversation gives W1.2 to Ayo. */
const GIVES: TranscriptEvent[] = [
  INVENTORY,
  { type: 'user_turn', text: 'have Ayo fix the rail' },
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__give_work',
    summary: JSON.stringify({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: 'Fix the rail',
      brief: 'Make them agree.',
    }),
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'c1',
    summary: 'W1.2 given to Ayo (dev); it went to Ayo straight away.',
    ok: true,
  } as TranscriptEvent,
]

/** ⚑ This conversation is GIVEN W1.3 by BroBot. */
const GIVEN: TranscriptEvent[] = [
  {
    type: 'user_turn',
    text: 'Test 2 and 5, with the input attached.',
    relayedFrom: 'sess_brobot',
    relayedFromProfile: 'brobot',
    piece: 'work_3',
    label: 'W1.3',
  } as TranscriptEvent,
  {
    type: 'work_given',
    piece: 'work_3',
    label: 'W1.3',
    parent: 'work_1',
    givenBy: 'sess_brobot',
    title: 'Test 2 and 5',
    brief: 'Test 2 and 5, with the input attached.',
  } as TranscriptEvent,
]

const report = (resources: string[]): WorkReport =>
  ({
    piece: 'work_4',
    label: 'W1.4',
    owner: 'sess_worker',
    state: 'answered',
    outcome: 'done',
    resources,
  }) as WorkReport

/** ⚑ Ali's reply to W1.4 lands here, handing back two files. */
const ANSWERED: TranscriptEvent[] = [
  {
    type: 'user_turn',
    attribution: 'app_authored',
    text: 'W1.4 was answered: done.',
    work: report(['res_found', 'res_later']),
  } as TranscriptEvent,
]

/** ⚑ This conversation replies to W1.3, handing back one file. */
const REPLIES: TranscriptEvent[] = [
  INVENTORY,
  ...GIVEN,
  {
    type: 'tool_call',
    id: 'call_reply',
    name: 'mcp__brobot__reply_to_parent',
    summary: JSON.stringify({ piece: 'W1.3', outcome: 'done', summary: 'Both pass.' }),
  } as TranscriptEvent,
  {
    type: 'work_replied',
    piece: 'work_3',
    outcome: 'done',
    summary: 'Both pass.',
    resources: ['res_result', 'res_later'],
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'call_reply',
    ok: true,
    summary: 'W1.3 answered · sent',
  } as TranscriptEvent,
]

/** ⚑ The door ECHOES the id it was asked for, so the viewer says which file the press sent. */
const OPENS = async (resourceId: string): Promise<ResourceReading> => ({
  ok: true,
  form: 'markdown',
  resourceId,
  name: `${resourceId}.md`,
  text: '# A file',
  bytes: 8,
})

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

async function pane(
  events: TranscriptEvent[],
  files: readonly KeptFile[] | null,
  over: Record<string, unknown> = {},
): Promise<Mounted> {
  useWhoCalledWhom().treeFiles.value =
    files === null ? null : { conversation: META.sessionId, files, answered: true }
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({
      record: record(events),
      identities: IDS,
      held: [],
      onReadResource: OPENS,
      ...over,
    }),
    { width: 1180, height: 780 },
  )
  await drawnReady()
  return expandAgentCards(m)
}

const rowsIn = (card: Element): HTMLElement[] => [
  ...card.querySelectorAll<HTMLElement>('[data-cy="file-row"]'),
]

/** ⚑ Ali's report file, the one of the two the tree has read. */
const FOUND = kept({
  resourceId: 'res_found',
  label: 'W1.4',
  role: 'made',
  title: 'Open findings',
  name: 'open-findings.md',
  bytes: 2_048,
  addedBy: { conversation: 'sess_worker', name: 'Ali', identity: 'ali' },
})

const edge = (label: string, givenAt: number): WorkEdge => ({
  piece: `work_${label}`,
  label,
  title: label,
  from: 'sess_brobot',
  fromIdentity: 'brobot',
  to: META.sessionId,
  toIdentity: 'dev',
  state: 'working',
  givenAt,
  endedAt: null,
})

/** ⚑ The cast's reading of this conversation: what it gave, and what it was given, and when. */
function castWith(gave: WorkEdge[], took: WorkEdge[]): void {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  useWhoCalledWhom().reading.value = {
    conversation: META.sessionId,
    read: {
      conversation: META.sessionId,
      parent: null,
      children: walk([], 'every-conversation-this-one-spawned'),
      workGivenOut: walk(gave, 'every-conversation-this-one-gave-work-to'),
      workTakenIn: walk(took, 'every-piece-of-work-this-one-was-given'),
      readAt: AT,
    },
    answered: true,
    atWork: null,
  }
}

async function opens(m: Mounted, row: HTMLElement, name: string): Promise<void> {
  expect(row.tagName).toBe('BUTTON')
  row.click()
  await nextTick()
  await nextTick()
  expect(visible(m.q('canonical-document-viewer'))).toBe(true)
  expect(m.q('canonical-document-name').textContent?.trim()).toBe(name)
}

describe('the cards where files change hands name each file', () => {
  it('🔴 the give card lists the inputs kept on its piece — under the brief, in the door’s order, each its title, input, and name · size · who · time', async () => {
    const m = await pane(GIVES, [
      kept({ resourceId: 'res_in', label: 'W1.2' }),
      // ⛔ Another piece's input, and this piece's MADE file: neither is an input this give handed over.
      kept({ resourceId: 'res_other', label: 'W1.9' }),
      kept({ resourceId: 'res_made', label: 'W1.2', role: 'made', title: 'Ayo’s fix' }),
      kept({ resourceId: 'res_in_z', label: 'W1.2', name: 'z.md' }),
      kept({ resourceId: 'res_in_b', label: 'W1.2', name: 'b.md' }),
    ])
    const card = m.q('outgoing')
    const rows = rowsIn(card)
    expect(rows.map((row) => row.dataset.document)).toEqual(['res_in', 'res_in_z', 'res_in_b'])
    const row = rows[0]!
    expect(read(row.querySelector('.title')!)).toBe('Input for test 2 and 5')
    expect(read(row.querySelector('.role')!)).toBe('input')
    const meta = row.querySelector('.meta')!
    expect(read(meta)).toBe(`w1.3.1-input.md · 70 B · BroBot · ${clockTime(AT)}`)
    // ⚑ …and the day on its title, as every other clock time in the window carries it.
    expect(meta.getAttribute('title')).toBe(`${read(meta)} (${fullTime(AT)})`)
    // ⚑ Under the brief, inside the card.
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      m.q('outgoing-message').getBoundingClientRect().bottom,
    )
    assertDrawn(row.querySelector<HTMLElement>('.title')!, 'the input’s title', m.host)
    unmountAll()
    // ⛔ The pair: the same give with the tree not read draws the card and no row.
    const unread = await pane(GIVES, null)
    expect(read(unread.q('outgoing-task'))).toBe('W1.2')
    expect(unread.all('file-row')).toHaveLength(0)
  })

  it('⛔ a give lists what was handed over WITH it — an input its giver added to the piece later is not its', async () => {
    const files = [
      kept({ resourceId: 'res_in', label: 'W1.2' }),
      kept({ resourceId: 'res_added', label: 'W1.2', keptAt: AT + 60_000, title: 'Added later' }),
    ]
    castWith([edge('W1.2', AT)], [])
    const m = await pane(GIVES, files)
    expect(rowsIn(m.q('outgoing')).map((row) => row.dataset.document)).toEqual(['res_in'])
    unmountAll()
    // ⚑ The pair: both kept with the give, both listed.
    castWith([edge('W1.2', AT + 60_000)], [])
    const both = await pane(GIVES, files)
    expect(rowsIn(both.q('outgoing')).map((row) => row.dataset.document)).toEqual([
      'res_in',
      'res_added',
    ])
  })

  it('🔴 the brief a conversation was given lists the inputs kept with it, and a press opens one — ⛔ with no reader they are words', async () => {
    const files = [
      kept({ resourceId: 'res_brief', label: 'W1.3' }),
      kept({ resourceId: 'res_brief_2', label: 'W1.3', name: 'second.md' }),
      kept({ resourceId: 'res_later', label: 'W1.3', keptAt: AT + 60_000 }),
    ]
    castWith([], [edge('W1.3', AT)])
    const m = await pane(GIVEN, files)
    const card = m.q('relayed')
    expect(read(m.q('relayed-task'))).toContain('W1.3')
    expect(rowsIn(card).map((row) => row.dataset.document)).toEqual(['res_brief', 'res_brief_2'])
    await opens(m, rowsIn(card)[0]!, 'res_brief.md')
    unmountAll()
    castWith([], [edge('W1.3', AT)])
    const words = await pane(GIVEN, files, { onReadResource: undefined })
    const plain = rowsIn(words.q('relayed'))
    expect(plain.map((row) => row.tagName)).toEqual(['DIV', 'DIV'])
    expect(read(plain[0]!.querySelector('.title')!)).toBe('Input for test 2 and 5')
    unmountAll()
    const unread = await pane(GIVEN, null)
    expect(read(unread.q('relayed-message'))).toBe('Test 2 and 5, with the input attached.')
    expect(unread.all('file-row')).toHaveLength(0)
  })

  it('🔴 the report card draws a row for each file the tree read, and a press opens it — ⛔ one not read yet keeps its press', async () => {
    const m = await pane(ANSWERED, [FOUND])
    const card = m.q('work-report')
    expect(rowsIn(card).map((row) => row.dataset.document)).toEqual(['res_found'])
    expect(read(rowsIn(card)[0]!.querySelector('.meta')!)).toBe(
      `open-findings.md · 2 KB · Ali · ${clockTime(AT)}`,
    )
    expect(read(rowsIn(card)[0]!.querySelector('.role')!)).toBe('made')
    const presses = m.all('work-report-document')
    expect(presses.map((press) => press.dataset.document)).toEqual(['res_later'])
    expect(read(presses[0]!)).toBe('Open the file kept with this reply')
    await opens(m, rowsIn(card)[0]!, 'res_found.md')
    unmountAll()
    // ⛔ With no reader the row is words, and there is no press at all.
    const words = await pane(ANSWERED, [FOUND], { onReadResource: undefined })
    expect(words.all('file-row').map((row) => row.tagName)).toEqual(['DIV'])
    expect(words.all('work-report-document')).toHaveLength(0)
    unmountAll()
    // ⛔ The pair: nothing read, both files keep the presses they had before UI-002, and no row.
    const unread = await pane(ANSWERED, null)
    expect(unread.all('work-report-document').map((press) => press.dataset.document)).toEqual([
      'res_found',
      'res_later',
    ])
    expect(unread.all('file-row')).toHaveLength(0)
  })

  it('🔴 rows arrive when the tree’s read lands after the cards were drawn', async () => {
    const m = await pane(ANSWERED, null)
    expect(m.all('work-report-document').map((press) => press.dataset.document)).toEqual([
      'res_found',
      'res_later',
    ])
    expect(m.all('file-row')).toHaveLength(0)
    useWhoCalledWhom().treeFiles.value = {
      conversation: META.sessionId,
      files: [FOUND],
      answered: true,
    }
    await nextTick()
    await drawnReady()
    expect(rowsIn(m.q('work-report')).map((row) => row.dataset.document)).toEqual(['res_found'])
    expect(m.all('work-report-document').map((press) => press.dataset.document)).toEqual([
      'res_later',
    ])
  })

  it('🔴 the reply a conversation sent lists the files it handed back — ⛔ one not read yet keeps its press, counted among the presses', async () => {
    const m = await pane(REPLIES, [
      kept({ resourceId: 'res_result', label: 'W1.3', role: 'made', title: 'W1.3 result' }),
    ])
    const reply = m.all('outgoing').find((card) => card.dataset.tool === 'reply_to_parent')!
    expect(rowsIn(reply).map((row) => row.dataset.document)).toEqual(['res_result'])
    await opens(m, rowsIn(reply)[0]!, 'res_result.md')
    const presses = [...reply.querySelectorAll<HTMLElement>('[data-cy="outgoing-document"]')]
    expect(presses.map((press) => press.dataset.document)).toEqual(['res_later'])
    expect(read(presses[0]!)).toBe('Open the file kept with this reply')
    unmountAll()
    const unread = await pane(REPLIES, null)
    const bare = unread.all('outgoing').find((card) => card.dataset.tool === 'reply_to_parent')!
    expect(rowsIn(bare)).toHaveLength(0)
    expect(
      [...bare.querySelectorAll<HTMLElement>('[data-cy="outgoing-document"]')].map((press) =>
        read(press),
      ),
    ).toEqual(['Open file 1 of 2 kept with this reply', 'Open file 2 of 2 kept with this reply'])
  })

  it('🔴 a row opens its file in the pane’s viewer — ⛔ and with no reader the rows are words', async () => {
    const files = [kept({ resourceId: 'res_in', label: 'W1.2' })]
    const m = await pane(GIVES, files)
    await opens(m, m.q('file-row'), 'res_in.md')
    unmountAll()
    const none = await pane(GIVES, files, { onReadResource: undefined })
    const words = none.q('file-row')
    expect(words.tagName).toBe('DIV')
    expect(read(words.querySelector('.title')!)).toBe('Input for test 2 and 5')
    words.click()
    await nextTick()
    expect(none.all('canonical-document-viewer')).toHaveLength(0)
  })

  it('🔴 a title or a name longer than its row is cut, and told whole', async () => {
    const title =
      'Resources in BroBot2: creation, reading, showing, and every place a person could look'
    const name =
      'resources-in-brobot2-creation-reading-showing-and-every-place-a-person-could-look.md'
    const m = mount(
      FileRows,
      {
        files: [kept({ resourceId: 'res_long', label: 'W1.11.1', title, name, role: 'made' })],
        canOpen: true,
      },
      { width: 360, height: 200 },
    )
    await drawnReady()
    const row = m.q('file-row')
    assertClippedButTold(row.querySelector<HTMLElement>('.title')!, 'the title', m.host)
    assertClippedButTold(row.querySelector<HTMLElement>('.meta')!, 'the name and the rest', m.host)
    expect(row.getAttribute('title')).toBe(`${title} — ${name}`)
    assertDrawn(row.querySelector<HTMLElement>('.role')!, 'the role', m.host)
  })
})
