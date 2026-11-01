import { afterEach, expect, it } from 'vitest'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { TeamProfileGraphEngine } from '../src/main/db/team-profile-graph-engine'
import { graphContext, graphFixture } from './helpers/team-profile-graph-fixture'
import { graphCutoff, graphOracle } from './fixtures/team-profile-graph-oracle'
import {
  graphDayStart,
  graphAdd,
  teamProfileGraphRequest,
  teamProfileGraphResult,
  type TeamProfileGraphResult,
  type GraphNode,
  type GraphEdge,
} from '../src/shared/team-profile-graph'
const owned: { close: () => void }[] = []
afterEach(() => {
  for (const f of owned.splice(0).reverse()) f.close()
})
function setup() {
  const f = graphFixture()
  owned.push(f)
  const engine = new TeamProfileGraphEngine(f.file, f.executionFile, () => graphCutoff)
  owned.push(engine)
  return { ...f, engine }
}
function snapshot(r: TeamProfileGraphResult) {
  expect(r.type, JSON.stringify(r)).toBe('snapshot')
  if (r.type !== 'snapshot') throw new Error('no complete reading')
  return r
}
function complete(f: ReturnType<typeof setup>) {
  const h = snapshot(f.engine.read({ operation: 'snapshot' }, graphContext))
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = []
  for (const operation of ['nodes', 'edges'] as const) {
    let cursor: string | undefined
    do {
      const r = f.engine.read(
        { operation, snapshot: h.snapshot, ...(cursor ? { cursor } : {}), size: 1 },
        graphContext,
      )
      if (r.type === 'nodes') nodes.push(...r.nodes)
      else if (r.type === 'edges') edges.push(...r.edges)
      else throw new Error(JSON.stringify(r))
      cursor = r.next ?? undefined
    } while (cursor)
  }
  return { h, nodes, edges }
}
it('matches the frozen hand-counted fictional oracle across all immutable pages', () => {
  const f = setup()
  f.seed()
  const { h, nodes, edges } = complete(f)
  expect([h.nodeCount, h.edgeCount]).toEqual([5, 3])
  for (const n of nodes)
    expect([
      n.conversations,
      n.piecesHeld,
      n.messagesSent,
      n.recentTurns,
      n.directDescendants,
      n.descendants,
      n.recordedWorking,
    ]).toEqual(graphOracle.expected[n.profile as 'alpha'])
  expect(edges.map((e) => [e.source, e.target, e.work, e.messages, e.questions])).toEqual(
    graphOracle.expected.edges,
  )
  for (const [k, v] of Object.entries(graphOracle.expected.coverage))
    expect(h.coverage[k as keyof typeof h.coverage], k).toBe(v)
  expect(nodes.find((n) => n.profile === 'alpha')?.configured).toEqual({
    provider: 'claude',
    model: 'alpha-current',
    source: 'conversation-setting',
  })
  expect(nodes.find((n) => n.profile === 'beta')?.configured.model).toBe(null)
  expect(nodes.find((n) => n.profile === 'reborn')?.configured.source).toBe('unknown')
  expect(nodes.find((n) => n.profile === 'alpha')?.lastTurnAt).toBe(graphCutoff - 86_400_000)
  expect(nodes.every((n) => n.kind === 'normal' && n.kindQuality === 'legacy-normal')).toBe(true)
})
it('separates complete empty from unavailable and keeps the database read-only', () => {
  const f = setup()
  expect(complete(f).h.nodeCount).toBe(0)
  f.identity('aid:alpha')
  f.session('a', 'aid:alpha')
  f.root('a')
  const before = f.db.prepare('SELECT total_changes() AS changes').get()
  const version = f.db.pragma('data_version', { simple: true })
  complete(f)
  expect(f.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
  expect(f.db.pragma('data_version', { simple: true })).toBe(version)
  expect(f.engine.read({ operation: 'release' }, graphContext)).toEqual({ type: 'released' })
  expect(f.engine.read({ operation: 'nodes', snapshot: 'gone' }, graphContext)).toMatchObject({
    type: 'unavailable',
    cause: 'expired',
    complete: false,
  })
})
it('fails malformed and oversize relevant routing rather than returning partial zero counts', () => {
  for (const payload of [
    '{',
    '[]',
    '{"to":5}',
    JSON.stringify({ to: 'a', body: 'x'.repeat(32768) }),
  ]) {
    const f = setup()
    f.identity('aid:alpha')
    f.session('a', 'aid:alpha')
    f.root('a')
    f.event('a', 'message_sent', payload)
    expect(f.engine.read({ operation: 'snapshot' }, graphContext)).toMatchObject({
      type: 'unavailable',
      cause: 'metadata',
      complete: false,
    })
    expect(f.db.inTransaction).toBe(false)
    f.db.prepare('DELETE FROM events').run()
    expect(complete(f).nodes).toHaveLength(1)
  }
})
it('does not parse or export unrelated prose and rejects wrong-type/forged/foreign cursors', () => {
  const f = setup()
  f.seed()
  f.event('a1', 'assistant', JSON.stringify({ text: 'private-fictional-prose'.repeat(10000) }), 2)
  const h = snapshot(f.engine.read({ operation: 'snapshot' }, graphContext))
  const page = f.engine.read({ operation: 'nodes', snapshot: h.snapshot, size: 1 }, graphContext)
  if (page.type !== 'nodes' || !page.next) throw new Error('missing page')
  expect(JSON.stringify(page)).not.toContain('private-fictional-prose')
  for (const [operation, cursor, context] of [
    ['nodes', page.next + 'x', graphContext],
    ['edges', page.next, graphContext],
    ['nodes', page.next, { ...graphContext, ownerNonce: 'another-window' }],
  ] as const)
    expect(f.engine.read({ operation, snapshot: h.snapshot, cursor }, context)).toMatchObject({
      type: 'unavailable',
      cause: 'invalid-cursor',
    })
})
it('pins pages and stale is monotonic after a newer host revision', () => {
  const f = setup()
  f.seed()
  const h = snapshot(f.engine.read({ operation: 'snapshot' }, graphContext))
  f.identity('aid:new')
  for (const revision of ['1', '0']) {
    const page = f.engine.read(
      { operation: 'nodes', snapshot: h.snapshot },
      { ...graphContext, hostRevision: revision },
    )
    expect(page).toMatchObject({ type: 'nodes', stale: true })
    if (page.type === 'nodes') expect(page.nodes).toHaveLength(5)
  }
})
it('rolls back cooperative cancellation without admitting partial data', () => {
  const f = setup()
  f.seed()
  let visits = 0
  expect(f.engine.read({ operation: 'snapshot' }, graphContext, () => ++visits > 10)).toMatchObject(
    { type: 'unavailable', cause: 'cancelled' },
  )
  expect(f.db.inTransaction).toBe(false)
  expect(complete(f).nodes).toHaveLength(5)
})
it('keeps provider/model pairing, ties and earlier-incarnation settings conservative', () => {
  const f = setup()
  f.identity('aid:a', 'a', graphCutoff - 100)
  f.session('old', 'aid:a', graphCutoff - 200, 'claude', 'old')
  f.root('old')
  f.db
    .prepare('UPDATE agent_identity SET provider=?,model_choice=?')
    .run('codex', JSON.stringify({ provider: 'codex', model: 'default', effort: null }))
  expect(complete(f).nodes[0]?.configured).toEqual({
    provider: 'codex',
    model: 'default',
    source: 'identity-model-choice',
  })
  for (const id of ['z', 'a']) {
    f.session(id, 'aid:a', graphCutoff - 50, 'claude', id)
    f.root(id)
  }
  expect(complete(f).nodes[0]?.configured).toEqual({
    provider: 'claude',
    model: 'a',
    source: 'conversation-setting',
  })
  f.db.pragma('ignore_check_constraints=ON')
  f.db
    .prepare('UPDATE provider_session SET provider=?,model=NULL WHERE id=?')
    .run('future-provider', 'a')
  expect(complete(f).nodes[0]?.configured).toEqual({
    provider: null,
    model: null,
    source: 'conversation-setting',
  })
})
it('classifies only stable simple kind proofs and never repairs a file', () => {
  const f = setup()
  f.identity('aid:service')
  f.session('service', 'aid:service')
  const file = {
    version: 2,
    profiles: {
      'aid:service': {
        kind: 'service',
        identityCreatedAt: graphCutoff - 20 * 86_400_000,
        serviceConversation: 'service',
      },
    },
  }
  writeFileSync(f.executionFile, JSON.stringify(file))
  expect(complete(f).nodes[0]?.kind).toBe('service')
  f.root('service')
  expect(complete(f).nodes[0]?.kindQuality).toBe('unknown-conflict')
  writeFileSync(f.executionFile, 'malformed')
  expect(complete(f).nodes[0]?.kindQuality).toBe('unknown-file')
})
it('uses timezone calendar midnights across DST and inclusive rolling ranges', () => {
  expect(graphDayStart(Date.parse('2026-03-08T12:00:00Z'), 'America/New_York')).toBe(
    Date.parse('2026-03-08T05:00:00Z'),
  )
  expect(graphDayStart(Date.parse('2026-11-01T12:00:00Z'), 'America/New_York')).toBe(
    Date.parse('2026-11-01T04:00:00Z'),
  )
  expect(graphDayStart(graphCutoff, 'UTC')).toBe(Date.UTC(2026, 9, 25))
})
it('strictly validates the request/result shapes and refuses unsafe arithmetic', () => {
  for (const request of [
    { operation: 'snapshot', file: '/fictional' },
    { operation: 'snapshot', owner: 'a' },
    { operation: 'nodes', snapshot: 'a', size: 101 },
    { operation: 'edges', snapshot: 'a', size: 257 },
  ])
    expect(teamProfileGraphRequest.safeParse(request).success).toBe(false)
  expect(
    teamProfileGraphResult.safeParse({
      type: 'unavailable',
      cause: 'budget',
      complete: false,
      phase: 'roster',
      visited: 0,
      unread: 0,
      remaining: 'unknown',
      nodes: [],
    }).success,
  ).toBe(false)
  expect(() => graphAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow()
})

it('retains counts while excluding invalid close and setting timestamps', () => {
  const f = setup()
  f.identity('aid:a')
  f.session('a', 'aid:a', graphCutoff - 100, 'codex', 'new')
  f.root('a')
  f.db.prepare('UPDATE provider_session SET updated_at=? WHERE id=?').run(graphCutoff - 200, 'a')
  f.db
    .prepare(
      "INSERT INTO turn(id,session_id,ordinal,prompt,opened_at,closed_at,end_reason,generation) VALUES('invalid-close','a',0,'fictional',?,?, 'completed',0)",
    )
    .run(graphCutoff - 50, graphCutoff - 75)
  const n = complete(f).nodes[0]!
  expect(n.conversations).toBe(1)
  expect(n.configured.source).toBe('unknown')
  expect(n.lastSavedUpdate).toBe(null)
  expect(n.lastTurnAt).toBe(graphCutoff - 50)
})

it('matches an independent pair-by-pair oracle for randomized small directed fixtures', () => {
  let random = 31337
  const pick = (size: number) => {
    random = (Math.imul(random, 1103515245) + 12345) >>> 0
    return random % size
  }
  for (let trial = 0; trial < 12; trial++) {
    const f = setup(),
      profiles = Array.from({ length: 6 }, (_, i) => `aid:p${i}`),
      sessions = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        identity: profiles[i % 6]!,
        active: pick(2),
      }))
    for (const id of profiles) f.identity(id)
    for (const s of sessions) {
      f.session(s.id, s.identity)
      f.root(s.id)
      if (s.active)
        f.db
          .prepare(
            'INSERT INTO derived_generation(session_id,active,normalizer_version,derived_through,highest,updated_at) VALUES(?,1,1,0,1,?)',
          )
          .run(s.id, graphCutoff)
    }
    const acts = Array.from({ length: 120 }, () => ({
      source: pick(12),
      target: pick(14),
      generation: pick(2),
      question: pick(2) === 1,
      request: `q${pick(6)}`,
    }))
    for (const a of acts) {
      const source = sessions[a.source]!,
        target = sessions[a.target]?.id ?? 'missing'
      f.event(
        source.id,
        a.question ? 'request_routed' : 'message_sent',
        JSON.stringify(
          a.question ? { to: 'an-agent', parent: target, requestId: a.request } : { to: target },
        ),
        a.generation,
      )
    }
    const { nodes, edges } = complete(f)
    for (const n of nodes)
      expect(n.messagesSent).toBe(
        acts.filter(
          (a) =>
            !a.question &&
            sessions[a.source]!.identity === n.id &&
            sessions[a.source]!.active === a.generation,
        ).length,
      )
    const effective = acts.filter(
      (a, index) =>
        sessions[a.source]!.active === a.generation &&
        (!a.question ||
          acts.findIndex(
            (b) =>
              b.question &&
              b.source === a.source &&
              b.target === a.target &&
              b.request === a.request &&
              sessions[b.source]!.active === b.generation,
          ) === index),
    )
    for (const source of profiles)
      for (const target of profiles) {
        if (source === target) continue
        const pair = edges.find((e) => e.source === source && e.target === target)
        const matching = effective.filter(
          (a) => sessions[a.source]!.identity === source && sessions[a.target]?.identity === target,
        )
        expect([pair?.messages ?? 0, pair?.questions ?? 0]).toEqual([
          matching.filter((a) => !a.question).length,
          matching.filter((a) => a.question).length,
        ])
      }
  }
})

