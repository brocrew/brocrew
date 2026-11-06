import { afterEach, expect, it } from 'vitest'
import { TeamProfileGraphEngine } from '../src/main/db/team-profile-graph-engine'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  type GraphNode,
  type GraphEdge,
} from '../src/shared/team-profile-graph'
import { graphContext, graphFixture } from './helpers/team-profile-graph-fixture'
import { graphCutoff } from './fixtures/team-profile-graph-oracle'

const owned: { close(): void }[] = []
afterEach(() => {
  for (const item of owned.splice(0).reverse()) item.close()
})
function fixture() {
  const f = graphFixture()
  owned.push(f)
  return f
}
function complete(engine: TeamProfileGraphEngine) {
  const header = engine.read({ operation: 'snapshot' }, graphContext)
  expect(header.type, JSON.stringify(header)).toBe('snapshot')
  if (header.type !== 'snapshot') throw new Error('No complete reading')
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = []
  for (const operation of ['nodes', 'edges'] as const) {
    let cursor: string | undefined
    do {
      const page = engine.read(
        { operation, snapshot: header.snapshot, ...(cursor ? { cursor } : {}) },
        graphContext,
      )
      if (page.type === 'nodes') nodes.push(...page.nodes)
      else if (page.type === 'edges') edges.push(...page.edges)
      else throw new Error(JSON.stringify(page))
      cursor = page.next ?? undefined
    } while (cursor)
  }
  return { header, nodes, edges }
}
it('batches empty conversations and keeps every page on bounded seeks', () => {
  const f = fixture()
  f.identity('aid:fiction')
  f.db.transaction(() => {
    for (let i = 0; i < 1025; i++) {
      f.session(`empty-${i}`, 'aid:fiction')
      f.root(`empty-${i}`)
    }
  })()
  const reads: { sql: string; args: readonly unknown[] }[] = []
  const engine = new TeamProfileGraphEngine(
    f.file,
    f.executionFile,
    () => graphCutoff,
    () => performance.now(),
    (sql, args) => {
      if (sql.includes('FROM turn WHERE') || sql.includes('FROM events WHERE'))
        reads.push({ sql, args })
    },
  )
  owned.push(engine)
  const { header, nodes } = complete(engine)
  expect(nodes[0]).toMatchObject({ conversations: 1025, recentTurns: 0, messagesSent: 0 })
  expect(header.metrics.rows).toBe(2052)
  // A per-conversation probe regression makes this fail even on a very fast machine.
  expect(reads).toHaveLength(3 * Math.ceil(1025 / 64))
  expect(new Set(reads.map(({ sql }) => sql)).size).toBe(3)
  for (const { sql, args } of reads) {
    expect(args.length).toBeLessThanOrEqual(72)
    expect(args.at(-1)).toBe(B.page)
  }
})
it('keeps mixed generations, cutoffs, unknown bindings and route deduplication across page and batch boundaries', () => {
  const f = fixture()
  f.identity('aid:sender')
  f.identity('aid:recipient')
  f.session('recipient', 'aid:recipient')
  f.root('recipient')
  const turn = f.db.prepare(
    "INSERT INTO turn(id,session_id,ordinal,prompt,opened_at,closed_at,generation,end_reason) VALUES(?,?,?,'fictional',?,?,?,'completed')",
  )
  const active = f.db.prepare(
    'INSERT INTO derived_generation(session_id,active,normalizer_version,derived_through,highest,updated_at) VALUES(?,?,1,0,?,?)',
  )
  const ids = Array.from({ length: 135 }, (_, i) => `sender-${i}`)
  // SQLite's byte order puts these in the reverse of JavaScript's UTF-16 order.
  ids.push('sender-\u{10000}', 'sender-\ue000')
  f.db.transaction(() => {
    for (const [i, id] of ids.entries()) {
      const generation = i < 135 ? i % 2 : 0
      f.session(id, 'aid:sender')
      f.root(id)
      active.run(id, generation, generation, graphCutoff)
      // More than one page within a conversation, and equal ordinals across conversations.
      for (let ordinal = 0; ordinal < 300; ordinal++) {
        turn.run(`${id}-${ordinal}`, id, ordinal, graphCutoff - 1, graphCutoff, generation)
        f.event(
          id,
          'message_sent',
          JSON.stringify({ to: 'recipient' }),
          generation,
          graphCutoff,
          ordinal,
        )
        f.event(
          id,
          'request_routed',
          JSON.stringify({ to: 'an-agent', parent: 'recipient', requestId: 'dedup' }),
          generation,
          graphCutoff,
          1000 + ordinal,
        )
      }
      f.event(id, 'message_sent', '{', 2, graphCutoff, 5000)
      f.event(
        id,
        'message_sent',
        JSON.stringify({ to: 'recipient' }),
        generation,
        graphCutoff + 1,
        4000,
      )
      f.event(
        id,
        'request_routed',
        JSON.stringify({ to: 'a-person', requestId: 'person' }),
        generation,
        graphCutoff,
        5001,
      )
      f.event(
        id,
        'request_routed',
        JSON.stringify({ to: 'the-parent', requestId: 'parent' }),
        generation,
        graphCutoff,
        5002,
      )
    }
    f.session('unbound', null)
    f.event('unbound', 'message_sent', '{')
    f.session('missing', null)
    f.event('missing', 'message_sent', '{')
    f.session('future', 'aid:sender', graphCutoff + 1)
    f.event('future', 'message_sent', '{')
  })()
  f.db.pragma('foreign_keys=OFF')
  f.db
    .prepare('UPDATE provider_session SET agent_identity_id=? WHERE id=?')
    .run('aid:missing', 'missing')
  f.db.pragma('foreign_keys=ON')
  const engine = new TeamProfileGraphEngine(f.file, f.executionFile, () => graphCutoff)
  owned.push(engine)
  const { header, nodes, edges } = complete(engine)
  expect(nodes.find(({ id }) => id === 'aid:sender')).toMatchObject({
    conversations: ids.length,
    recentTurns: ids.length * 300,
    messagesSent: ids.length * 300,
    lastTurnAt: graphCutoff,
  })
  expect(edges).toEqual([
    {
      source: 'aid:sender',
      target: 'aid:recipient',
      work: 0,
      messages: ids.length * 300,
      questions: ids.length,
    },
  ])
  expect(header.coverage).toMatchObject({
    unboundConversations: 1,
    missingIdentityConversations: 1,
    excludedPersonRoutes: ids.length,
    excludedParentRoutes: ids.length,
  })
})
for (const stop of ['deadline', 'cancellation'] as const)
  it(`refuses the entire reading when ${stop} arrives during a batch`, () => {
    const f = fixture()
    f.identity('aid:fiction')
    f.session('fiction', 'aid:fiction')
    f.root('fiction')
    let now = 0,
      cancelled = false
    const engine = new TeamProfileGraphEngine(
      f.file,
      f.executionFile,
      () => graphCutoff,
      () => now,
      (sql) => {
        if (sql.includes('FROM turn WHERE')) {
          if (stop === 'deadline') now = 5000
          else cancelled = true
        }
      },
    )
    owned.push(engine)
    const result = engine.read({ operation: 'snapshot' }, graphContext, () => cancelled)
    expect(result).toMatchObject({
      type: 'unavailable',
      cause: stop === 'deadline' ? 'budget' : 'cancelled',
      complete: false,
      phase: 'turns',
    })
    expect(result).not.toHaveProperty('metrics')
    expect(result).not.toHaveProperty('nodes')
    expect(f.db.inTransaction).toBe(false)
  })

