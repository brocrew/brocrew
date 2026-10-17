import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useStickToBottom } from '../../src/renderer/src/composables/useStickToBottom'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import {
  BODY_WAS_CUT,
  outgoingCard,
  readItWholeIn,
  STATUS_LEAD,
  THE_BRIEF_IS_FURTHER_BACK,
  type OutgoingCardReading,
  type OutgoingCardWords,
} from '../../src/renderer/src/lib/outgoing-card'
import { createSessionRecord, type SessionRecord } from '../../src/renderer/src/lib/session-record'
import {
  applyEvent,
  briefItemIn,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import type {
  AgentIdentity,
  KeptFile,
  ResourceReading,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 UI-011 and its neighbours: a cut brief opens to its whole, and a card lists only its own files
 *
 * ⚑ **What was left unpinned by the frontend's own tests** (it writes none since 2026-10-01) and by
 * the older landing tables, in the commits `1a1ec11a`, `2ade02ff`, `2ce6ef42`, `d023c051` and
 * `128203e6`:
 *
 *  - **F037 / UI-011.** A give card in the giver's conversation shows the first ~200 characters of the
 *    brief. Where the brief is cut and the conversation can be opened, the cut note says *"read it
 *    whole in Ayo’s conversation"* and is the press; the screen then lands on the turn the brief
 *    arrived as (the FIRST turn that opened the piece, or its held row) or says it is further back.
 *    And the follow no longer writes a scroll where the box is already at its end — a same-value
 *    write cancelled a press's smooth scroll on its first frame.
 *  - **UI-002.** A card lists the inputs kept WITH what it shows: a give's own, a brief's by the time
 *    that brief arrived (a later brief on one piece lists those its giver added since), and — where
 *    the cast has not read the edge — those kept by the give's result.
 *  - **UI-003.** A blank status line leaves the standing one on a take-on's card.
 *  - **UI-002 · viewer.** The header says each kind a file can be, not only Markdown.
 *
 * ⛔ **Every negative is paired with the same mount one fact over** — a cut brief and a whole one, a
 * cast that was read and one that was not, a reading about this conversation and about another —
 * because a card that drew nothing would pass every absence. Where a block is a pure fold or a
 * source census, its positive is the same reader finding the thing one fact over.
 */

/* ------------------------------------------------------------------ fixtures */

const AT = new Date(2026, 8, 30, 19, 34).getTime()

const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'

const IDS = [{ id: 'aid:dev', slug: 'dev', displayName: 'Ayo' }] as unknown as AgentIdentity[]

const INVENTORY: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [
      { name: 'give_work', description: '', parameters: [] },
      { name: 'take_on_work', description: '', parameters: [] },
      { name: 'reply_to_parent', description: '', parameters: [] },
    ],
  },
  published: null,
} as unknown as TranscriptEvent

const RECEIPT = 'W1.2 given to Ayo (dev); it went to Ayo straight away.'

/** ⚑ The call's arguments as the ledger keeps them: bounded at 200 characters, so a long brief is cut. */
const giveCall = (brief: string): TranscriptEvent =>
  ({
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__give_work',
    summary: JSON.stringify({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: 'Fix the rail',
      brief,
    }).slice(0, 200),
  }) as TranscriptEvent

const giveResult = (): TranscriptEvent =>
  ({ type: 'tool_result', id: 'c1', summary: RECEIPT, ok: true }) as TranscriptEvent

const LONG_BRIEF = 'Make them agree. '.repeat(30)
const SHORT_BRIEF = 'Make them agree.'

const gives = (brief: string): TranscriptEvent[] => [
  INVENTORY,
  { type: 'user_turn', text: 'have Ayo fix the rail' },
  giveCall(brief),
  giveResult(),
]

/** ⚑ This conversation (`sess_1`) gave W1.2 to Ayo's conversation, `OWNER`. */
const GAVE: WorkEdge = {
  piece: 'work_1',
  label: 'W1.2',
  title: 'Fix the rail',
  from: 'sess_1',
  fromIdentity: null,
  to: OWNER,
  toIdentity: 'dev',
  state: 'working',
  givenAt: 0,
  endedAt: null,
}

/** ⚑ This conversation is GIVEN `label` by BroBot, at `givenAt`. */
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

