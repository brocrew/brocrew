import { sampleWorkerMemoryAfterRead } from '../../src/main/worker-memory'
import Database from 'better-sqlite3'
import { getEnvironmentData, parentPort, workerData } from 'node:worker_threads'
import { observeDatabaseMemory } from '../../src/main/database-memory'

const held = new Array(workerData.rows).fill('held in this isolate')
const extraHeld: unknown[][] = []
const db = workerData.cacheSize === null ? undefined : new Database(':memory:')
if (db !== undefined) {
  db.pragma(`cache_size = ${workerData.cacheSize}`)
  observeDatabaseMemory(db, 'window-reader')
}
parentPort?.postMessage({
  ready: true,
  heapUsed: process.memoryUsage().heapUsed,
  inheritedSlotCleared: getEnvironmentData('brocrew.worker-memory') === undefined,
})
parentPort?.on('message', (message) => {
  if (message?.afterRead === true) {
    extraHeld.push(new Array(message.rows).fill('also held in this isolate'))
    const clock = Date.now
    Date.now = () => clock() + message.offsetMs
    try {
      sampleWorkerMemoryAfterRead()
    } finally {
      Date.now = clock
    }
    parentPort?.postMessage({ sampled: true })
    return
  }
  if (held.length !== workerData.rows) throw new Error('The fixture lost its held array.')
  db?.close()
  parentPort?.close()
})
