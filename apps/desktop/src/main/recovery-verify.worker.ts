import { parentPort, workerData } from 'node:worker_threads'
import { checkTheCopy, type CopyCheckRequest } from './recovery/copy-check'
import { sha256Of } from './recovery/files'

/** Checks one recovery copy off the main thread, closes it, answers, and ends. */
const port = parentPort
if (port) {
  const { copy, holdMs, hashOnly } = workerData as CopyCheckRequest
  if (hashOnly) {
    void sha256Of(copy)
      .then(
        (sha256) => port.postMessage({ kind: 'ok', sha256 }),
        (error: unknown) =>
          port.postMessage({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => port.close())
  } else {
    port.postMessage(checkTheCopy(copy, holdMs))
    port.close()
  }
}
