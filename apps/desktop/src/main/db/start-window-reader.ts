import startWorker from '../window-reader.worker?nodeWorker'
import { WindowReaderLifetime, WindowWorkerReader } from './window-worker-reader'
import type { WindowStoreReader } from './window-read-protocol'

export function startWindowReader(file: string): WindowStoreReader {
  return new WindowReaderLifetime(
    () =>
      new WindowWorkerReader(
        startWorker({
          workerData: { file },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        }),
      ),
  )
}
