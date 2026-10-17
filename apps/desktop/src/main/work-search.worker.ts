import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { workSearchQuery } from '../shared/work-search'
import { WorkSearchEngine } from './db/work-search-engine'

if (parentPort !== null) {
  const port = parentPort
  let engine: WorkSearchEngine | undefined
  try {
    const request = z
      .object({
        file: z.string().min(1),
        caller: z.string().min(1).max(200),
        query: workSearchQuery,
      })
      .strict()
      .parse(workerData)
    engine = new WorkSearchEngine(request.file)
    port.postMessage(
      engine.read(request.caller, request.query, (result) => {
        port.postMessage({ kind: 'progress', result })
      }),
    )
  } catch {
    port.postMessage({ ok: false, reason: 'unavailable' })
  } finally {
    engine?.close()
    port.close()
  }
}
