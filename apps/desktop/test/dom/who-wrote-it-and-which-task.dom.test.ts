import { agentCardSides } from './harness'
import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import RelayedEntry from '../../src/renderer/src/components/RelayedEntry.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { GO_AHEAD_MESSAGE } from '../../src/renderer/src/lib/plan-mode'
import type { QueuedItem, RelayedItem } from '../../src/renderer/src/lib/transcript'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { foldProviderLimits, readProviderLimit } from '../../src/shared/provider-limit'
import type {
  AgentIdentities,
  AgentIdentity,
  RuntimeBridge,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import type { StalledWork } from '../../src/shared/stalled-work'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 688 — what a person SEES of who wrote it, and which task
 *
 * ⚑ `who-wrote-it-and-which-task.render.test.ts` drives the real host and pins what each card
 * SAYS; this file pins what a person perceives of it, in the dom runner: the press that names
 * its row, the sentence drawn whole, the word beside a heading rather than inside it, and the
 * INK of a stat beside an amber line. ⛔ Never a class name — a colour, a size, a press.
 *
 * | § | about | the control |
 * |---|---|---|
 * | 1 | R22 · the held go-ahead's row and its press | the person's own row and its *Cancel it* |
 * | 2 | R33 · the row after a take-back | the person's own cancelled row |
 * | 3 | R22 · the composer's foot (one foot since D-010: queue behind; with what waits, in one turn, since D-027) | the person's own held message, alone and beside BroBot's |
 * | 4 | H1 · *note* / *follow-up* beside the heading (*work* went with `message_agent`'s kind, D-016) | a turn nobody declared |
 * | 5 | H2 · *W1.N* on the sender's card — the piece a follow-up is about (*Task #N* until D-016) | a note's card, and a follow-up with no label |
 * | 6 | F3 · no green *All clear* beside an amber line | a quiet page with no line: green |
 * | 7 | O1 · *Its own instructions* in the sheet's own registers | the sheet's own *Runs on* and note |
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  usePersonsQueue().forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent
const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()
  }
}
const ink = (el: Element): string => getComputedStyle(el).color

/** A held row as the fold makes it — `over` is what the ledger carried. */
const heldRow = (over: Partial<QueuedItem>): QueuedItem & { at: number } => ({
  kind: 'queued',
  id: 'queued_1',
  text: GO_AHEAD_MESSAGE,
  outcome: null,
  at: 1_700_000_000_000,
  ...over,
})

async function aRow(
  item: QueuedItem & { at: number },
  /**
   * ⚑ **696** · the transcript's decision (`688` L1) — `the-model-control-reads-r31.dom.test.ts` §5
   * measures it through the pane.
   */
  mayCarryOn = false,
): Promise<{ m: Mounted; pressed: unknown[] }> {
  await page.viewport(900, 500)
  const pressed: unknown[] = []
  const m = mount(
    QueuedMessage,
    {
      item,
      identities: null,
      ownAgent: null,
      mayCarryOn,
      onCancel: (id: unknown) => pressed.push(id),
    },
    { width: 860, height: 480 },
  )
  await drawnReady()
  await settle()
  await expandAgentCards(m)
  return { m, pressed }
}

/* ═════════════════ §1 · R22 — the held go-ahead's own row, and the row it names ═════════════════ */

describe('688 §1 · R22 — a held go-ahead is BroBot’s row, and its press names that row', () => {
  it('🔴 BroBot, why it waits, and one control of its own — which takes back THIS row by name', async () => {
    const { m, pressed } = await aRow(heldRow({ goAhead: true, messageId: 'msg_go' }))
    expect(words(m.q('queued-sender'))).toBe('This app')
    const why = m.q('queued-go-ahead-why')
    expect(words(why)).toBe(
      'This app sends this when the turn ends, because you pressed “Start work on this plan”. You did not write it.',
    )
    assertDrawn(why, 'the go-ahead’s why')
    const control = m.q('take-back-go-ahead')
    expect(visible(control)).toBe(true)
    expect(words(control)).toBe('Take back the go-ahead')
    // ⛔ R22 — never the person's controls
    expect(m.all('cancel-queued')).toHaveLength(0)
    expect(m.all('restore-queued')).toHaveLength(0)
    control.click()
    expect(pressed).toEqual(['msg_go'])
  })

  it('⚑ THE CONTROL — the person’s own held row: You, and Cancel it, which names its row too', async () => {
    const { m, pressed } = await aRow(heldRow({ text: 'and here is mine', messageId: 'msg_mine' }))
    expect(words(m.q('queued-sender'))).toBe('You')
    expect(m.all('take-back-go-ahead')).toHaveLength(0)
    expect(m.all('queued-go-ahead-why')).toHaveLength(0)
    m.q('cancel-queued').click()
    expect(pressed).toEqual(['msg_mine'])
  })

  it('⛔ a row written before 354 has no name, and offers no Cancel it — main holds nothing by no name, and the head is a different message', async () => {
    const { m, pressed } = await aRow(heldRow({ text: 'an old one' }))
    expect(words(m.q('queued-state'))).toBe('not sent · waiting for the turn to end')
    expect(m.all('cancel-queued')).toHaveLength(0)
    // ⚑ …and not the ending's control either: it has not ended
    expect(m.all('restore-queued')).toHaveLength(0)
    expect(pressed).toEqual([])
  })
})

