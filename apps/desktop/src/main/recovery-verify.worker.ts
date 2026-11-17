import { parentPort, workerData } from 'node:worker_threads'
import { checkTheCopy, type CopyCheckRequest } from './recovery/copy-check'
import { sha256Of } from './recovery/files'

/** Checks one recovery copy off the main thread, closes it, answers, and ends. */
const port = parentPort
if (port) {
  const { copy, holdMs, hashOnly, readonly } = workerData as CopyCheckRequest
  if (hashOnly) {
    // A hash reads the copy in steps, so a quit's stop ends it at the next one.
    const stop = new AbortController()
    port.on('message', (message: { kind?: string }) => {
      if (message.kind === 'stop') stop.abort()
    })
    void sha256Of(copy, undefined, stop.signal)
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
    port.postMessage(checkTheCopy(copy, holdMs, readonly))
    port.close()
  }
}
