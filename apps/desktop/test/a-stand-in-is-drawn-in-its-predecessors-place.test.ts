import { describe, expect, it } from 'vitest'
import { forestView, type ForestRow } from '../src/renderer/src/lib/the-forest'
import { forestGraph, waitsOnIt } from '../src/renderer/src/lib/forest-graph'
import type { ForestNode, NamedConversation, TheWholeForest } from '../src/shared/the-whole-forest'

/**
 * # 🔴 D-034 · a stand-in is drawn in its predecessor's place
 *
 * A conversation that could never be reopened is replaced by a new one of the same agent (F071).
 * The forest names both ends (`standsInFor`, `inItsPlace`), and the Graph draws the stand-in where
 * the predecessor stood: its children, the pieces it holds and the pieces it gave hang on the
 * stand-in, so a parent's line to a child is dashed by open work given before the replacement and
 * after it alike. ⚑ Past the bound, the predecessor stays drawn.
 */

const NOW = 1_800_000_000_000

const drawnAs = (id: string): NamedConversation => ({ is: 'a-conversation', conversation: id })
const notDrawnAs = (id: string): NamedConversation => ({
  is: 'a-conversation-this-reading-did-not-draw',
  conversation: id,
})

const conversation = (
  id: string,
  over: Partial<Extract<ForestNode, { node: 'a-conversation' }>> = {},
): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
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

const task = (
  piece: string,
  holder: string,
  giver: string,
  state = 'working',
  giverIs: 'a-conversation' | 'a-conversation-this-reading-did-not-draw' = 'a-conversation',
): ForestNode =>
  ({
    node: 'a-task',
    under: { is: 'a-conversation', conversation: holder },
    givenBy: { is: giverIs, conversation: giver },
    work: {
      piece,
      label: piece,
      title: `the work of ${piece}`,
      from: giver,
      fromIdentity: 'pm',
      to: holder,
      toIdentity: 'worker',
      state,
      givenAt: NOW - 30_000,
      endedAt: null,
    },
  }) as ForestNode

const forest = (rows: readonly ForestNode[]): TheWholeForest =>
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
  }) as TheWholeForest

const view = (rows: readonly ForestNode[]) =>
  forestView({
    forest: forest(rows),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set<string>(),
  })!

const nodesOf = (rows: readonly ForestRow[]) =>
  rows.filter((row) => row.kind === 'a-conversation').map((row) => [row.conversation, row.depth])

const graphNode = (rows: readonly ForestRow[], id: string) =>
  forestGraph({ rows } as never)
    .generations.flat()
    .find((node) => node.row.conversation === id)!

