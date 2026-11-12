import { describe, expect, it, vi } from 'vitest'
import { readForestPages, type ForestSnapshot } from '../src/renderer/src/lib/forest-reading'
import { conv, readingOf, forestOf } from './dom/forest-fixture'

const scope = { is: 'the-workspace', window: 'day' } as const

describe('a graph reading grows by pages without changing its membership clock', () => {
  it('publishes honest progress and reads every match past the former 500 cutoff', async () => {
    const ids = Array.from({ length: 751 }, (_, i) => `neri-${i}`)
    const first = readingOf([conv(ids[0]!, null)], scope, {
      members: { total: ids.length, admitted: ids },
      unfolded: ids.slice(1),
    })
    const forestReading = vi.fn(async () => first)
    const forestNodes = vi.fn(async (_reading: string, asked: readonly string[]) => ({
      nodes: forestOf(asked.map((id) => conv(id, null))).nodes,
      gone: [],
      readAt: first.readAt + 1,
    }))
    const snapshots: ForestSnapshot[] = []
    expect(await readForestPages({ forestReading, forestNodes }, scope, () => true, (one) => snapshots.push(one))).toBe(true)
    expect(snapshots.map((one) => [one.loaded, one.expected, one.complete])).toEqual([
      [1, 751, false], [251, 751, false], [501, 751, false], [751, 751, true],
    ])
    expect(snapshots.every((one) => one.reading.measuredFrom === first.measuredFrom && one.reading.counts === first.counts)).toBe(true)
    expect(snapshots.at(-1)!.forest.nodes.rows).toHaveLength(751)
    expect(forestNodes.mock.calls.map(([, asked]) => asked.length)).toEqual([250, 250, 250])
  })

  it('stops asking for pages after the selected scope moves', async () => {
    const first = readingOf([conv('aster', null)], scope, { unfolded: ['neri'] })
    let current = true
    const forestNodes = vi.fn()
    const publish = vi.fn(() => { current = false })
    expect(await readForestPages({ forestReading: async () => first, forestNodes }, scope, () => current, publish)).toBe(false)
    expect(forestNodes).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
  })

  it('does not label a missing page or a conversation deleted during paging complete', async () => {
    for (const page of [null, { nodes: forestOf([]).nodes, gone: ['neri'], readAt: 1 }]) {
      const snapshots: ForestSnapshot[] = []
      const first = readingOf([conv('aster', null)], scope, { members: { total: 2, admitted: ['aster', 'neri'] }, unfolded: ['neri'] })
      expect(await readForestPages({ forestReading: async () => first, forestNodes: async () => page }, scope, () => true, (one) => snapshots.push(one))).toBe(false)
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]!.complete).toBe(false)
    }
  })

  it('does not publish an initial read that arrives after the scope moved', async () => {
    const publish = vi.fn()
    expect(await readForestPages({ forestReading: async () => readingOf([]), forestNodes: vi.fn() }, scope, () => false, publish)).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })
})
