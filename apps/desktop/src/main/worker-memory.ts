import {
  getEnvironmentData,
  isMainThread,
  setEnvironmentData,
  type Worker,
} from 'node:worker_threads'
import { databaseMemory, describeDatabaseMemory, onDatabaseMemoryChange } from './database-memory'
import {
  readWorkerMemory,
  writeWorkerMemory,
  WORKER_MEMORY_BYTES,
  WORKER_MEMORY_INTERVAL_MS,
} from './worker-memory-record'

const KEY = 'brocrew.worker-memory'
const roles = [
  'window-reader',
  'limits-reader',
  'files-library',
  'work-search',
  'past-work-search',
  'team-profile-graph',
  'storage',
  'recovery-verify',
  'settings-locator',
] as const
type Role = (typeof roles)[number]
const workers = new Map<number, { role: Role; record: BigInt64Array; state: string }>()
const seen = new Set<Role>()
let generation = 0
let afterRead: (() => void) | undefined

/** A completed read can refresh a due sample when a continuous request stream starves timers. */
export function sampleWorkerMemoryAfterRead(): void {
  afterRead?.()
}

/** The existing factory/lifetime still owns the worker. No request/reply messages are added. */
export function withWorkerMemory<T extends Worker>(role: Role, start: () => T): T {
  const record = new BigInt64Array(new SharedArrayBuffer(WORKER_MEMORY_BYTES))
  const previous = getEnvironmentData(KEY)
  let worker: T
  setEnvironmentData(KEY, record.buffer)
  try {
    worker = start()
  } finally {
    setEnvironmentData(KEY, previous)
  }
  const id = ++generation
  const entry = { role, record, state: 'starting' }
  seen.add(role)
  workers.set(id, entry)
  worker.once('online', () => {
    if (entry.state === 'starting') entry.state = 'live'
  })
  worker.once('exit', () => {
    workers.delete(id)
  })
  const terminate = worker.terminate
  worker.terminate = function () {
    entry.state = 'closing'
    return terminate.call(this)
  }
  return worker
}

export function memoryDiagnostic(now = Date.now()): string {
  const descriptions = [...workers].map(([id, { role, record, state }]) => {
    const sample = readWorkerMemory(record)
    const label = `${role}#${id}`
    if (sample === null) return `${label}:${state}/sample-unavailable`
    const age = Math.max(0, now - sample.at)
    return (
      `${label}:${state}${age > WORKER_MEMORY_INTERVAL_MS * 2 ? '/stale' : ''}` +
      ` ageMs=${age} heapUsed=${sample.heapUsed} heapTotal=${sample.heapTotal}` +
      ` sqlite=${describeDatabaseMemory(sample.connections)} omittedConnections=${sample.omitted}`
    )
  })
  for (const role of roles) {
    if (![...workers.values()].some((worker) => worker.role === role))
      descriptions.push(`${role}:${seen.has(role) ? 'closed' : 'not-started'}`)
  }
  return (
    `[worker isolate memory bytes: ${descriptions.join('; ')}]` +
    ` [main SQLite settings: ${describeDatabaseMemory(databaseMemory())}]`
  )
}

if (!isMainThread) {
  const buffer = getEnvironmentData(KEY)
  setEnvironmentData(KEY, undefined)
  if (buffer instanceof SharedArrayBuffer && buffer.byteLength === WORKER_MEMORY_BYTES) {
    const record = new BigInt64Array(buffer)
    let lastSample = 0
    const sample = (connectionOpened = false): void => {
      const now = Date.now()
      if (!connectionOpened && now - lastSample < WORKER_MEMORY_INTERVAL_MS) return
      lastSample = now
      try {
        writeWorkerMemory(record, process.memoryUsage(), databaseMemory(), now)
      } catch {
        // A missing or stale diagnostic must never change a read reply or worker lifetime.
      }
    }
    onDatabaseMemoryChange(() => sample(true))
    afterRead = () => sample()
    sample(true)
    setInterval(() => sample(), WORKER_MEMORY_INTERVAL_MS).unref()
  }
}