describe('D-034 · a stand-in is drawn in its predecessor’s place', () => {
  it('🔴 a child replaced: the stand-in hangs under the parent, the old one is not drawn, and its open piece dashes the line', () => {
    const v = view([
      conversation('pm'),
      conversation('old', { under: drawnAs('pm'), inItsPlace: drawnAs('new') }),
      conversation('new', { under: drawnAs('pm'), standsInFor: [drawnAs('old')] }),
      task('W1.1', 'old', 'pm', 'stalled'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['new', 1],
    ])
    const piece = v.rows.find((row) => row.kind === 'a-task')!
    expect(piece.conversation, 'the old child’s piece hangs on its stand-in').toBe('new')
    expect(waitsOnIt(graphNode(v.rows, 'new'))).toBe(true)
  })

  it('🔴 a parent replaced: its children hang on the stand-in, and work given before and after both dash', () => {
    const v = view([
      conversation('pm-old', { inItsPlace: drawnAs('pm-new') }),
      conversation('pm-new', { standsInFor: [drawnAs('pm-old')] }),
      conversation('worker', { under: drawnAs('pm-old') }),
      task('W2.1', 'worker', 'pm-old'),
      task('W3.1', 'worker', 'pm-new'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm-new', 0],
      ['worker', 1],
    ])
    const givers = v.rows.flatMap((row) => (row.taskRow ? [row.taskRow.giver] : []))
    expect(givers).toEqual(['pm-new', 'pm-new'])
    expect(waitsOnIt(graphNode(v.rows, 'worker'))).toBe(true)
  })

  it('⚑ …and only work given before dashes it too, while it is open', () => {
    const rows = [
      conversation('pm-old', { inItsPlace: drawnAs('pm-new') }),
      conversation('pm-new', { standsInFor: [drawnAs('pm-old')] }),
      conversation('worker', { under: drawnAs('pm-old') }),
    ]
    expect(
      waitsOnIt(graphNode(view([...rows, task('W2.1', 'worker', 'pm-old')]).rows, 'worker')),
    ).toBe(true)
    expect(
      waitsOnIt(
        graphNode(view([...rows, task('W2.1', 'worker', 'pm-old', 'done')]).rows, 'worker'),
      ),
      'a finished piece dashes nothing',
    ).toBe(false)
  })

  it('🔴 a chain: every link names its end, and only the end is drawn', () => {
    const v = view([
      conversation('pm'),
      conversation('a', { under: drawnAs('pm'), inItsPlace: drawnAs('c') }),
      conversation('b', { under: drawnAs('pm'), inItsPlace: drawnAs('c') }),
      conversation('c', { under: drawnAs('pm'), standsInFor: [drawnAs('a'), drawnAs('b')] }),
      conversation('child-of-a', { under: drawnAs('a') }),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['c', 1],
      ['child-of-a', 2],
    ])
  })

  it('⛔ past the bound: the stand-in is not in this reading, so the predecessor stays drawn', () => {
    const v = view([
      conversation('pm'),
      conversation('old', { under: drawnAs('pm'), inItsPlace: notDrawnAs('new') }),
      task('W1.1', 'old', 'pm', 'stalled'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['old', 1],
    ])
    expect(v.rows.find((row) => row.kind === 'a-task')!.conversation).toBe('old')
  })

  it('⛔ …and a predecessor past the bound leaves the stand-in where it is, its giver at its place', () => {
    const v = view([
      conversation('pm-new', { standsInFor: [notDrawnAs('pm-old')] }),
      conversation('worker', { under: notDrawnAs('pm-old') }),
      task('W2.1', 'worker', 'pm-old', 'working', 'a-conversation-this-reading-did-not-draw'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm-new', 0],
      ['worker', 1],
    ])
    const row = v.rows.find((r) => r.kind === 'a-conversation' && r.conversation === 'worker')!
    expect(row.conversationRow?.parentNotDrawn).toBeNull()
    const piece = v.rows.find((r) => r.kind === 'a-task')!
    expect(piece.taskRow?.giver).toBe('pm-new')
    expect(piece.taskRow?.giverNotDrawn).toBeNull()
  })

  it('⚑ a reopen on its own id names no stand-in, and nothing moves — even when a record names itself', () => {
    const v = view([
      conversation('pm'),
      conversation('worker', {
        under: drawnAs('pm'),
        standsInFor: [drawnAs('worker')],
        inItsPlace: drawnAs('worker'),
      }),
      task('W1.1', 'worker', 'pm'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['worker', 1],
    ])
    expect(waitsOnIt(graphNode(v.rows, 'worker'))).toBe(true)
    expect(v.coverage.replaced).toBe(0)
    expect(v.placeOf).toBeUndefined()
  })

  it('⛔ a stand-in looked up by id: a name the reading lacks hides nothing, and moves nothing', () => {
    const v = view([
      conversation('pm'),
      // `.is` says drawn, but no such conversation is in this answer (a ledger skipped whole).
      conversation('old', { under: drawnAs('pm'), inItsPlace: drawnAs('gone') }),
      conversation('child', { under: drawnAs('old') }),
      task('W1.1', 'old', 'pm'),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['old', 1],
      ['child', 2],
    ])
    expect(v.rows.find((row) => row.kind === 'a-task')!.conversation).toBe('old')
  })

  it('⛔ a loop no host sends hides no one and loses no one', () => {
    const v = view([
      conversation('a', { inItsPlace: drawnAs('b'), standsInFor: [drawnAs('b')] }),
      conversation('b', { inItsPlace: drawnAs('a'), standsInFor: [drawnAs('a')] }),
      task('W1.1', 'a', 'a'),
    ])
    expect(
      nodesOf(v.rows)
        .map(([id]) => id)
        .sort(),
    ).toEqual(['a', 'b'])
    expect(v.rows.filter((row) => row.kind === 'a-task')).toHaveLength(1)
  })

  it('⚑ a stand-in whose predecessor was its parent takes that predecessor’s parent', () => {
    const v = view([
      conversation('pm'),
      conversation('old', { under: drawnAs('pm'), inItsPlace: drawnAs('new') }),
      conversation('new', { under: drawnAs('old'), standsInFor: [drawnAs('old')] }),
    ])
    expect(nodesOf(v.rows)).toEqual([
      ['pm', 0],
      ['new', 1],
    ])
  })

  it('⚑ the count says how many are drawn in another’s place, and the place is named for the card', () => {
    const v = view([
      conversation('pm'),
      conversation('old', { under: drawnAs('pm'), inItsPlace: drawnAs('new') }),
      conversation('new', { under: drawnAs('pm'), standsInFor: [drawnAs('old')] }),
    ])
    expect(v.coverage.replaced).toBe(1)
    expect(v.placeOf?.get('old')).toBe('new')
  })
})
