import { parentPort, workerData } from 'node:worker_threads'
import {
  StorageEngine,
  storageReason,
  type StorageRequest,
  type StorageRoots,
} from './storage/engine'

const port = parentPort
if (port) {
  const { roots, request } = workerData as { roots: StorageRoots; request: StorageRequest }
  const engine = new StorageEngine(roots)
  void (async () => {
    try {
      const value =
        request.kind === 'measure'
          ? await engine.measure()
          : request.kind === 'children'
            ? await engine.children(request.location)
            : await engine.reveal(request.location)
      port.postMessage({ ok: true, value })
    } catch (error) {
      port.postMessage({ ok: false, error: storageReason(error) })
    } finally {
      port.close()
    }
  })()
}
