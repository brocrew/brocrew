import { Worker } from 'node:worker_threads'
import { TeamProfileGraphLifetime } from '../../src/main/db/team-profile-graph-reader'
import type { TeamProfileGraphReadContext } from '../../src/shared/team-profile-graph'
import { GraphCallerProbe, GraphHeartbeatProbe } from './graph-caller-probe'

export type GraphScaleInput = {
  sample: number
  bundle: string
  file: string
  context: TeamProfileGraphReadContext
}

async function readSample(input: GraphScaleInput) {
  let exitAt: number | null = null
  const caller = new GraphCallerProbe()
  const reader = new TeamProfileGraphLifetime(() => {
    const worker = new Worker(input.bundle, {
      workerData: { file: input.file },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    })
    worker.once('exit', () => (exitAt = performance.now()))
    return caller.worker(worker)
  })
  const coldHeartbeat = new GraphHeartbeatProbe(caller)
  const heartbeat = new GraphHeartbeatProbe(caller)
  try {
    await coldHeartbeat.start()
    const coldStart = performance.now()
    const coldHeader = await caller.call('snapshot-call', () =>
      reader.read({ operation: 'snapshot' }, input.context),
    )
    const coldSnapshotMs = performance.now() - coldStart
    if (coldHeader.type !== 'snapshot') throw new Error(JSON.stringify(coldHeader))
    const cold = {
      snapshotMs: coldSnapshotMs,
      nodes: coldHeader.nodeCount,
      edges: coldHeader.edgeCount,
      metrics: coldHeader.metrics,
      callerPhases: { ...caller.phases },
      callerMaxMs: caller.maxMs,
      ...coldHeartbeat.report(),
    }
    await coldHeartbeat.close()
    // Native worker startup has its own completion budget; warm reads keep the caller budget.
    caller.reset()
    await heartbeat.start()
    const start = performance.now()
    const header = await caller.call('snapshot-call', () =>
      reader.read({ operation: 'snapshot' }, input.context),
    )
    const snapshotMs = performance.now() - start
    if (header.type !== 'snapshot') throw new Error(JSON.stringify(header))
    let nodes = 0,
      edges = 0
    for (const operation of ['nodes', 'edges'] as const) {
      let cursor: string | undefined
      do {
        const page = await caller.call(operation + '-call', () =>
          reader.read(
            { operation, snapshot: header.snapshot, ...(cursor ? { cursor } : {}) },
            input.context,
          ),
        )
        if (page.type === 'nodes') nodes += page.nodes.length
        else if (page.type === 'edges') edges += page.edges.length
        else throw new Error(JSON.stringify(page))
        cursor = page.next ?? undefined
      } while (cursor)
    }
    const callerAt = performance.now()
    await caller.call('close-call', () => reader.close())
    // Drain the final graph callback before reporting or writing any child output.
    await new Promise((resolve) => setTimeout(resolve, 10))
    return {
      sample: input.sample,
      cold,
      metrics: header.metrics,
      nodes,
      edges,
      snapshotMs,
      paginationMs: callerAt - start - snapshotMs,
      callerMs: callerAt - start,
      nativeExitMs: exitAt === null ? null : exitAt - start,
      callerPhases: caller.phases,
      callerMaxMs: caller.maxMs,
      ...heartbeat.report(),
    }
  } finally {
    try {
      await reader.close()
    } finally {
      await coldHeartbeat.close()
      await heartbeat.close()
    }
  }
}

export type GraphScaleSample = Awaited<ReturnType<typeof readSample>>

void readSample(JSON.parse(process.argv[2]!) as GraphScaleInput).then(
  (result) => process.stdout.write(JSON.stringify(result) + '\n'),
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)
