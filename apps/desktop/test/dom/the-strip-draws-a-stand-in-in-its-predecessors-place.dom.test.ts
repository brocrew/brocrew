import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { mount, unmountAll } from './harness'

/**
 * # 🔴 F094 · the Sub agents strip draws a stand-in in its predecessor's place
 *
 * Draw a stand-in once, in its predecessor’s position, rather than both conversations under
 * the same profile. If the strip has no stand-in, the old tile says it was replaced and must
 * not read `idle`.
 */

const NOW = Date.now()

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.forest.value = null
  cast.railSays.value = null
})

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

const spawn = (conversation: string): SpawnEdge => ({
  conversation,
  identity: 'ali',
  provider: 'claude',
  running: 'unwatched',
})

const read = (children: readonly string[]): WhoCalledWhom => ({
  conversation: 'sess_w1',
  parent: null,
  children: walk(children.map(spawn), 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
})

const node = (conversation: string, over: Record<string, unknown> = {}): ForestNode =>
  ({
    node: 'a-conversation',
    conversation,
    under: { is: 'a-conversation', conversation: 'sess_w1' },
    identity: 'ali',
    provider: 'claude',
    status: 'idle',
    running: 'unwatched',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as ForestNode

const forest = (rows: readonly ForestNode[]): TheWholeForest =>
  ({
    readAt: NOW,
    nodes: {
      rows,
      walk: 'every-conversation-this-app-placed',
      ledgers: rows.length,
      rowsUnread: 0,
    },
    conversations: rows.length,
    heldByNoAgent: 0,
  }) as TheWholeForest

async function strip(children: readonly string[], rows: readonly ForestNode[] | null) {
  useWhoCalledWhom().forest.value = rows === null ? null : forest(rows)
  const m = mount(
    WorkingTogether,
    {
      reading: { conversation: 'sess_w1', read: read(children), answered: true, atWork: null },
      conversation: 'sess_w1',
      identities: null,
      canOpen: false,
    },
    { width: 360, height: 400 },
  )
  await nextTick()
  return m
}

const tiles = (m: { host: HTMLElement }) =>
  [...m.host.querySelectorAll('[data-cy="cast-children-strip"] [data-conversation]')].map((one) =>
    one.getAttribute('data-conversation'),
  )

describe('F094 · the strip draws a stand-in in its predecessor’s place', () => {
  it('🔴 a replaced child and its stand-in: one tile, the stand-in, where the old one stood', async () => {
    const m = await strip(
      ['sess_old', 'sess_other', 'sess_new'],
      [
        node('sess_w1', { under: { is: 'the-person' } }),
        node('sess_old', { inItsPlace: { is: 'a-conversation', conversation: 'sess_new' } }),
        node('sess_other', { identity: 'ada' }),
        node('sess_new', { standsInFor: [{ is: 'a-conversation', conversation: 'sess_old' }] }),
      ],
    )
    expect(tiles(m)).toEqual(['sess_new', 'sess_other'])
  })

  it('⛔ a stand-in the strip does not hold: the old tile says it was replaced, never idle', async () => {
    const m = await strip(
      ['sess_old'],
      [
        node('sess_old', {
          inItsPlace: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_new' },
        }),
      ],
    )
    expect(tiles(m)).toEqual(['sess_old'])
    expect(m.q('cast-tile-word-sess_old').textContent?.trim()).toBe('replaced by ali')
  })

  it('⚑ nothing replaced, or no forest read yet: every child as it is', async () => {
    expect(tiles(await strip(['sess_a', 'sess_b'], [node('sess_a'), node('sess_b')]))).toEqual([
      'sess_a',
      'sess_b',
    ])
    unmountAll()
    expect(tiles(await strip(['sess_a', 'sess_b'], null))).toEqual(['sess_a', 'sess_b'])
  })
})