describe('688 §1 · the press travels up the pane by the row’s NAME', () => {
  it('🔴 the go-ahead’s take-back, pressed inside the conversation, reaches the screen as ITS id — beside another held message', async () => {
    await page.viewport(1100, 800)
    const r = record([
      ev({ type: 'user_turn', text: 'Plan the rebuild of the orders index.' }),
      ev({ type: 'status', state: 'running' }),
      // ⚑ a routed question held FIRST — the head of the mailbox is not the go-ahead
      ev({
        type: 'message_queued',
        messageId: 'msg_q',
        kind: 'question',
        text: 'the child asks',
        attribution: 'app_authored',
        relayedFrom: 'sess_ada',
        relayedFromProfile: 'ada',
      }),
      ev({
        type: 'message_queued',
        messageId: 'msg_go',
        kind: 'work',
        text: GO_AHEAD_MESSAGE,
        attribution: 'app_authored',
      }),
    ])
    const pressed: unknown[] = []
    const m = mount(
      ConversationPane,
      paneProps({ record: r, onCancelQueued: (id: unknown) => pressed.push(id) }),
      { width: 1080, height: 780 },
    )
    await settle()
    await expandAgentCards(m)
    m.q('take-back-go-ahead').click()
    expect(pressed).toEqual(['msg_go'])
  })
})

/* ═════════════════ §2 · R33 — what follows the take-back ═════════════════ */

describe('688 §2 · R33 — the taken-back go-ahead says what followed, in main’s words, drawn whole', () => {
  it('🔴 you took it back · the plan was released but the go-ahead was not sent — type your next message', async () => {
    const { m } = await aRow(
      heldRow({ goAhead: true, messageId: 'msg_go', outcome: 'cancelled' }),
      true,
    )
    expect(words(m.q('queued-state'))).toBe('not sent · you took it back')
    const line = m.q('queued-go-ahead-taken-back')
    // ⛔ The BYTES are main's sentence; only the first letter is raised, by the style.
    expect(words(line)).toBe(
      'the plan was released but the go-ahead was not sent — type your next message to carry on',
    )
    expect(getComputedStyle(line, '::first-letter').textTransform).toBe('uppercase')
    assertDrawn(line, 'the sentence after a take-back')
    expect(m.all('restore-queued')).toHaveLength(0)
    expect(m.all('take-back-go-ahead')).toHaveLength(0)
  })

  it('⚑ THE CONTROL — the person’s own cancelled row keeps its own words and its Put it back', async () => {
    const { m } = await aRow(heldRow({ text: 'mine', messageId: 'msg_mine', outcome: 'cancelled' }))
    expect(words(m.q('queued-state'))).toBe('not sent · you cancelled it')
    expect(m.all('queued-go-ahead-taken-back')).toHaveLength(0)
    expect(visible(m.q('restore-queued'))).toBe(true)
  })
})

/* ═════════════════ §3 · R22 — the composer's foot ═════════════════ */