it('removes consumed session IDs before SQLite resumes a long conversation', () => {
  const f = fixture()
  f.identity('aid:source')
  f.identity('aid:target')
  for (const id of ['source', 'target']) {
    f.session(id, `aid:${id}`)
    f.root(id)
  }
  f.db.transaction(() => {
    for (let ordinal = 0; ordinal < 10000; ordinal++)
      f.event('source', 'message_sent', JSON.stringify({ to: 'target' }), 0, graphCutoff, ordinal)
  })()
  let resumed = 0
  const engine = new TeamProfileGraphEngine(
    f.file,
    f.executionFile,
    () => graphCutoff,
    () => performance.now(),
    (sql, args) => {
      if (!sql.includes('UNION ALL')) return
      const events = sql.includes('FROM events WHERE')
      const cursor = (args[events ? 1 : 0] as string | null) ?? ''
      const later = args.slice(events ? 5 : 3, (events ? 5 : 3) + 64)
      for (const id of later)
        if (id !== null)
          expect(Buffer.compare(Buffer.from(id as string), Buffer.from(cursor))).toBeGreaterThan(0)
      if (cursor === 'source') {
        resumed++
        expect(later).not.toContain('source')
        expect(args[events ? 3 : 2]).toBeGreaterThanOrEqual(255)
      }
    },
  )
  owned.push(engine)
  const { nodes, edges } = complete(engine)
  expect(resumed).toBeGreaterThan(30)
  expect(nodes.find(({ id }) => id === 'aid:source')?.messagesSent).toBe(10000)
  expect(edges).toEqual([
    { source: 'aid:source', target: 'aid:target', work: 0, messages: 10000, questions: 0 },
  ])
})

it('does not probe a future empty-ID session as an initial cursor sentinel', () => {
  const f = fixture()
  f.identity('aid:valid')
  f.session('valid', 'aid:valid')
  f.root('valid')
  f.session('', 'aid:valid', graphCutoff + 1)
  f.event('', 'message_sent', '{', 0, graphCutoff, 0)
  const engine = new TeamProfileGraphEngine(f.file, f.executionFile, () => graphCutoff)
  owned.push(engine)
  expect(complete(engine).nodes).toMatchObject([
    { id: 'aid:valid', conversations: 1, messagesSent: 0 },
  ])
})
