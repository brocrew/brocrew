import { afterEach, expect, it } from 'vitest'
import { TeamProfileGraphEngine } from '../src/main/db/team-profile-graph-engine'
import { graphLineage } from '../src/main/db/team-profile-graph-lineage'
import { graphKindOf } from '../src/main/db/team-profile-graph-kind'
import { graphFixture, graphContext } from './helpers/team-profile-graph-fixture'
import { graphCutoff } from './fixtures/team-profile-graph-oracle'
import { emptyGraphCoverage, type GraphNode } from '../src/shared/team-profile-graph'
const owned: { close: () => void }[] = []
afterEach(() => {
  for (const o of owned.splice(0).reverse()) o.close()
})
const node = (n: number): GraphNode => ({
  id: `aid:n${n}`,
  createdAt: 1,
  profile: `n${n}`,
  name: `Node ${n}`,
  clipped: false,
  kind: 'unknown',
  kindQuality: 'unknown-file',
  kindReadAt: 1,
  configured: { provider: null, model: null, source: 'unknown' },
  conversations: 0,
  piecesHeld: 0,
  messagesSent: 0,
  recentTurns: 0,
  directDescendants: 0,
  descendants: 0,
  recordedWorking: 0,
  lastTurnAt: null,
  lastSavedUpdate: null,
})
it('matches independent small randomized reachability, including self/cycles', () => {
  let random = 173
  for (let trial = 0; trial < 80; trial++) {
    const nodes = Array.from({ length: 20 }, (_, i) => node(i)),
      parents = new Map<string, string>()
    for (const n of nodes) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const p = random % 24
      if (p < 20) parents.set(n.id, nodes[p]!.id)
    }
    const expected = nodes.map((start) => {
      const seen = new Set([start.id])
      let changed = true
      while (changed) {
        changed = false
        for (const [child, parent] of parents)
          if (seen.has(parent) && !seen.has(child)) {
            seen.add(child)
            changed = true
          }
      }
      return seen.size - 1
    })
    graphLineage(
      nodes,
      parents,
      emptyGraphCoverage(),
      () => {},
      () => {},
    )
    expect(nodes.map((n) => n.descendants)).toEqual(expected)
  }
})
it('processes deep lineage without recursion and checks its operation budget', () => {
  const nodes = Array.from({ length: 10_000 }, (_, i) => node(i)),
    parents = new Map(nodes.slice(1).map((n, i) => [n.id, nodes[i]!.id]))
  let reserved = 0,
    checks = 0
  graphLineage(
    nodes,
    parents,
    emptyGraphCoverage(),
    (bytes) => (reserved += bytes),
    () => checks++,
  )
  expect(nodes[0]?.descendants).toBe(9999)
  expect(nodes.at(-1)?.descendants).toBe(0)
  expect(reserved).toBeLessThan(16 * 1024 * 1024)
  expect(checks).toBeGreaterThan(100)
})
it('makes incomplete, changing, incarnation and conflicting kind evidence unknown', () => {
  const identity = { id: 'aid:a', createdAt: 10 },
    facts = {
      complete: true,
      serviceBirths: [],
      workerBirths: 0,
      earlierBirths: false,
      serviceBindsCurrent: false,
    }
  const file = {
    reading: {
      readable: true as const,
      kept: { profiles: { 'aid:a': { kind: 'normal' as const, identityCreatedAt: 10 } } },
    },
    changing: false,
    readAt: 20,
  }
  expect(graphKindOf(identity, file, facts).kind).toBe('normal')
  expect(graphKindOf(identity, { ...file, changing: true }, facts).kindQuality).toBe(
    'unknown-changing',
  )
  expect(graphKindOf(identity, file, { ...facts, complete: false }).kindQuality).toBe(
    'unknown-lineage',
  )
  expect(graphKindOf(identity, file, { ...facts, earlierBirths: true }).kindQuality).toBe(
    'unknown-incarnation',
  )
  expect(graphKindOf(identity, file, { ...facts, serviceBirths: ['s'] }).kindQuality).toBe(
    'unknown-conflict',
  )
  expect(graphKindOf(identity, file, { ...facts, workerBirths: 1 }).kindQuality).toBe(
    'unknown-lineage',
  )
})
it('expires immutable pages on a monotonic clock despite wall-clock reversal', () => {
  const f = graphFixture()
  owned.push(f)
  let mono = 0,
    wall = graphCutoff
  const engine = new TeamProfileGraphEngine(
    f.file,
    f.executionFile,
    () => wall,
    () => mono,
  )
  owned.push(engine)
  f.identity('aid:a')
  const h = engine.read({ operation: 'snapshot' }, graphContext)
  if (h.type !== 'snapshot') throw new Error(JSON.stringify(h))
  wall -= 86_400_000
  mono = 60001
  expect(engine.read({ operation: 'nodes', snapshot: h.snapshot }, graphContext)).toMatchObject({
    cause: 'expired',
  })
})
it('refuses a row-budget overflow completely, retaining no zero-filled metrics', () => {
  const f = graphFixture()
  owned.push(f)
  f.identity('aid:a')
  f.session('a', 'aid:a')
  f.root('a')
  const insert = f.db.prepare(
    "INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,'a',?,'message_sent','{\"to\":\"missing\"}',?,0)",
  )
  f.db.transaction(() => {
    for (let i = 0; i < 250001; i++) insert.run(`e${i}`, i, graphCutoff - 1)
  })()
  const engine = new TeamProfileGraphEngine(f.file, f.executionFile, () => graphCutoff)
  owned.push(engine)
  const r = engine.read({ operation: 'snapshot' }, graphContext)
  expect(r).toMatchObject({ type: 'unavailable', cause: 'budget', complete: false })
  expect(r).not.toHaveProperty('metrics')
  if (r.type === 'unavailable') expect(r.visited).toBeLessThanOrEqual(250000)
})

it('detects a file incarnation change around the bounded kind read', async () => {
  const { writeFileSync, renameSync } = await import('node:fs')
  const { readGraphKindFile } = await import('../src/main/db/team-profile-graph-kind')
  const f = graphFixture()
  owned.push(f)
  writeFileSync(f.executionFile, JSON.stringify({ version: 2, profiles: {} }))
  const other = f.executionFile + '.replacement'
  writeFileSync(
    other,
    JSON.stringify({
      version: 2,
      profiles: { 'aid:a': { kind: 'normal', identityCreatedAt: 10 } },
    }),
  )
  const reading = readGraphKindFile(
    f.executionFile,
    () => renameSync(other, f.executionFile),
    () => 20,
  )
  expect(reading.changing).toBe(true)
  expect(
    graphKindOf({ id: 'aid:a', createdAt: 10 }, reading, {
      complete: true,
      serviceBirths: [],
      workerBirths: 0,
      earlierBirths: false,
      serviceBindsCurrent: false,
    }).kindQuality,
  ).toBe('unknown-changing')
})