describe('688 §3 · R22 — the composer does not point at a Cancel the row does not offer', () => {
  const BUSY = [
    ev({ type: 'user_turn', text: 'Plan the rebuild of the orders index.' }),
    ev({ type: 'status', state: 'running' }),
  ]
  const GO = {
    id: 'msg_go',
    kind: 'work',
    text: GO_AHEAD_MESSAGE,
    since: 1,
    attribution: 'app_authored',
  }
  const MINE = { id: 'msg_mine', kind: 'work', text: 'and here is mine', since: 2 }

  async function composerOver(queued: Record<string, unknown>[]): Promise<Mounted> {
    await page.viewport(1100, 800)
    const r = record(BUSY)
    r.meta = { ...META, queued: queued as never }
    const m = mount(
      ConversationPane,
      paneProps({ record: r, draft: 'and then rename the table' }),
      {
        width: 1080,
        height: 780,
      },
    )
    await drawnReady()
    await settle()
    await expandAgentCards(m)
    return m
  }

  /** ⚑ A child's question the app ROUTED, held beside the person's own work (`394`'s second slot). */
  const ROUTED = {
    id: 'msg_q',
    kind: 'question',
    text: 'the child asks',
    since: 3,
    attribution: 'app_authored',
  }

  /**
   * ⚑ **D-010 · R22 kept by construction.** The composer said *"Cancel it … before queueing
   * another"* for the person's own and *"Wait for it to go …"* for a message they did not write,
   * because a second was refused; ⛔ the second is held behind now, so no foot names a Cancel at all
   * — whoever wrote what waits, alone, beside the person's own, or the person's own only.
   * ⚑ **D-027 moved the words**: what is held goes out together, in one turn, oldest first, and
   * only a command goes alone — so the foot and the Queue title say *"with what is already waiting
   * — a command goes alone"*, where they said *"…and take(s) what is already waiting"*.
   */
  it('🔴 whoever wrote what waits: the foot queues behind it, points at no Cancel, and the Queue button offers the same', async () => {
    for (const queued of [[GO], [MINE, ROUTED], [MINE]]) {
      const m = await composerOver(queued)
      const foot = m.q('composer-hint')
      expect(words(foot)).toMatch(
        /^.+ to send when .+ finishes, with what is already waiting — a command goes alone · .+ is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds$/,
      )
      expect(words(foot)).not.toContain('Cancel it')
      expect(words(foot)).not.toContain('Wait for it to go')
      assertDrawn(foot, 'the composer’s foot')
      const queue = m.q('queue-prompt') as HTMLButtonElement
      expect(queue.disabled).toBe(false)
      expect(queue.getAttribute('title')).toMatch(
        /^Let .+ finish, then send this with what is already waiting — a command goes alone \(.+\)$/,
      )
      unmountAll()
    }
  })
})

/* ═════════════════ §4 · H1 — the sender's word, beside the heading ═════════════════ */

describe('688 §4 · H1 — what the sender said, beside the heading and never inside it', () => {
  const turn = (over: Partial<RelayedItem>): RelayedItem & { at: number } => ({
    kind: 'relayed',
    id: 'relayed_1',
    text: 'Write the second migration.',
    relayedFromProfile: 'ada',
    at: 1_700_000_000_000,
    ...over,
  })

  it('🔴 *note* and *follow-up*, each a word of its own in the meta row', async () => {
    await page.viewport(900, 400)
    // ⚑ D-016 · `message_agent`'s kinds are these two; *work* is a give now, and a brief says none.
    for (const says of ['note', 'follow-up'] as const) {
      const m = mount(
        RelayedEntry,
        { item: turn({ says }), identities: null, ownAgent: 'BroBot' },
        {
          width: 860,
          height: 380,
        },
      )
      await settle()
      await expandAgentCards(m)
      const word = m.q('relayed-says')
      expect(visible(word)).toBe(true)
      expect(words(word)).toBe(says)
      expect(m.q('relayed-heading').contains(word)).toBe(false)
      expect(agentCardSides(m.q('relayed-heading'))).toBe('ada to BroBot')
      unmountAll()
    }
  })

  it('⛔ THE CONTROL — nothing declared: no word at all, and never *question*', async () => {
    await page.viewport(900, 400)
    const m = mount(
      RelayedEntry,
      { item: turn({}), identities: null, ownAgent: 'BroBot' },
      {
        width: 860,
        height: 380,
      },
    )
    await settle()
    await expandAgentCards(m)
    expect(m.all('relayed-says')).toHaveLength(0)
    expect(words(m.q('relayed'))).not.toMatch(/\bquestion\b/)
  })

  it('⚑ the held row says it in the same place, beside its own mark', async () => {
    const { m } = await aRow(
      heldRow({
        text: 'and one more thing?',
        relayed: true,
        relayedFromProfile: 'ada',
        says: 'follow-up',
      }),
    )
    expect(words(m.q('queued-says'))).toBe('follow-up')
    expect(words(m.q('queued-about'))).toBe('from another conversation')
    expect(m.q('queued-heading').contains(m.q('queued-says'))).toBe(false)
  })
})

/* ═════════════════ §5 · H2 — the sender's card names the piece its message is about ═════════════════ */

