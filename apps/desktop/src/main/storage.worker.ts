import { parentPort, workerData } from 'node:worker_threads'
import { trimOldEvents } from './db/event-retention'
import { inspectCompaction, writeCompactedWorkspace } from './db/workspace-compaction'
import {
  StorageEngine,
  storageReason,
  type StorageRequest,
  type StorageRoots,
} from './storage/engine'

const port = parentPort
if (port) {
  void (async () => {
    try {
      if ('maintenance' in workerData) {
        const request = workerData.maintenance
        if (request.kind === 'inspect') {
          port.postMessage({ ok: true, value: inspectCompaction(request.file) })
          return
        }
        if (request.kind === 'compact') {
          writeCompactedWorkspace(request.file, request.output)
          port.postMessage({ ok: true, value: null })
          return
        }
        let stopped = false
        port.on('message', () => {
          stopped = true
        })
        const value = await trimOldEvents(request.file, () => stopped)
        port.postMessage({ ok: true, value })
        return
      }
      const { roots, request } = workerData as { roots: StorageRoots; request: StorageRequest }
      const engine = new StorageEngine(roots)
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