/**
 * ⚑ The cast's reading of `conversation`: the work it gave out, and the work it was given. ⛔ The
 * cast is a window-level singleton, so `afterEach` puts it back.
 */
function castWith(gave: WorkEdge[], took: WorkEdge[], conversation: string = META.sessionId): void {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  useWhoCalledWhom().reading.value = {
    conversation,
    read: {
      conversation,
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

/** ⚑ The record `harness.record` builds, but with each event folded at its own time. */
function recordAt(pairs: ReadonlyArray<readonly [TranscriptEvent, number]>): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = META
  r.phase = 'open'
  for (const [event, at] of pairs) applyEvent(r.transcript, event, at)
  return r
}

function fold(events: readonly TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const toolOf = (state: TranscriptState, callId: string): ToolItem => {
  const found = state.items.find(
    (item): item is ToolItem & (typeof state.items)[number] =>
      item.kind === 'tool' && item.callId === callId,
  )
  expect(found, `no tool row for ${callId}`).toBeDefined()
  return found as ToolItem
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const rowsIn = (card: Element): HTMLElement[] => [
  ...card.querySelectorAll<HTMLElement>('[data-cy="file-row"]'),
]

const documentsIn = (card: Element): (string | undefined)[] =>
  rowsIn(card).map((row) => row.dataset.document)

/** ⚑ The Element.prototype.scrollTop setter, wrapped by `watchScrollTop` and put back after each test. */
let scrollTopWas: PropertyDescriptor | null = null

afterEach(async () => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.treeFiles.value = null
  cast.reading.value = null
  if (scrollTopWas !== null) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopWas)
  scrollTopWas = null
  await page.viewport(1200, 808)
})

/* ------------------------------------------------------------------ §1 · the card's reading */

describe('a give card whose brief was cut', () => {
  const card = (
    brief: string,
    gaveOut: readonly WorkEdge[] | null,
    held: ReadonlySet<string> | null,
  ): OutgoingCardReading => {
    const item = toolOf(fold(gives(brief)), 'c1')
    expect(item.outgoing, 'the call was not recognised').toBeDefined()
    return outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, held, gaveOut)
  }

  it('🔴 the give card reads where its cut brief is whole — the helper’s conversation, the piece’s label and the note’s words — ⛔ none for a brief that ended, an unread cast, a surface that cannot open it, or another piece’s edge', () => {
    const whole = card(LONG_BRIEF, [GAVE], new Set())
    expect(whole.bodyIsCut).toBe(true)
    expect(whole.wholeBrief).toEqual({
      conversation: OWNER,
      label: 'W1.2',
      said: 'Cut at the size limit — read it whole in Ayo’s conversation.',
    })
    expect(whole.wholeBrief?.said).toBe(readItWholeIn('Ayo'))
    // ⚑ The ordinary press stays beside it.
    expect(whole.where?.conversation).toBe(OWNER)

    // ⛔ One fact over, each: a brief that ended is not cut, and has the ordinary press and no whole.
    const ended = card(SHORT_BRIEF, [GAVE], new Set())
    expect(ended.bodyIsCut).toBe(false)
    expect(ended.wholeBrief).toBeNull()
    expect(ended.where).not.toBeNull()
    // …a cast that was not read has no edge: cut, and no press of either kind.
    const unread = card(LONG_BRIEF, null, new Set())
    expect(unread.bodyIsCut).toBe(true)
    expect(unread.wholeBrief).toBeNull()
    expect(unread.where).toBeNull()
    // …a surface that holds no list of conversations it can open: cut, and nothing to open.
    const unopenable = card(LONG_BRIEF, [GAVE], null)
    expect(unopenable.bodyIsCut).toBe(true)
    expect(unopenable.wholeBrief).toBeNull()
    expect(unopenable.where).toBeNull()
    // …and another piece's edge is not this give's.
    const another = card(LONG_BRIEF, [{ ...GAVE, label: 'W1.9' }], new Set())
    expect(another.bodyIsCut).toBe(true)
    expect(another.wholeBrief).toBeNull()
  })
})

/* ------------------------------------------------------------------ §2 · the press */

describe('the cut note on a give card, drawn', () => {
  async function pane(
    events: TranscriptEvent[],
    over: Record<string, unknown> = {},
  ): Promise<{ m: Mounted; calls: unknown[][] }> {
    const calls: unknown[][] = []
    const m = mount(
      ConversationPane,
      paneProps({
        record: record(events),
        identities: IDS,
        onOpenConversation: (...args: unknown[]) => calls.push(args),
        ...over,
      }),
      { width: 1200, height: 808 },
    )
    await drawnReady()
    await expandAgentCards(m)
    return { m, calls }
  }

  it('🔴 the cut note is the press: it opens the helper’s conversation and names the piece whose brief to land on — ⛔ with no edge, no runtime or no cut it is the plain note', async () => {
    castWith([GAVE], [])
    const { m, calls } = await pane(gives(LONG_BRIEF), { held: [] })
    const note = m.q('outgoing-cut')
    const press = m.q('outgoing-read-whole')
    expect(press.tagName).toBe('BUTTON')
    expect(note.contains(press)).toBe(true)
    expect(visible(press)).toBe(true)
    expect(read(press)).toBe(readItWholeIn('Ayo'))
    expect(read(note)).toBe(readItWholeIn('Ayo'))
    expect(read(note)).not.toContain(BODY_WAS_CUT)
    press.click()
    await nextTick()
    // ⚑ Two arguments, the brief's label second.
    expect(calls).toEqual([[OWNER, 'W1.2']])
    // ⛔ The ordinary press names no brief to land on.
    m.q('outgoing-where').click()
    await nextTick()
    expect(calls).toHaveLength(2)
    expect(calls[1]![0]).toBe(OWNER)
    expect(calls[1]![1]).toBeUndefined()
    unmountAll()

    // ⛔ One fact over: a cast that was not read — the plain words and no press of either kind.
    useWhoCalledWhom().reading.value = null
    const unread = await pane(gives(LONG_BRIEF), { held: [] })
    expect(read(unread.m.q('outgoing-cut'))).toBe(BODY_WAS_CUT)
    expect(unread.m.all('outgoing-read-whole')).toHaveLength(0)
    expect(unread.m.all('outgoing-where')).toHaveLength(0)
    unmountAll()

    // …a pane given no list of the conversations it can open (`held`): the same plain words.
    castWith([GAVE], [])
    const blind = await pane(gives(LONG_BRIEF))
    expect(read(blind.m.q('outgoing-cut'))).toBe(BODY_WAS_CUT)
    expect(blind.m.all('outgoing-read-whole')).toHaveLength(0)
    expect(blind.m.all('outgoing-where')).toHaveLength(0)
    unmountAll()

    // …and a brief that ended: no cut note at all, while the ordinary press is drawn.
    castWith([GAVE], [])
    const ended = await pane(gives(SHORT_BRIEF), { held: [] })
    expect(read(ended.m.q('outgoing-message'))).toBe(SHORT_BRIEF)
    expect(ended.m.all('outgoing-cut')).toHaveLength(0)
    expect(ended.m.all('outgoing-read-whole')).toHaveLength(0)
    expect(visible(ended.m.q('outgoing-where'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ §3 · where the brief is found */

const relayed = (text: string, piece?: string, label?: string): TranscriptEvent =>
  ({
    type: 'user_turn',
    text,
    relayedFrom: 'sess_brobot',
    relayedFromProfile: 'brobot',
    ...(piece === undefined ? {} : { piece, label }),
  }) as TranscriptEvent

/** ⚑ What `RuntimeHost.queueMessage` publishes on its BUSY branch. */
const queuedEvent = (): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId: 'msg_1',
    kind: 'work',
    text: 'Add i18n to freeze-clock: English, French and Spanish.',
    relayedFrom: 'sess_brobot',
  }) as unknown as TranscriptEvent

/** ⚑ …and the owner's `work_given`, which carries `messageId` exactly when the message is held. */
const assignedEvent = (): TranscriptEvent =>
  ({
    type: 'work_given',
    piece: 'work_3b480f7e',
    label: 'W1.12',
    parent: 'work_root',
    givenBy: 'sess_brobot',
    title: 'Add i18n to freeze-clock',
    brief: 'Add i18n to freeze-clock: English, French and Spanish.',
    messageId: 'msg_1',
  }) as unknown as TranscriptEvent

describe('the row a piece’s brief is drawn on', () => {
  it('🔴 a piece’s brief is found on the FIRST turn that opened it, or on its held row — ⛔ never a later brief, another piece’s or a plain message', () => {
    const a = fold([
      relayed('first brief', 'work_3', 'W1.3'),
      {
        type: 'work_given',
        piece: 'work_3',
        label: 'W1.3',
        parent: 'work_1',
        givenBy: 'sess_brobot',
        title: 'Test 2 and 5',
        brief: 'first brief',
      } as TranscriptEvent,
      relayed('the other piece’s brief', 'work_4', 'W1.4'),
      relayed('just a note'),
      relayed('a new brief', 'work_3', 'W1.3'),
    ])
    const turns = a.items.filter((item) => item.kind === 'relayed')
    expect(turns).toHaveLength(4)
    // ⚑ A pure fold, nothing drawn: its negatives are said as equalities, since no surface is read.
    // ⚑ The FIRST brief of the piece, never the newer one under the same label.
    expect(briefItemIn(a, 'W1.3')).toBe(turns[0]!.id)
    expect(briefItemIn(a, 'W1.3') === turns[3]!.id).toBe(false)
    expect(briefItemIn(a, 'W1.4')).toBe(turns[1]!.id)
    // ⛔ The pair: a piece that was never opened here is found nowhere, and the plain note is no brief's.
    expect(briefItemIn(a, 'W1.9') ?? 'found nowhere').toBe('found nowhere')
    for (const label of ['W1.3', 'W1.4', 'W1.9'])
      expect(briefItemIn(a, label) === turns[2]!.id, label).toBe(false)

    // ⚑ A brief still held: its row carries the label.
    const b = fold([queuedEvent(), assignedEvent()])
    const queued = b.items.find((item) => item.kind === 'queued')
    expect(queued, 'no held row').toBeDefined()
    expect(briefItemIn(b, 'W1.12')).toBe(queued!.id)
    expect(briefItemIn(b, 'W1.13') ?? 'found nowhere').toBe('found nowhere')
  })
})

/* ------------------------------------------------------------------ §4 · the screen's door, as text */

async function screenSource(): Promise<string> {
  return (
    (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
      default: string
    }
  ).default
}

/** From `start` to the first line that is exactly `end`; each is asserted found first. */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `nothing starts with ${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `nothing ends ${start} with ${end.trim()}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('the screen’s door to a brief, read as text', () => {
  it('🔴 goToTheWork opens the door first, reads the reader’s fold and says when the brief is further back — read as text', async () => {
    const screen = await screenSource()
    const work = slice(screen, 'async function goToTheWork(', '\n}\n')
    const question = slice(screen, 'async function goToQuestion(', '\n}\n')
    // ⚑ Presence first, then the order.
    expect(work).toContain('record.transcript')
    // A refused door looks for nothing, and so does a press that names no brief.
    expect(work).toContain(
      'if (!(await openConversation(sessionId)) || briefOf === undefined) return',
    )
    const door = work.indexOf('await openConversation(sessionId)')
    const settled = work.indexOf('await nextTick()')
    const found = work.indexOf('briefItemIn(record.transcript, briefOf)')
    const landed = work.indexOf('pane.value?.focus(itemId)')
    for (const at of [door, settled, found, landed]) expect(at).toBeGreaterThan(-1)
    expect(door).toBeLessThan(settled)
    expect(settled).toBeLessThan(found)
    expect(found).toBeLessThan(landed)
    expect(work).toContain('itemId === undefined || pane.value?.focus(itemId) !== true')
    expect(work).toContain('say(THE_BRIEF_IS_FURTHER_BACK)')
    expect(THE_BRIEF_IS_FURTHER_BACK).toBe(
      'That brief is not in the part of this conversation on screen — it is further back; load more of the transcript to reach it.',
    )
    // ⛔ A brief is history: the reader's fold, never the control fold a question is found in.
    expect(work).not.toContain('record.control')
    // The pair: the question's door, beside it, reads that control fold — so the absence above is a
    // difference between the two and not an anchor that is not there.
    expect(question).toContain('record.control.requestItems')
  })
})

/* ------------------------------------------------------------------ §5 · the follow */

/** ⚑ A scrolling box on `useStickToBottom`, whose content (`rows`) and signal (`tick`) the test moves. */
function follow(initialRows: number): {
  m: Mounted
  rows: { value: number }
  tick: { value: number }
  box: () => HTMLElement
  writes: () => number
  away: () => number
} {
  const rows = ref(initialRows)
  const tick = ref(0)
  const Box = defineComponent({
    name: 'FollowedBox',
    setup() {
      const { el, onScroll } = useStickToBottom(() => tick.value)
      return () =>
        h(
          'div',
          {
            ref: el,
            onScroll,
            'data-cy': 'box',
            style: 'height:200px;width:300px;overflow-y:auto',
          },
          Array.from({ length: rows.value }, (_, i) =>
            h('p', { style: 'margin:0;height:20px' }, `row ${i}`),
          ),
        )
    },
  })
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
  scrollTopWas = original
  const seen: Element[] = []
  Object.defineProperty(Element.prototype, 'scrollTop', {
    ...original,
    set(this: Element, value: number) {
      seen.push(this)
      original.set!.call(this, value)
    },
  })
  const m = mount(Box, {}, { width: 400, height: 300 })
  const box = (): HTMLElement => m.q('box')
  return {
    m,
    rows,
    tick,
    box,
    writes: () => seen.filter((el) => el === box()).length,
    away: () => box().scrollHeight - box().clientHeight - box().scrollTop,
  }
}

const settle = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('the follow of a scrolling panel', () => {
  it('🔴 the follow pins a box once and writes nothing where it is already at its end — ⛔ a line that moves the end is still followed', async () => {
    const f = follow(30)
    await drawnReady()
    await settle()
    await settle()
    expect(
      f.box().scrollHeight,
      'the box does not overflow — nothing here measures',
    ).toBeGreaterThan(f.box().clientHeight)
    // The mount's pin, and nothing from the resize observer's first call after it.
    expect(f.writes()).toBe(1)
    expect(f.away()).toBeLessThanOrEqual(1)
    // A signal that changes no content: nothing to follow, so nothing is written.
    f.tick.value++
    await settle()
    expect(f.writes()).toBe(1)
    // ⚑ The pair, one fact over: a line that moves the end is followed, and the box is back at it.
    f.rows.value = 31
    f.tick.value++
    await settle()
    expect(f.writes()).toBe(2)
    expect(f.away()).toBeLessThanOrEqual(1)
    expect(f.box().scrollTop).toBeGreaterThan(0)
    unmountAll()

    // A box whose content fits has no end to be at a distance from: it writes nothing at all.
    const fits = follow(5)
    await drawnReady()
    await settle()
    expect(fits.box().scrollHeight).toBe(fits.box().clientHeight)
    expect(fits.box().textContent).toContain('row 4')
    fits.tick.value++
    fits.rows.value = 6
    await settle()
    expect(fits.box().textContent).toContain('row 5')
    expect(fits.writes()).toBe(0)
  })
})

/* ------------------------------------------------------------------ §6 · the files a card lists */

async function paneOver(
  over: Record<string, unknown>,
  files: readonly KeptFile[] | null,
  events: TranscriptEvent[] = [],
): Promise<Mounted> {
  useWhoCalledWhom().treeFiles.value =
    files === null ? null : { conversation: META.sessionId, files, answered: true }
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events), identities: IDS, held: [], ...over }),
    { width: 1180, height: 780 },
  )
  await drawnReady()
  return expandAgentCards(m)
}

describe('the inputs a card lists are those kept by the time it was written', () => {
  it('🔴 a later brief on a piece lists the inputs kept by the time it arrived — ⛔ the first brief, one over, lists only those kept with the give', async () => {
    const again: TranscriptEvent = {
      type: 'user_turn',
      text: 'A new brief: check the second input too.',
      relayedFrom: 'sess_brobot',
      relayedFromProfile: 'brobot',
      piece: 'work_3',
      label: 'W1.3',
    } as TranscriptEvent
    castWith([], [edge('W1.3', AT)])
    const m = await paneOver(
      {
        record: recordAt([
          [GIVEN[0]!, AT],
          [GIVEN[1]!, AT],
          [again, AT + 120_000],
        ]),
      },
      [
        kept({ resourceId: 'res_first', label: 'W1.3' }),
        kept({ resourceId: 'res_added', label: 'W1.3', keptAt: AT + 60_000, title: 'Added later' }),
      ],
    )
    const cards = m.all('relayed')
    expect(cards).toHaveLength(2)
    // ⚑ The first brief, same mount: only what was kept with the give.
    expect(read(cards[0]!.querySelector('[data-cy="relayed-message"]')!)).toBe(
      'Test 2 and 5, with the input attached.',
    )
    expect(documentsIn(cards[0]!)).toEqual(['res_first'])
    // ⛔ The new brief, by the time it arrived: the input its giver added since is listed too.
    expect(read(cards[1]!.querySelector('[data-cy="relayed-message"]')!)).toBe(
      'A new brief: check the second input too.',
    )
    expect(documentsIn(cards[1]!)).toEqual(['res_first', 'res_added'])
  })

  it('⛔ a give whose edge was not read lists what was kept by its result — a result that landed later lists both', async () => {
    const files = [
      kept({ resourceId: 'res_with', label: 'W1.2', keptAt: AT + 500 }),
      kept({ resourceId: 'res_later', label: 'W1.2', keptAt: AT + 60_000, title: 'Added later' }),
    ]
    const stamped = (resultAt: number): SessionRecord => {
      const events = gives(SHORT_BRIEF)
      return recordAt([
        [events[0]!, AT],
        [events[1]!, AT],
        [events[2]!, AT],
        [events[3]!, resultAt],
      ])
    }
    // No reading of the cast: no edge, so the bound is the result's own time.
    const m = await paneOver({ record: stamped(AT + 1_000) }, files)
    expect(read(m.q('outgoing-task'))).toBe('W1.2')
    expect(documentsIn(m.q('outgoing'))).toEqual(['res_with'])
    unmountAll()
    // ⚑ The pair: the same give whose result landed after both were kept lists both.
    const later = await paneOver({ record: stamped(AT + 120_000) }, files)
    expect(documentsIn(later.q('outgoing'))).toEqual(['res_with', 'res_later'])
  })

  it('⛔ a cast reading about another conversation bounds no brief here — the same reading about this one does', async () => {
    const files = [kept({ resourceId: 'res_brief', label: 'W1.3' })]
    const anHourBefore = edge('W1.3', AT - 3_600_000)
    // The reading is about another conversation: it bounds nothing here, so the input is listed.
    castWith([], [anHourBefore], 'sess_other')
    const other = await paneOver({}, files, GIVEN)
    expect(read(other.q('relayed-message'))).toBe('Test 2 and 5, with the input attached.')
    expect(documentsIn(other.q('relayed'))).toEqual(['res_brief'])
    unmountAll()
    // ⛔ The pair: the same reading about THIS conversation — the input was kept after it was given.
    castWith([], [anHourBefore])
    const here = await paneOver({}, files, GIVEN)
    expect(read(here.q('relayed-message'))).toBe('Test 2 and 5, with the input attached.')
    expect(rowsIn(here.q('relayed'))).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ §7 · the take-on card's status */

describe('a take-on card’s status line', () => {
  const TITLE = 'Test shared memory'
  const ARGS = { title: TITLE, brief: 'Check that two agents of one profile see the same notes.' }
  const call = (): TranscriptEvent =>
    ({
      type: 'tool_call',
      id: 'c1',
      name: 'mcp__brobot__take_on_work',
      summary: JSON.stringify(ARGS),
    }) as TranscriptEvent
  const takenOn = (): TranscriptEvent =>
    ({
      type: 'work_given',
      piece: 'work_7',
      label: 'W1.7',
      parent: 'work_1',
      givenBy: null,
      title: TITLE,
      brief: ARGS.brief,
    }) as unknown as TranscriptEvent
  const result = (): TranscriptEvent =>
    ({
      type: 'tool_result',
      id: 'c1',
      ok: true,
      summary: `Took on W1.7 · ${TITLE}, under W1, your conversation’s own work.`,
    }) as TranscriptEvent
  const status = (line: string): TranscriptEvent =>
    ({ type: 'work_status_set', piece: 'work_7', line, by: 'sess_1' }) as unknown as TranscriptEvent
  const TOOK_IT = [INVENTORY, call(), takenOn(), result()]

  const cardOf = (events: readonly TranscriptEvent[]): OutgoingCardReading => {
    const item = toolOf(fold(events), 'c1')
    expect(item.outgoing, 'the call was not recognised').toBeDefined()
    return outgoingCard(item, item.outgoing as OutgoingCardWords, null, new Set())
  }

  it('⛔ a blank status line leaves the standing one on a take-on’s card — a real one replaces it', () => {
    // ⚑ The positive: the card is the take-on, and a real line stands under its lead.
    const standing = cardOf([...TOOK_IT, status('Running test 2 of 5')])
    expect(standing.state).toBe('taken-on')
    expect(standing.status).toBe('Running test 2 of 5')
    expect(STATUS_LEAD).toBe('Status:')
    // ⛔ A blank line after it changes nothing, whatever the blank is…
    expect(cardOf([...TOOK_IT, status('Running test 2 of 5'), status('   ')]).status).toBe(
      'Running test 2 of 5',
    )
    expect(cardOf([...TOOK_IT, status('Running test 2 of 5'), status('')]).status).toBe(
      'Running test 2 of 5',
    )
    // …and a blank line alone sets nothing.
    expect(cardOf([...TOOK_IT, status('   ')]).status).toBeNull()
    expect(cardOf([...TOOK_IT, status('')]).status).toBeNull()
    // ⚑ The pair: the newest real line still replaces the standing one.
    expect(
      cardOf([...TOOK_IT, status('Running test 2 of 5'), status('Running test 3 of 5')]).status,
    ).toBe('Running test 3 of 5')
  })
})

/* ------------------------------------------------------------------ §8 · the viewer's kinds */

describe('the viewer says what kind of file it is', () => {
  const MARKDOWN: ResourceReading = {
    ok: true,
    resourceId: 'res_findings',
    name: 'open-findings.md',
    form: 'markdown',
    text: '# Open findings\n\n| ID | Title |',
    bytes: 2_048,
  }

  const viewer = (result: ResourceReading): Mounted =>
    mount(CanonicalDocumentViewer, { result }, { width: 900, height: 600 })

  it('🔴 the viewer says each kind a file can be — Page, Image and PDF beside Markdown', async () => {
    // ⚑ The positive: the Markdown file reads its own word on the same helper.
    const md = viewer(MARKDOWN)
    await drawnReady()
    expect(read(md.q('canonical-document-kind'))).toBe('Markdown · 2 KB')
    expect(md.all('canonical-document-not-drawn')).toHaveLength(0)
    unmountAll()

    const kinds: ReadonlyArray<readonly [ResourceReading, string, string | null]> = [
      [
        {
          ok: true,
          resourceId: 'res_page',
          name: 'index.html',
          form: 'page',
          text: '<h1>x</h1>',
          bytes: 2_048,
        },
        'Page · 2 KB',
        null,
      ],
      [
        {
          ok: true,
          resourceId: 'res_img',
          name: 'shot.png',
          form: 'image',
          text: null,
          bytes: 70,
        },
        'Image · 70 B',
        'This file is an image. It is kept, and this window cannot draw it yet.',
      ],
      [
        {
          ok: true,
          resourceId: 'res_pdf',
          name: 'report.pdf',
          form: 'pdf',
          text: null,
          bytes: 1_468_006,
        },
        'PDF · 1.4 MB',
        'This file is a PDF. It is kept, and this window cannot draw it yet.',
      ],
    ]
    for (const [result, kind, notDrawn] of kinds) {
      const m = viewer(result)
      await drawnReady()
      expect(read(m.q('canonical-document-name'))).toBe(result.ok ? result.name : '')
      expect(read(m.q('canonical-document-kind'))).toBe(kind)
      if (notDrawn === null) expect(m.all('canonical-document-not-drawn')).toHaveLength(0)
      else expect(read(m.q('canonical-document-not-drawn'))).toBe(notDrawn)
      unmountAll()
    }
  })
})