describe('688 §5 · H2 — W1.N on the sender’s card, in the reply card’s place', () => {
  const INVENTORY = ev({
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'message_agent', description: '', parameters: [] }],
    },
    published: null,
  })
  const sent = (id: string, text: string, kind: string, row: Record<string, unknown>) => [
    ev({
      type: 'tool_call',
      id,
      name: 'mcp__brobot__message_agent',
      summary: JSON.stringify({ agent: 'sess_ada', text, kind }),
    }),
    ev({
      type: 'message_sent',
      to: 'sess_ada',
      toProfile: 'ada',
      kind,
      delivery: 'sent',
      onBehalfOfAPerson: true,
      text,
      ...row,
    }),
    ev({ type: 'tool_result', id, ok: true, summary: 'sent' }),
  ]

  it('🔴 a follow-up: *W1.8*; a follow-up whose label is not in view: *Piece*; a note: nothing', async () => {
    await page.viewport(1100, 900)
    // ⚑ D-016 · a follow-up names the piece it is about (`message_sent.piece` / `.label`).
    const r = record([
      INVENTORY,
      ev({ type: 'user_turn', text: 'Ask Ada.' }),
      ...sent('c_work', 'Write the second migration.', 'follow-up', {
        piece: 'work_8',
        label: 'W1.8',
      }),
      ...sent('c_unnumbered', 'Rename the table.', 'follow-up', { piece: 'work_9' }),
      ...sent('c_q', 'Is the first one merged yet?', 'note', {}),
    ])
    const m = mount(ConversationPane, paneProps({ record: r }), { width: 1080, height: 880 })
    await settle()
    await expandAgentCards(m)
    const cards = m.all('outgoing')
    const taskOf = (card: HTMLElement): string | null => {
      const task = card.querySelector('[data-cy="outgoing-task"]')
      return task === null ? null : words(task)
    }
    expect(cards.map((card) => words(card.querySelector('[data-cy="outgoing-message"]')))).toEqual([
      'Write the second migration.',
      'Rename the table.',
      'Is the first one merged yet?',
    ])
    expect(cards.map(taskOf)).toEqual(['W1.8', 'Piece', null])
    const task = cards[0]!.querySelector('[data-cy="outgoing-task"]') as HTMLElement
    expect(visible(task)).toBe(true)
    expect(cards[0]!.querySelector('[data-cy="outgoing-heading"]')!.contains(task)).toBe(false)
  })
})

/* ═════════════════ §6 · F3 — no green All clear beside an amber line ═════════════════ */

describe('688 §6 · F3 — while an amber line stands, the stat is neutral', () => {
  const T = Date.UTC(2026, 8, 18, 12, 0, 0)
  const walked = <Row>(rows: readonly Row[], walk: string) =>
    ({ rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }) as never
  const STALLED = {
    piece: 'work_x',
    label: 'W1.3',
    title: 'Build the world clock page.',
    owner: 'sess_pam',
    ownerName: 'Pam',
    giver: 'sess_ada',
    giverName: 'Ada',
    because: 'turn_ended',
    stalledAt: 1_000,
  } as StalledWork

  async function thePage(opts: { wall?: boolean; stalled?: boolean }): Promise<Mounted> {
    await page.viewport(1400, 1000)
    const said = 'claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z'
    const seen = readProviderLimit(said, T - 60_000)!
    usePersonsQueue().supply(
      walked([], 'every-conversation-that-routed'),
      walked([], 'every-conversation-that-routed'),
      {
        held: new Set<string>(),
        answerable: new Map<string, AttentionRequest>(),
        answeredFromHere: new Set<string>(),
        now: T,
        lastLookAnswered: { questions: true, decisions: true },
      },
      {
        travel: () => {},
        settle: () => {},
        takeOver: () => {},
        open: () => {},
        openWork: () => {},
      } as never,
      {
        walked: walked(
          opts.wall === true ? foldProviderLimits([seen], [], T) : [],
          'every-provider-wall-recently-recorded',
        ),
        lastLookAnswered: true,
      } as never,
      {
        walked: walked(opts.stalled === true ? [STALLED] : [], 'every-conversation-that-routed'),
        lastLookAnswered: true,
      } as never,
    )
    const m = mount(
      WaitingOnYou,
      {
        attention: [],
        needsYou: [],
        clock: T,
      },
      { width: 1351, height: 900 },
    )
    await drawnReady()
    await settle()
    await expandAgentCards(m)
    return m
  }

  /** ⚑ The resolved ink of a token, read off a probe inside the page — never a hard-coded hex. */
  const tokenInk = (m: Mounted, token: string): string => {
    const probe = document.createElement('span')
    probe.style.color = `var(${token})`
    m.q('waiting-stat').parentElement!.append(probe)
    const said = getComputedStyle(probe).color
    probe.remove()
    return said
  }

  /** Every drawn element on the page whose own ink is one of `inks`. */
  const inked = (m: Mounted, inks: string[]): HTMLElement[] =>
    [...m.host.querySelectorAll<HTMLElement>('*')].filter(
      (el) => visible(el) && words(el) !== '' && inks.includes(ink(el)),
    )

  it('🔴 a wall alone: *Nothing* in the neutral ink — no green on a page with an amber line', async () => {
    const m = await thePage({ wall: true })
    const amber = [tokenInk(m, '--waiting-text-label'), tokenInk(m, '--waiting')]
    const green = tokenInk(m, '--success')
    expect(inked(m, amber).length).toBeGreaterThan(0)
    expect(words(m.q('waiting-stat'))).toBe('Nothing')
    expect(ink(m.q('waiting-stat'))).toBe(tokenInk(m, '--text-soft'))
    expect(inked(m, [green])).toEqual([])
  })

  it('🔴 stopped work alone: the same — its line is amber too', async () => {
    const m = await thePage({ stalled: true })
    expect(visible(m.q('persons-queue-stall-says-work_x'))).toBe(true)
    expect(words(m.q('waiting-stat'))).toBe('Nothing')
    expect(inked(m, [tokenInk(m, '--success')])).toEqual([])
  })

  it('⚑ THE CONTROL — a quiet page with no amber line keeps its green *All clear*', async () => {
    const m = await thePage({})
    expect(words(m.q('waiting-stat'))).toBe('All clear')
    expect(ink(m.q('waiting-stat'))).toBe(tokenInk(m, '--success'))
  })
})

