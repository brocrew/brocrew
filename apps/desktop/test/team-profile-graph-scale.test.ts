import { expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { graphFixture, graphContext } from './helpers/team-profile-graph-fixture'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { TeamProfileGraphLifetime } from '../src/main/db/team-profile-graph-reader'
import { graphCutoff } from './fixtures/team-profile-graph-oracle'

for (const [identities, conversations, events] of [
  [100, 1000, 10000],
  [1000, 10000, 100000],
] as const)
  it(`reads fictional scale ${identities}/${conversations}/${events} without blocking its caller`, async () => {
    const f = graphFixture()
    try {
      f.db.transaction(() => {
        for (let i = 0; i < identities; i++) f.identity(`aid:fiction${i}`)
        for (let i = 0; i < conversations; i++) {
          f.session(`s${i}`, `aid:fiction${i % identities}`)
          f.root(`s${i}`)
        }
        for (let i = 0; i < events; i++)
          f.event(
            `s${i % conversations}`,
            i % 2 === 0 ? 'message_sent' : 'request_routed',
            JSON.stringify(
              i % 2 === 0
                ? { to: `s${(i + 1) % conversations}` }
                : { to: 'an-agent', parent: `s${(i + 1) % conversations}`, requestId: `q${i}` },
            ),
            0,
            graphCutoff - 86_400_000,
            i,
          )
      })()
      f.db.prepare('UPDATE work SET created_at=?').run(graphCutoff - 86_400_000)
      const plans = [
        f.db
          .prepare('EXPLAIN QUERY PLAN SELECT rowid FROM work WHERE rowid>? ORDER BY rowid LIMIT ?')
          .all(0, 256),
        f.db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT ordinal FROM events WHERE type=? AND session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?',
          )
          .all('message_sent', 's0', 0, -1, 256),
        f.db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT ordinal FROM turn WHERE session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?',
          )
          .all('s0', 0, -1, 256),
      ]
      const bundle = await bundleAWorker(
        'src/main/team-profile-graph.worker.ts',
        f.directory,
        'graph-worker.cjs',
      )
      let exitAt: number | null = null
      const reader = new TeamProfileGraphLifetime(() => {
        const w = new Worker(bundle, {
          workerData: { file: f.file, executionFile: f.executionFile },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        })
        w.once('exit', () => (exitAt = performance.now()))
        return w
      })
      let previous = performance.now(),
        maxDelay = 0,
        ticks = 0
      const heartbeat = setInterval(() => {
        const now = performance.now()
        maxDelay = Math.max(maxDelay, now - previous - 10)
        previous = now
        ticks++
      }, 10)
      const start = performance.now()
      try {
        const header = await reader.read({ operation: 'snapshot' }, graphContext)
        expect(header.type, JSON.stringify(header)).toBe('snapshot')
        if (header.type !== 'snapshot') throw new Error('no complete reading')
        let nodes = 0,
          edges = 0
        for (const operation of ['nodes', 'edges'] as const) {
          let cursor: string | undefined
          do {
            const page = await reader.read(
              { operation, snapshot: header.snapshot, ...(cursor ? { cursor } : {}) },
              graphContext,
            )
            if (page.type === 'nodes') nodes += page.nodes.length
            else if (page.type === 'edges') edges += page.edges.length
            else throw new Error(JSON.stringify(page))
            cursor = page.next ?? undefined
          } while (cursor)
        }
        const callerAt = performance.now()
        await reader.close()
        const processExitAt = exitAt
        process.stdout.write(
          'GRAPH_SCALE ' +
            JSON.stringify({
              identities,
              conversations,
              events,
              metrics: header.metrics,
              nodes,
              edges,
              callerMs: callerAt - start,
              nativeExitMs: processExitAt === null ? null : processExitAt - start,
              heartbeatMaxDelayMs: maxDelay,
              heartbeatTicks: ticks,
              plans,
            }) +
            '\n',
        )
        expect(nodes).toBe(identities)
        expect(edges).toBe(identities)
        expect(header.metrics.rows).toBeLessThanOrEqual(250000)
        expect(header.metrics.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024)
        expect(maxDelay).toBeLessThan(100)
        expect(processExitAt).not.toBeNull()
      } finally {
        clearInterval(heartbeat)
        await reader.close()
      }
    } finally {
      f.close()
    }
  }, 20000)

it('admits or honestly refuses the 10k-identity/50k-pair boundary without partial counts', async () => {
  const f = graphFixture()
  try {
    const at = Date.now() - 86400000
    f.db.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        f.identity(`aid:bound${i}`)
        f.session(`b${i}`, `aid:bound${i}`, at)
        f.root(`b${i}`)
      }
      for (let i = 0; i < 10000; i++)
        for (let step = 1; step <= 5; step++)
          f.event(
            `b${i}`,
            'message_sent',
            JSON.stringify({ to: `b${(i + step) % 10000}` }),
            0,
            at,
            i * 5 + step,
          )
    })()
    f.db.prepare('UPDATE work SET created_at=?').run(at)
    const bundle = await bundleAWorker(
      'src/main/team-profile-graph.worker.ts',
      f.directory,
      'graph-boundary.cjs',
    )
    const reader = new TeamProfileGraphLifetime(
      () =>
        new Worker(bundle, {
          workerData: { file: f.file, executionFile: f.executionFile },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        }),
    )
    try {
      const result = await reader.read({ operation: 'snapshot' }, graphContext)
      if (result.type === 'snapshot')
        expect([result.nodeCount, result.edgeCount]).toEqual([10000, 50000])
      else {
        expect(result).toMatchObject({ type: 'unavailable', cause: 'budget', complete: false })
        expect(result).not.toHaveProperty('nodes')
        expect(result).not.toHaveProperty('metrics')
      }
      process.stdout.write('GRAPH_BOUNDARY ' + JSON.stringify(result) + '\n')
    } finally {
      await reader.close()
    }
  } finally {
    f.close()
  }
}, 20000)

it('leaves 80MiB of unrelated fictional prose outside event parsing and row counts', async () => {
  const f = graphFixture()
  try {
    f.identity('aid:prose')
    f.session('prose', 'aid:prose')
    f.root('prose')
    f.db.prepare('UPDATE work SET created_at=?').run(Date.now() - 86400000)
    const prose = 'Fictional unrelated prose. '.repeat(330)
    f.db.transaction(() => {
      for (let i = 0; i < 10000; i++) f.event('prose', 'text', prose, 0, Date.now() - 86400000, i)
    })()
    const bundle = await bundleAWorker(
      'src/main/team-profile-graph.worker.ts',
      f.directory,
      'graph-prose.cjs',
    )
    const reader = new TeamProfileGraphLifetime(
      () => new Worker(bundle, { workerData: { file: f.file, executionFile: f.executionFile } }),
    )
    try {
      const result = await reader.read({ operation: 'snapshot' }, graphContext)
      expect(result).toMatchObject({ type: 'snapshot', nodeCount: 1, edgeCount: 0 })
      if (result.type !== 'snapshot') throw Error('No complete prose control')
      expect(result.metrics.rows).toBeLessThan(20)
      process.stdout.write(
        'GRAPH_UNRELATED_PROSE ' +
          JSON.stringify({
            fixtureBytes: Buffer.byteLength(prose) * 10000,
            metrics: result.metrics,
          }) +
          '\n',
      )
    } finally {
      await reader.close()
    }
  } finally {
    f.close()
  }
}, 20000)
