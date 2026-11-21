import { withWorkerMemory } from '../worker-memory'
import startWorker from '../past-work-search.worker?nodeWorker'
import { PastWorkSearchReader } from './past-work-search-reader'

export function startPastWorkSearch(): PastWorkSearchReader {
  return new PastWorkSearchReader((file) =>
    withWorkerMemory('past-work-search', () =>
      startWorker({
        workerData: { file },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      }),
    ),
  )
}
