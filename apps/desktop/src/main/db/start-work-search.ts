import { withWorkerMemory } from '../worker-memory'
import startWorker from '../work-search.worker?nodeWorker'
import { WorkSearchWorkerReader } from './work-search-reader'

export function startWorkSearch(file: string): WorkSearchWorkerReader {
  return new WorkSearchWorkerReader((caller, query) =>
    withWorkerMemory('work-search', () =>
      startWorker({
        workerData: { file, caller, query },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      }),
    ),
  )
}
