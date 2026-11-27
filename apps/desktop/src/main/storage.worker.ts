import './worker-memory'
import { parentPort, workerData } from 'node:worker_threads'
import { trimOldEvents, type EventTrimWrite } from './db/event-retention'
import { describeOpenFailure, openWorkspaceDatabase } from './db/open-workspace-database'
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
        if (request.kind === 'open') {
          let failure = null
          try {
            openWorkspaceDatabase({
              ...request.opening,
              migrate: (apply) => {
                port.postMessage({ migrating: true })
                apply()
                port.postMessage({ migrated: true })
              },
            }).close()
          } catch (error) {
            failure = describeOpenFailure(error, request.opening.file)
          }
          port.postMessage({ ok: true, value: failure })
          return
        }
        let stopped = false
        port.on('message', (message) => {
          if (message.kind === 'stop') stopped = true
        })
        const value = await trimOldEvents(
          request.file,
          () => stopped,
          (batch) =>
            new Promise<EventTrimWrite>((resolve, reject) => {
              const answered = (reply: {
                kind?: string
                value?: EventTrimWrite
                error?: string
                code?: string
              }) => {
                if (reply.kind === 'stop') return
                port.off('message', answered)
                if (reply.error !== undefined)
                  reject(Object.assign(new Error(reply.error), { code: reply.code }))
                else resolve(reply.value!)
              }
              port.on('message', answered)
              port.postMessage({ kind: 'trim-batch', batch })
            }),
        )
        port.postMessage({ ok: true, value })
        return
      }
      const { roots, request } = workerData as { roots: StorageRoots; request: StorageRequest }
      let lastReport = 0
      const engine = new StorageEngine(roots, undefined, undefined, () => {
        const now = Date.now()
        if (now - lastReport < 1000) return
        lastReport = now
        port.postMessage({ progress: true })
      })
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
