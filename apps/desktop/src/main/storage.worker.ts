import './worker-memory'
import { parentPort, workerData } from 'node:worker_threads'
import { trimOldEvents, type EventTrimWrite } from './db/event-retention'
import { inspectCompaction, writeCompactedWorkspace } from './db/workspace-compaction'
import {
  StorageEngine,
  storageReason,
  type StorageRequest,
  type StorageRoots,
} from './storage/engine'
import { finishedWorkIn, withFinishedWork } from './storage/finished-work'
import type { StorageDirectory } from '../shared/storage'

/** A read of agent output's own folders also says which of them are finished work. */
async function children(
  engine: StorageEngine,
  roots: StorageRoots,
  request: Extract<StorageRequest, { kind: 'children' }>,
  progressed: () => void,
): Promise<StorageDirectory> {
  const directory = await engine.children(request.location, request.limit)
  const { part, segments } = request.location
  if (part !== 'agent-output' || segments.length > 0 || roots.database[0] === undefined)
    return directory
  return withFinishedWork(directory, roots.database[0], progressed)
}

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
      const progressed = (): void => {
        const now = Date.now()
        if (now - lastReport < 1000) return
        lastReport = now
        port.postMessage({ progress: true })
      }
      const engine = new StorageEngine(roots, undefined, undefined, progressed)
      const value =
        request.kind === 'measure'
          ? await engine.measure()
          : request.kind === 'children'
            ? await children(engine, roots, request, progressed)
            : request.kind === 'finished'
              ? {
                  finished: roots.database[0]
                    ? [...finishedWorkIn(roots.database[0], request.names, progressed).keys()]
                    : [],
                }
              : await engine.reveal(request.location)
      port.postMessage({ ok: true, value })
    } catch (error) {
      port.postMessage({ ok: false, error: storageReason(error) })
    } finally {
      port.close()
    }
  })()
}