it('returns one coherent pinned reading stale after an intervening external write without retrying', () => {
  const f = graphFixture()
  owned.push(f)
  f.seed()
  let changed = false,
    rosterReads = 0
  const engine = new TeamProfileGraphEngine(
    f.file,
    f.executionFile,
    () => graphCutoff,
    () => performance.now(),
    (sql) => {
      if (sql.includes('FROM agent_identity WHERE')) rosterReads++
      if (!changed) {
        changed = true
        f.identity('aid:later')
      }
    },
  )
  owned.push(engine)
  const h = snapshot(engine.read({ operation: 'snapshot' }, graphContext))
  expect(h.nodeCount).toBe(5)
  expect(h.stale).toBe(true)
  expect(rosterReads).toBe(1)
  const page = engine.read({ operation: 'nodes', snapshot: h.snapshot }, graphContext)
  expect(page).toMatchObject({ type: 'nodes', stale: true })
  const next = snapshot(engine.read({ operation: 'snapshot' }, graphContext))
  expect(next.nodeCount).toBe(6)
})

it('keeps a missing kind file unknown and distinguishes a readable empty file without repairing either', () => {
  const f = setup()
  f.identity('aid:a')
  f.session('a', 'aid:a')
  f.root('a')
  expect(complete(f).nodes[0]).toMatchObject({ kind: 'normal', kindQuality: 'legacy-normal' })
  rmSync(f.executionFile)
  expect(complete(f).nodes[0]).toMatchObject({ kind: 'unknown', kindQuality: 'unknown-file' })
  expect(existsSync(f.executionFile)).toBe(false)
  writeFileSync(f.executionFile, JSON.stringify({ version: 2, profiles: {} }))
  expect(complete(f).nodes[0]).toMatchObject({ kind: 'normal', kindQuality: 'legacy-normal' })
})
