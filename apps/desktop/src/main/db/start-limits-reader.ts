import startWorker from '../limits-reader.worker?nodeWorker'
import { LimitsWorkerTransport } from './limits-worker-transport'

export function startLimitsReader(file: string): LimitsWorkerTransport {
  return new LimitsWorkerTransport(
    startWorker({
      workerData: { file },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    }),
  )
}
