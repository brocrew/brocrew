import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

const [database, bundle, manifestFile, mode] = process.argv.slice(2)
if (!database || !bundle || !manifestFile || !['baseline', 'candidate'].includes(mode)) {
  throw new Error(
    'Usage: node scripts/window-query-only.mjs DBPATH WORKER MANIFEST baseline|candidate',
  )
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const started = performance.now()
const worker = new Worker(resolve(bundle), {
  workerData: { file: resolve(database) },
  resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
})
let requests = 0
let owners = 0
let routedOwners = 0
let finished = false
let phase = 'starting'
const reads = []
const timer = setTimeout(() => finish('timeout', 1, 0), 60_000)

function finish(outcome, exit, oom) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  console.log(
    JSON.stringify({
      source: manifest.source,
      tree: manifest.tree,
      mode,
      phase,
      outcome,
      requests,
      reads,
      owners,
      routedOwners,
      oom,
      milliseconds: performance.now() - started,
      oldSpaceMb: 128,
      youngSpaceMb: 16,
      workerSha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
    }),
  )
  void worker.terminate().then(() => {
    process.exitCode = exit
  })
}

function read() {
  phase = mode === 'baseline' ? 'legacy-global-routes-prepass' : 'legacy-listing-facts'
  worker.postMessage({
    type: 'read',
    id: ++requests,
    query:
      mode === 'baseline'
        ? { kind: 'routes' }
        : { kind: 'listing' },
  })
}

worker.on('message', (message) => {
  if (finished) return
  if (message.type === 'ready') return read()
  if (message.type !== 'read' || message.id !== requests) return finish('query-failed', 1, 0)
  if (mode === 'baseline') return finish('control-did-not-oom', 1, 0)
  const result = message.result
  if (result.kind !== 'listing') return finish('wrong-result', 1, 0)
  reads.push({
    phase,
    owners: result.work.owners.length,
    routedOwners: result.routes.length,
    milliseconds: performance.now() - started,
  })
  owners = result.work.owners.length
  routedOwners = result.routes.length
  if (requests < 2) return read()
  finish('complete', 0, 0)
})
worker.on('error', (error) =>
  finish(
    error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'worker-oom' : 'worker-error',
    1,
    error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 1 : 0,
  ),
)
worker.on('exit', () => {
  if (!finished) finish('worker-exited', 1, 0)
})
