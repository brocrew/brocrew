import { workerData } from 'node:worker_threads'
import {
  databaseMemory,
  describeDatabaseMemory,
  onDatabaseMemoryChange,
} from '../../src/main/database-memory'

const options = workerData as { indexOpens: SharedArrayBuffer }
const indexOpens = new Int32Array(options.indexOpens)
Reflect.deleteProperty(options, 'indexOpens')
let previous: string | undefined
onDatabaseMemoryChange(() => {
  const index = describeDatabaseMemory(databaseMemory()).match(/\bpast-work-index#\d+\b/)?.[0]
  if (index !== undefined && index !== previous) {
    Atomics.add(indexOpens, 0, 1)
    previous = index
  }
})

void import('../../src/main/past-work-search.worker')
