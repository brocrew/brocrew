import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { readerWorkCallbacks } from './db/reader-work-callbacks'
import { FilesLibraryEngine } from './db/files-library-engine'
import { filesLibraryRequest, libraryReadContext } from '../shared/files-library'

const options = z.strictObject({ file: z.string().min(1) })
const incoming = z.strictObject({
  type: z.literal('read'),
  id: z.number().int().positive().safe(),
  request: filesLibraryRequest,
  context: libraryReadContext,
  cancellation: z.instanceof(SharedArrayBuffer).refine((buffer) => buffer.byteLength === 4),
})
if (parentPort !== null) {
  const port = parentPort
  try {
    const engine = new FilesLibraryEngine(options.parse(workerData).file)
    port.postMessage({ type: 'ready' })
    port.on('message', (message: unknown) => {
      const parsed = incoming.safeParse(message)
      if (!parsed.success) {
        engine.close()
        port.close()
        return
      }
      const { id, request, context, cancellation } = parsed.data
      const callbacks = readerWorkCallbacks(cancellation, (completed) =>
        port.postMessage({ type: 'progress', id, completed }),
      )
      port.postMessage({
        type: 'read',
        id,
        result: engine.read(request, context, callbacks.cancelled, callbacks.progress),
      })
    })
    port.on('close', () => engine.close())
  } catch {
    port.close()
  }
}
