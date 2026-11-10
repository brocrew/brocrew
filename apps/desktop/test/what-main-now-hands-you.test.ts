import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type RelayedItem,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { pieceSays } from '../src/renderer/src/lib/relayed-turn'
import { ROWS_UNREAD_LEAD, rowsUnreadSays } from '../src/renderer/src/lib/rows-unread'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../src/shared/runtime-ipc'

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

function fold(events: readonly TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const INVENTORY = ev({
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'message_agent', description: '', parameters: [] }],
  },
  published: null,
})

/** The one message call's landed row, after a `message_sent` with `extra`. */
function landed(extra: Record<string, unknown>) {
  const state = fold([
    INVENTORY,
    ev({ type: 'tool_call', id: 'c', name: 'mcp__brobot__message_agent', summary: '{}' }),
    ev({
      type: 'message_sent',
      to: 'sess_ada',
      toProfile: 'ada',
      kind: 'note',
      delivery: 'sent',
      onBehalfOfAPerson: false,
      ...extra,
    }),
  ])
  const call = state.items.find((item): item is ToolItem => item.kind === 'tool')
  const words = call?.outgoing
  if (words?.tool !== 'message_agent' || words.sent === null) throw new Error('no landed row')
  return words.sent
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · F-G1 — the words on the receipt, read as the stored value is
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · F-G1 · `message_sent.text` through the fold', () => {
  it('🔴 the words and the cut arrive on the card’s row', () => {
    expect(landed({ text: 'the orders index', clipped: true })).toMatchObject({
      text: 'the orders index',
      clipped: true,
    })
    // ⚑ the control — words that were not cut say so by NOT being clipped
    expect(landed({ text: 'the orders index' })).toMatchObject({ clipped: false })
  })

  it('⛔ replay is a trust boundary — a non-string is no words, and a cut with no words is no cut', () => {
    expect(landed({ text: 7, clipped: true })).toMatchObject({ text: null, clipped: false })
    expect(landed({ clipped: true })).toMatchObject({ text: null, clipped: false })
    expect(landed({ text: 'x', clipped: 'yes' })).toMatchObject({ text: 'x', clipped: false })
  })

  it('⚑ the Events tab counts the words and says when they were cut — never prints them', () => {
    const line = (extra: Record<string, unknown>): string =>
      describeEvent(
        ev({
          type: 'message_sent',
          to: 'sess_ada',
          toProfile: 'ada',
          kind: 'note',
          delivery: 'sent',
          onBehalfOfAPerson: false,
          ...extra,
        }) as never,
      )
    expect(line({ text: 'x'.repeat(1_280), clipped: true })).toContain(' · 1280 chars, cut')
    expect(line({ text: 'the words' })).toContain(' · 9 chars')
    expect(line({ text: 'the words' })).not.toContain('cut')
    expect(line({ text: 'the words' })).not.toContain('the words')
    // ⚑ the control — a row written before 671 prints no count at all
    expect(line({})).not.toMatch(/chars/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · F-G2 — the join, in both orders, and its traps
// ─────────────────────────────────────────────────────────────────────────────────────────────

const FROM_ADA = { relayedFrom: 'sess_ada', relayedFromProfile: 'ada' }
/** ⚑ **D-016 · the give** — `W1.<number>`, titled `Job <number>`, from Ada's root. */
const given = (piece: unknown, number: number, over: Record<string, unknown> = {}) =>
  ev({
    type: 'work_given',
    piece,
    label: `W1.${String(number)}`,
    parent: 'work_root_ada',
    givenBy: 'sess_ada',
    title: `Job ${String(number)}`,
    brief: 'the brief',
    ...over,
  })
/** ⚑ **D-016 · a brief** — the turn a give sends, which carries its piece and its label (R4). */
const brief = (text: string, piece: unknown, label?: string) =>
  ev({ type: 'user_turn', text, piece, ...(label === undefined ? {} : { label }), ...FROM_ADA })
const relayed = (state: TranscriptState): RelayedItem[] =>
  state.items.filter((item): item is RelayedItem => item.kind === 'relayed')

describe('§2 · F-G2 · a turn is joined to the piece it gave', () => {
  it('🔴 idle order and held order both number the card — and a number other than 1', () => {
    const idle = fold([brief('a', 'work_7', 'W1.7'), given('work_7', 7)])
    expect(relayed(idle).map((one) => one.opened)).toEqual([{ label: 'W1.7', title: 'Job 7' }])
    const held = fold([given('work_8', 8), brief('b', 'work_8', 'W1.8')])
    expect(relayed(held).map((one) => one.opened)).toEqual([{ label: 'W1.8', title: 'Job 8' }])
  })

  it('⛔ a give names ITS turn and never the last one', () => {
    // ⚑ **D-016 · the label is each turn's own; the TITLE is the join** — so the title lands on the
    // turn whose piece the give names, and the later turn keeps only its label.
    const state = fold([
      brief('first', 'work_1', 'W1.1'),
      brief('second', 'work_2', 'W1.2'),
      given('work_1', 1),
    ])
    expect(relayed(state).map((one) => [one.text, one.opened])).toEqual([
      ['first', { label: 'W1.1', title: 'Job 1' }],
      ['second', { label: 'W1.2' }],
    ])
  })

  it('⛔ the traps — no id, a forged id, and a turn that is not another agent’s', () => {
    // a give with no id touches no turn that carries none (`undefined === undefined`)
    const noId = fold([ev({ type: 'user_turn', text: 'q', ...FROM_ADA }), given(undefined, 4)])
    expect(relayed(noId).map((one) => one.opened)).toEqual([undefined])
    // a stored value that is not an id is not a piece
    const forged = fold([brief('f', {})])
    expect(relayed(forged).map((one) => one.opened)).toEqual([undefined])
    // ⛔ a PERSON's turn with the key (a hand-edited row) is refused by the item's kind
    const mine = fold([
      ev({ type: 'user_turn', text: 'mine', piece: 'work_5', label: 'W1.5' }),
      given('work_5', 5),
    ])
    expect(mine.items.filter((item) => item.kind === 'user')).toHaveLength(1)
    expect(JSON.stringify(mine.items)).not.toContain('"opened"')
  })

  it('⚑ the words the card draws — the piece’s spelling, *Piece* when nothing labelled it, nothing for none', () => {
    // ⚑ **D-016 · the piece's spelling** — its label beside its title, the label alone when no
    // give in view titles it, and *Piece* when nothing labelled it.
    expect(pieceSays({ label: 'W1.12', title: 'Job 12' })).toBe('W1.12 · Job 12')
    expect(pieceSays({ label: 'W1.12' })).toBe('W1.12')
    expect(pieceSays({})).toBe('Piece')
    expect(pieceSays(undefined)).toBeNull()
  })

  it('⚑ the Events tab says which piece a turn gave, as `message_sent` does at the other end', () => {
    // ⚑ **D-016, commit 5 · *briefs*** — true of the brief that gives a piece and of its new brief,
    // which names the piece the same way.
    const line = describeEvent(brief('abc', 'work_9', 'W1.9') as never)
    expect(line).toContain(' · briefs work_9')
    expect(
      describeEvent(ev({ type: 'user_turn', text: 'abc', ...FROM_ADA }) as never),
    ).not.toContain('briefs')
  })
})

describe('one count, one sentence', () => {
  it('the sentence, and nothing at 0 or at a value that is not a count', () => {
    expect(rowsUnreadSays(1)).toBe(
      '1 row of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.',
    )
    expect(rowsUnreadSays(3)).toContain('3 rows of')
    expect(rowsUnreadSays(3)).toContain('or its state may be wrong')
    for (const none of [0, -1, Number.NaN]) expect(rowsUnreadSays(none), String(none)).toBeNull()
    expect(ROWS_UNREAD_LEAD).toBe('This may not be accurate')
  })
})

describe('a refusal names the control by its own label', () => {
  it('both refusals of the agent sheet send a person to New agent on the Team page', async () => {
    const store = createAgentStore({
      agentIdentities: async () => null,
      setCapabilities: async () => null,
      setAgentProvider: async () => null,
    } as unknown as RuntimeBridge)
    const saved = await store.save('ghost', {} as never, [])
    const chose = await store.chooseProviderFor('ghost', 'codex')
    expect(chose.ok).toBe(false)
    for (const said of [saved, chose.ok ? null : chose.reason]) {
      expect(said).toContain('There is no agent identity called ghost')
      expect(said).toContain('Create it with New agent on the Team page')
      expect(said).not.toMatch(/\brail\b/)
    }
  })
})
