import { parentPort, workerData } from 'node:worker_threads'
import { checkTheCopy, type CopyCheckRequest } from './recovery/copy-check'

/** Checks one recovery copy off the main thread, closes it, answers, and ends. */
const port = parentPort
if (port) {
  const { copy, holdMs } = workerData as CopyCheckRequest
  port.postMessage(checkTheCopy(copy, holdMs))
  port.close()
}
