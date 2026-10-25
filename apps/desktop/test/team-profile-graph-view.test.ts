import { expect, it } from 'vitest'
import type { GraphEdge } from '../src/shared/team-profile-graph'
import { fictionalGraph } from './fixtures/team-profile-graph-view'
import {
  graphDefaults,
  graphView,
  graphPartners,
  labelBudget,
  normalized,
} from '../src/renderer/src/lib/team-profile-graph'
it('uses global totals, direction sums, message-only springs and no zero/zero pair', () => {
  const f = fictionalGraph(3),
    c = graphDefaults()
  f.edges = [
    { source: f.nodes[0]!.id, target: f.nodes[1]!.id, work: 2, messages: 0, questions: 0 },
    { source: f.nodes[1]!.id, target: f.nodes[0]!.id, work: 3, messages: 0, questions: 0 },
    { source: f.nodes[0]!.id, target: f.nodes[2]!.id, work: 0, messages: 10, questions: 0 },
  ]
  const view = graphView(f, c)
  expect(view.edges.map((e) => e.count)).toEqual([5])
  expect(view.links).toHaveLength(2)
  expect(view.links.map((l) => l.weight)).toEqual([0, 1])
  c.proximity = 'selected'
  expect(graphView(f, c).links).toHaveLength(1)
  c.directions = true
  expect(graphView(f, c).edges.map((e) => e.count)).toEqual([2, 3])
  c.showBroBot = false
  const hidden = graphView(f, c)
  expect(hidden.edges).toHaveLength(0)
  expect(hidden.links).toHaveLength(0)
  expect(hidden.nodes).toHaveLength(2)
  expect(graphPartners(f, hidden, hidden.nodes[0]!.id, 'work')).toEqual([])
  expect(hidden.radii).toEqual(view.radii.slice(1))
})
it('counts message-only connections against the layout ceiling without truncating the list', () => {
  const f = fictionalGraph(200, true),
    view = graphView(f, graphDefaults())
  expect(view.tooLarge).toBe(true)
  expect(view.nodes).toHaveLength(200)
  expect(view.links).toHaveLength(0)
})
it('caps the shared badge/name budget and preserves zero badges', () => {
  for (const n of [299, 300, 301]) {
    const b = labelBudget(n, true)
    expect(b.badges + b.names).toBe(300)
    expect(b.badges).toBe(n <= 300 ? n : 150)
  }
  expect(labelBudget(100, true)).toEqual({ badges: 100, names: 200, ordinary: 200 })
  expect(labelBudget(1000, true)).toEqual({ badges: 150, names: 150, ordinary: 150 })
  expect(labelBudget(1000, false)).toEqual({ badges: 0, names: 300, ordinary: 250 })
  expect(normalized(0, 100, 'log')).toBe(0)
  expect(normalized(100, 100, 'sqrt')).toBe(1)
})
it('refuses the union of disjoint selected and message pairs before allocating layout links', () => {
  const f = fictionalGraph(1000),
    edges: GraphEdge[] = []
  for (let i = 0; i < 1000 && edges.length < 8000; i++)
    for (let j = i + 1; j < 1000 && edges.length < 8000; j++) {
      const selected = edges.length < 4000
      edges.push({
        source: f.nodes[i]!.id,
        target: f.nodes[j]!.id,
        work: selected ? 1 : 0,
        messages: selected ? 0 : 1,
        questions: 0,
      })
    }
  f.edges = edges
  const view = graphView(f, graphDefaults())
  expect(view.edges).toHaveLength(4000)
  expect(view.tooLarge).toBe(true)
  expect(view.links).toHaveLength(0)
  expect(view.nodes).toHaveLength(1000)
})
