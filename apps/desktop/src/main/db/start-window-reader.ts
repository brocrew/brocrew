import { withWorkerMemory } from '../worker-memory'
import startWorker from '../window-reader.worker?nodeWorker'
import { debugIsOn, logDebug } from '../logging/log'
import { WindowReaderLifetime, WindowWorkerReader } from './window-worker-reader'
import type { WindowStoreReader } from './window-read-protocol'

export function startWindowReader(file: string): WindowStoreReader {
  return new WindowReaderLifetime(() => {
    const debug = debugIsOn()
    const worker = withWorkerMemory('window-reader', () =>
      startWorker({
        env: { ...process.env, BROCREW_WINDOW_READ_TIMING: debug ? '1' : '0' },
        workerData: { file },
        resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 16 },
      }),
    )
    const workerId = worker.threadId
    return new WindowWorkerReader(
      worker,
      debug
        ? (phase, facts) =>
            logDebug('window-reader-timing', phase, { pid: process.pid, workerId, ...facts })
        : undefined,
    )
  })
}