/* ═════════════════ §7 · O1 — Its own instructions, in the sheet's own registers ═════════════════ */

describe('688 §7 · O1 — the agent’s own instructions draw in the sheet’s registers', () => {
  const identity = {
    id: 'agp:default:worker',
    slug: 'worker',
    displayName: 'Worker',
    role: null,
    createdAt: 1_700_000_000_000,
    createdBy: null,
    provider: 'codex',
    externalMcpServerIds: [],
    capabilities: { ...DEFAULT_CAPABILITIES },
    chosen: {},
  } as unknown as AgentIdentity
  const roster = {
    identities: [identity],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  } as unknown as AgentIdentities

  async function theSheet(instructions: () => Promise<unknown>): Promise<Mounted> {
    const store = createAgentStore({
      agentIdentities: async () => roster,
      agentModelAndEffort: async () => null,
      profiles: async () => ['worker'],
      agentInstructions: instructions,
    } as unknown as RuntimeBridge)
    await store.load()
    await page.viewport(760, 1200)
    const m = mount(
      CapabilitiesSheet,
      { profileSlug: 'worker', runsOn: 'codex', store, onClose: () => {} },
      { width: 740, height: 1180 },
    )
    await drawnReady()
    await settle()
    await expandAgentCards(m)
    return m
  }

  const style = (el: Element) => {
    const s = getComputedStyle(el)
    return { size: s.fontSize, ink: s.color, transform: s.textTransform, spacing: s.letterSpacing }
  }

  it('🔴 its heading is the sheet’s label, and its note the sheet’s note', async () => {
    const m = await theSheet(async () => ({
      own: { identity: 'worker', versions: [] },
      waiting: [],
      readAt: 1_700_000_300_000,
    }))
    const own = m.q('own-instructions')
    const heading = own.querySelector('h3') as HTMLElement
    const runsOn = m.q('capabilities-provider').querySelector('label > span') as HTMLElement
    expect(words(runsOn)).toBe('Default provider')
    expect(style(heading)).toEqual(style(runsOn))
    const note = m.q('own-instructions-when')
    const sheetNote = m.q('capabilities-provider-note')
    expect(style(note)).toEqual(style(sheetNote))
    expect(getComputedStyle(note).marginTop).toBe('0px')
  })

  it('🔴 a read that failed says so in the sheet’s error ink, with no page-sized padding', async () => {
    const m = await theSheet(async () => {
      throw new Error('unreadable')
    })
    const line = m.q('own-instructions-unreadable')
    const probe = document.createElement('span')
    probe.style.color = 'var(--danger)'
    m.q('own-instructions').append(probe)
    expect(ink(line)).toBe(getComputedStyle(probe).color)
    probe.remove()
    expect(getComputedStyle(line).paddingTop).toBe('0px')
    expect(getComputedStyle(line).marginTop).toBe('0px')
    assertDrawn(line, 'the unreadable line')
  })
})
